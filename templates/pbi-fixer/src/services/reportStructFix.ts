// Report structural fixers (PKG-5) — client-side PBIR patches.
//
// All of these operate on the report definition parts loaded through the same
// `loadDefinitionParts` / `saveDefinitionParts` round-trip used by the IBCS
// chart fixers. Each fixer exposes a `scan*` (read-only preview) and an
// `apply*` (single save round-trip) pair so the UI can show a diff before
// touching anything.
//
//   A5 — Hide visual-level filters   (isHiddenInViewMode = true)
//   A6 — Disable "Show items with no data"  (strip every showAll property)
//   A9 — Remove unused custom visuals (prune report.json publicCustomVisuals)
//   A7 — Visual alignment            (tolerance snap of chart x/y/width/height)
//   A8 — Migrate report-level measures into the bound semantic model
//   A11 — Upgrade report from PBIRLegacy to PBIR format

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { getReportFormat, upgradeReportToPbir } from './fabricRest';
import { createMeasure, type MeasureValues } from './measureEditor';

type ObjMap = Record<string, unknown>;

const VISUAL_PATH_RE = /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/;
const REPORT_JSON_RE = /definition\/report\.json$/;
const REPORT_EXT_RE = /definition\/reportExtensions\.json$/;

function parse(text: string): ObjMap | null {
  try {
    return JSON.parse(text) as ObjMap;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * A5 — Hide visual-level filters
 * ------------------------------------------------------------------ */

export interface HideFilterInfo {
  page: string;
  visual: string;
  /** Visible filters that would be hidden. */
  visible: number;
  /** Total filters declared on the visual. */
  total: number;
  /** True when a filterConfig is synthesised from the query projections. */
  created: boolean;
}

export interface HideFilterScan {
  visuals: HideFilterInfo[];
  total: number;
}

/** Pull (field, filterType) pairs from a visual's query projections. */
function fieldsFromQuery(visual: ObjMap): Array<{ field: ObjMap; type: string }> {
  const out: Array<{ field: ObjMap; type: string }> = [];
  const qs = (((visual.query as ObjMap | undefined)?.queryState as ObjMap | undefined) ??
    {}) as ObjMap;
  for (const role of Object.values(qs)) {
    const projs = ((role as ObjMap | undefined)?.projections as Array<ObjMap> | undefined) ?? [];
    for (const proj of projs) {
      const field = proj.field as ObjMap | undefined;
      if (!field) continue;
      out.push({ field, type: 'Measure' in field ? 'Advanced' : 'Categorical' });
    }
  }
  return out;
}

function planHideFilters(doc: ObjMap): { info: HideFilterInfo | null; changed: boolean } {
  const visual = (doc.visual ?? {}) as ObjMap;
  const qs = (((visual.query as ObjMap | undefined)?.queryState as ObjMap | undefined) ??
    {}) as ObjMap;
  if (Object.keys(qs).length === 0) return { info: null, changed: false };

  const filterCfg = doc.filterConfig as ObjMap | undefined;
  const filters = (filterCfg?.filters as Array<ObjMap> | undefined) ?? [];

  if (filters.length > 0) {
    const visible = filters.filter((f) => !f.isHiddenInViewMode);
    if (visible.length === 0) return { info: null, changed: false };
    for (const f of filters) f.isHiddenInViewMode = true;
    return {
      info: { page: '', visual: '', visible: visible.length, total: filters.length, created: false },
      changed: true,
    };
  }

  // No filterConfig — synthesise one from the query projections.
  const fields = fieldsFromQuery(visual);
  if (fields.length === 0) return { info: null, changed: false };
  doc.filterConfig = {
    filters: fields.map((f) => ({
      name: '',
      field: f.field,
      type: f.type,
      isHiddenInViewMode: true,
    })),
  };
  return {
    info: { page: '', visual: '', visible: fields.length, total: fields.length, created: true },
    changed: true,
  };
}

export async function scanHideFilters(
  workspaceId: string,
  reportId: string
): Promise<HideFilterScan> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const visuals: HideFilterInfo[] = [];
  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const probe = JSON.parse(JSON.stringify(doc)) as ObjMap;
    const { info, changed } = planHideFilters(probe);
    if (changed && info) visuals.push({ ...info, page: m[1], visual: m[2] });
  }
  return { visuals, total: visuals.length };
}

export async function applyHideFilters(
  workspaceId: string,
  reportId: string
): Promise<{ changed: number; detail: string }> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  for (const part of parts) {
    if (part.binary) continue;
    if (!VISUAL_PATH_RE.test(part.path)) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const { changed } = planHideFilters(doc);
    if (changed) edits[part.path] = JSON.stringify(doc, null, 2);
  }
  const changed = Object.keys(edits).length;
  if (changed > 0) await saveDefinitionParts('report', workspaceId, reportId, edits);
  return {
    changed,
    detail:
      changed > 0
        ? `Hidden visual-level filters on ${changed} visual(s).`
        : 'All visual-level filters are already hidden.',
  };
}

/* ------------------------------------------------------------------ *
 * A6 — Disable "Show items with no data"
 * ------------------------------------------------------------------ */

export interface ShowItemsInfo {
  page: string;
  visual: string;
  /** Number of showAll occurrences stripped. */
  count: number;
}

export interface ShowItemsScan {
  visuals: ShowItemsInfo[];
  total: number;
}

/** Recursively delete every `showAll` key; returns how many were removed. */
function stripShowAll(node: unknown): number {
  if (Array.isArray(node)) {
    let n = 0;
    for (const item of node) n += stripShowAll(item);
    return n;
  }
  if (node && typeof node === 'object') {
    const obj = node as ObjMap;
    let n = 0;
    if ('showAll' in obj) {
      delete obj.showAll;
      n += 1;
    }
    for (const v of Object.values(obj)) n += stripShowAll(v);
    return n;
  }
  return 0;
}

export async function scanShowItems(
  workspaceId: string,
  reportId: string
): Promise<ShowItemsScan> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const visuals: ShowItemsInfo[] = [];
  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const count = stripShowAll(JSON.parse(JSON.stringify(doc)));
    if (count > 0) visuals.push({ page: m[1], visual: m[2], count });
  }
  return { visuals, total: visuals.length };
}

export async function applyShowItems(
  workspaceId: string,
  reportId: string
): Promise<{ changed: number; detail: string }> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  for (const part of parts) {
    if (part.binary) continue;
    if (!VISUAL_PATH_RE.test(part.path)) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    if (stripShowAll(doc) > 0) edits[part.path] = JSON.stringify(doc, null, 2);
  }
  const changed = Object.keys(edits).length;
  if (changed > 0) await saveDefinitionParts('report', workspaceId, reportId, edits);
  return {
    changed,
    detail:
      changed > 0
        ? `Disabled "Show items with no data" on ${changed} visual(s).`
        : 'No visuals have "Show items with no data" enabled.',
  };
}

/* ------------------------------------------------------------------ *
 * A9 — Remove unused custom visuals
 * ------------------------------------------------------------------ */

export interface CustomVisualInfo {
  /** publicCustomVisuals GUID. */
  guid: string;
  used: boolean;
}

export interface CustomVisualScan {
  visuals: CustomVisualInfo[];
  declared: number;
  unused: number;
}

/** Collect the set of custom-visual GUIDs referenced by any visual.json. */
function collectUsedVisualTypes(parts: Array<{ path: string; text: string; binary: boolean }>): Set<string> {
  const used = new Set<string>();
  for (const part of parts) {
    if (part.binary) continue;
    if (!VISUAL_PATH_RE.test(part.path)) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const vt = String(((doc.visual as ObjMap | undefined)?.visualType ?? ''));
    if (vt) used.add(vt);
  }
  return used;
}

export async function scanUnusedCustomVisuals(
  workspaceId: string,
  reportId: string
): Promise<CustomVisualScan> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const reportPart = parts.find((p) => !p.binary && REPORT_JSON_RE.test(p.path));
  const reportDoc = reportPart ? parse(reportPart.text) : null;
  const declared = (reportDoc?.publicCustomVisuals as string[] | undefined) ?? [];
  const used = collectUsedVisualTypes(parts);
  const visuals = declared.map((guid) => ({ guid, used: used.has(guid) }));
  return {
    visuals,
    declared: declared.length,
    unused: visuals.filter((v) => !v.used).length,
  };
}

export async function applyUnusedCustomVisuals(
  workspaceId: string,
  reportId: string
): Promise<{ removed: number; detail: string }> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const reportPart = parts.find((p) => !p.binary && REPORT_JSON_RE.test(p.path));
  if (!reportPart) return { removed: 0, detail: 'No report.json found.' };
  const reportDoc = parse(reportPart.text);
  if (!reportDoc) return { removed: 0, detail: 'report.json is not valid JSON.' };
  const declared = (reportDoc.publicCustomVisuals as string[] | undefined) ?? [];
  if (declared.length === 0) return { removed: 0, detail: 'No custom visuals declared.' };
  const used = collectUsedVisualTypes(parts);
  const kept = declared.filter((guid) => used.has(guid));
  const removed = declared.length - kept.length;
  if (removed === 0) return { removed: 0, detail: 'All custom visuals are in use.' };
  reportDoc.publicCustomVisuals = kept;
  await saveDefinitionParts('report', workspaceId, reportId, {
    [reportPart.path]: JSON.stringify(reportDoc, null, 2),
  });
  return { removed, detail: `Removed ${removed} unused custom visual(s).` };
}

/* ------------------------------------------------------------------ *
 * A7 — Visual alignment
 * ------------------------------------------------------------------ */

const CHART_TYPES = new Set<string>([
  'barChart',
  'clusteredBarChart',
  'stackedBarChart',
  'hundredPercentStackedBarChart',
  'columnChart',
  'clusteredColumnChart',
  'stackedColumnChart',
  'hundredPercentStackedColumnChart',
  'lineChart',
  'areaChart',
  'stackedAreaChart',
  'lineStackedColumnComboChart',
  'lineClusteredColumnComboChart',
  'ribbonChart',
  'waterfallChart',
  'funnel',
  'scatterChart',
  'pieChart',
  'donutChart',
]);

type Axis = 'x' | 'y' | 'width' | 'height';

export interface AlignChange {
  page: string;
  visual: string;
  axis: Axis;
  from: number;
  to: number;
}

export interface AlignScan {
  changes: AlignChange[];
  total: number;
}

interface ChartVisual {
  page: string;
  pageId: string;
  visual: string;
  path: string;
  doc: ObjMap;
  pos: ObjMap;
}

/** Greedily cluster index→value pairs whose values fall within `tol` of the
 *  cluster anchor (first value, ascending). Returns groups of original indices. */
function groupByTolerance(values: number[], tol: number): number[][] {
  const order = values.map((v, i) => ({ i, v })).sort((a, b) => a.v - b.v);
  const groups: number[][] = [];
  if (order.length === 0) return groups;
  let cur = [order[0].i];
  let anchor = order[0].v;
  for (let k = 1; k < order.length; k++) {
    const { i, v } = order[k];
    if (Math.abs(v - anchor) <= tol) {
      cur.push(i);
    } else {
      groups.push(cur);
      cur = [i];
      anchor = v;
    }
  }
  groups.push(cur);
  return groups;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Compute the snap changes for one axis across a set of chart visuals. */
function planAxis(charts: ChartVisual[], axis: Axis, tol: number): AlignChange[] {
  const key = axis;
  const values = charts.map((c) => num(c.pos[key], 0));
  const out: AlignChange[] = [];
  for (const group of groupByTolerance(values, tol)) {
    if (group.length < 2) continue;
    const target = values[group[0]];
    for (let g = 1; g < group.length; g++) {
      const idx = group[g];
      const cur = values[idx];
      if (cur !== target && Math.abs(cur - target) <= tol) {
        out.push({
          page: charts[idx].page,
          visual: charts[idx].visual,
          axis,
          from: cur,
          to: target,
        });
      }
    }
  }
  return out;
}

async function collectChartVisuals(
  workspaceId: string,
  reportId: string
): Promise<{
  byPage: Map<string, { width: number; height: number; display: string; charts: ChartVisual[] }>;
  parts: Awaited<ReturnType<typeof loadDefinitionParts>>;
}> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);

  // Page dimensions keyed by page id.
  const pageDims = new Map<string, { width: number; height: number; display: string }>();
  for (const part of parts) {
    if (part.binary) continue;
    const pm = /definition\/pages\/([^/]+)\/page\.json$/.exec(part.path);
    if (!pm) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    pageDims.set(pm[1], {
      width: num(doc.width, 1280),
      height: num(doc.height, 720),
      display: String(doc.displayName ?? pm[1]),
    });
  }

  const byPage = new Map<
    string,
    { width: number; height: number; display: string; charts: ChartVisual[] }
  >();
  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const visual = (doc.visual ?? {}) as ObjMap;
    if (!CHART_TYPES.has(String(visual.visualType ?? ''))) continue;
    if (doc.isHidden === true) continue;
    const pos = (doc.position ?? {}) as ObjMap;
    const dims = pageDims.get(m[1]) ?? { width: 1280, height: 720, display: m[1] };
    let entry = byPage.get(m[1]);
    if (!entry) {
      entry = { ...dims, charts: [] };
      byPage.set(m[1], entry);
    }
    entry.charts.push({
      page: dims.display,
      pageId: m[1],
      visual: m[2],
      path: part.path,
      doc,
      pos,
    });
  }
  return { byPage, parts };
}

export async function scanAlignment(
  workspaceId: string,
  reportId: string,
  tolerancePct = 2.0
): Promise<AlignScan> {
  const { byPage } = await collectChartVisuals(workspaceId, reportId);
  const changes: AlignChange[] = [];
  for (const page of byPage.values()) {
    if (page.charts.length < 2) continue;
    const tolX = (page.width * tolerancePct) / 100;
    const tolY = (page.height * tolerancePct) / 100;
    changes.push(...planAxis(page.charts, 'width', tolX));
    changes.push(...planAxis(page.charts, 'height', tolY));
    changes.push(...planAxis(page.charts, 'x', tolX));
    changes.push(...planAxis(page.charts, 'y', tolY));
  }
  return { changes, total: changes.length };
}

export async function applyAlignment(
  workspaceId: string,
  reportId: string,
  tolerancePct = 2.0
): Promise<{ changed: number; visuals: number; detail: string }> {
  const { byPage } = await collectChartVisuals(workspaceId, reportId);
  const touched = new Set<string>();
  let changeCount = 0;

  for (const page of byPage.values()) {
    if (page.charts.length < 2) continue;
    const tolX = (page.width * tolerancePct) / 100;
    const tolY = (page.height * tolerancePct) / 100;
    const byVisual = new Map(page.charts.map((c) => [c.visual, c]));
    const all = [
      ...planAxis(page.charts, 'width', tolX),
      ...planAxis(page.charts, 'height', tolY),
      ...planAxis(page.charts, 'x', tolX),
      ...planAxis(page.charts, 'y', tolY),
    ];
    for (const ch of all) {
      const c = byVisual.get(ch.visual);
      if (!c) continue;
      c.pos[ch.axis] = ch.to;
      touched.add(c.path);
      changeCount += 1;
    }
  }

  const edits: Record<string, string> = {};
  for (const page of byPage.values()) {
    for (const c of page.charts) {
      if (touched.has(c.path)) {
        c.doc.position = c.pos;
        edits[c.path] = JSON.stringify(c.doc, null, 2);
      }
    }
  }
  const visuals = Object.keys(edits).length;
  if (visuals > 0) await saveDefinitionParts('report', workspaceId, reportId, edits);
  return {
    changed: changeCount,
    visuals,
    detail:
      changeCount > 0
        ? `Snapped ${changeCount} edge(s) across ${visuals} visual(s).`
        : 'All chart visuals are already aligned within tolerance.',
  };
}

/* ------------------------------------------------------------------ *
 * A8 — Migrate report-level measures into the semantic model
 * ------------------------------------------------------------------ */

interface RawEntity {
  name?: string;
  measures?: ObjMap[];
}

export interface ReportMeasureInfo {
  table: string;
  measure: string;
  /** DAX expression length (chars). */
  exprLen: number;
  /** True when the expression spans multiple lines. */
  multiline: boolean;
}

export interface ReportMeasureScan {
  measures: ReportMeasureInfo[];
  total: number;
}

export interface MigrateMeasuresResult {
  migrated: number;
  skipped: string[];
  detail: string;
}

/** Locate and parse the report's `reportExtensions.json` part. */
function readReportExtensions(
  parts: Awaited<ReturnType<typeof loadDefinitionParts>>
): { path: string; doc: ObjMap; entities: RawEntity[] } | null {
  for (const part of parts) {
    if (part.binary) continue;
    if (!REPORT_EXT_RE.test(part.path)) continue;
    const doc = parse(part.text);
    if (!doc) return null;
    const entities = (doc.entities as RawEntity[] | undefined) ?? [];
    return { path: part.path, doc, entities };
  }
  return null;
}

export async function scanReportLevelMeasures(
  workspaceId: string,
  reportId: string
): Promise<ReportMeasureScan> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const ext = readReportExtensions(parts);
  const measures: ReportMeasureInfo[] = [];
  if (ext) {
    for (const entity of ext.entities) {
      const table = entity.name ?? '';
      for (const m of entity.measures ?? []) {
        const name = (m.name as string | undefined) ?? '';
        const expr = (m.expression as string | undefined) ?? '';
        measures.push({ table, measure: name, exprLen: expr.length, multiline: /\n/.test(expr) });
      }
    }
  }
  return { measures, total: measures.length };
}

/**
 * Move every report-level measure into the report's bound semantic model and
 * remove it from `reportExtensions.json`. Measures whose home table is missing
 * from the model are left in place and reported as skipped. Measures that
 * already exist in the model are treated as migrated (the redundant
 * report-level copy is removed). Empty entities are dropped.
 */
export async function applyReportLevelMeasures(
  workspaceId: string,
  reportId: string,
  datasetId: string
): Promise<MigrateMeasuresResult> {
  if (!datasetId) {
    return {
      migrated: 0,
      skipped: [],
      detail:
        'No bound semantic model resolved — select a report whose model lives in the same workspace.',
    };
  }

  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const ext = readReportExtensions(parts);
  if (!ext || ext.entities.length === 0) {
    return { migrated: 0, skipped: [], detail: 'No report-level measures found.' };
  }

  let migrated = 0;
  const skipped: string[] = [];

  for (const entity of ext.entities) {
    const table = entity.name ?? '';
    const remaining: ObjMap[] = [];
    for (const m of entity.measures ?? []) {
      const name = (m.name as string | undefined) ?? '';
      const expression = (m.expression as string | undefined) ?? '';
      const values: MeasureValues = {
        name,
        expression,
        formatString: (m.formatString as string | undefined) ?? '',
        displayFolder: (m.displayFolder as string | undefined) ?? '',
        description: '',
        isHidden: false,
      };
      const res = await createMeasure(workspaceId, datasetId, table, values);
      if (res.changed > 0 || /already exists/i.test(res.detail)) {
        // Created, or already present in the model → drop the report-level copy.
        migrated += 1;
      } else {
        // Table not found (or no write) → leave the measure in the report.
        skipped.push(`${table}[${name}] — ${res.detail}`);
        remaining.push(m);
      }
    }
    entity.measures = remaining;
  }

  // Keep only entities that still carry measures.
  const keptEntities = ext.entities.filter(
    (e) => Array.isArray(e.measures) && (e.measures as unknown[]).length > 0
  );
  ext.doc.entities = keptEntities;

  if (migrated > 0) {
    await saveDefinitionParts('report', workspaceId, reportId, {
      [ext.path]: JSON.stringify(ext.doc, null, 2),
    });
  }

  return {
    migrated,
    skipped,
    detail:
      migrated > 0
        ? `Migrated ${migrated} report-level measure(s) into the model${
            skipped.length ? `, skipped ${skipped.length}` : ''
          }.`
        : skipped.length
          ? `Nothing migrated — ${skipped.length} skipped (home table not in model).`
          : 'No report-level measures found.',
  };
}

/* ------------------------------------------------------------------ *
 * A11 — Upgrade report to PBIR format
 * ------------------------------------------------------------------ */

export interface ReportFormatScan {
  /** Raw storage format reported by Fabric, e.g. "PBIR" or "PBIRLegacy". */
  format: string;
  /** True when the report is in legacy format and can be upgraded. */
  eligible: boolean;
  /** True when the report is already in PBIR format. */
  alreadyPbir: boolean;
}

export interface UpgradeResult {
  upgraded: boolean;
  detail: string;
}

/** Read the storage format of the report (read-only preview). */
export async function scanReportFormat(
  workspaceId: string,
  reportId: string
): Promise<ReportFormatScan> {
  const format = await getReportFormat(workspaceId, reportId);
  return {
    format,
    eligible: format === 'PBIRLegacy',
    alreadyPbir: format === 'PBIR',
  };
}

/**
 * Upgrade a PBIRLegacy report to PBIR via a getDefinition → updateDefinition
 * round-trip, then poll the reports list (up to ~60s) until the format flips.
 */
export async function applyUpgradeToPbir(
  workspaceId: string,
  reportId: string
): Promise<UpgradeResult> {
  const format = await getReportFormat(workspaceId, reportId);
  if (format === 'PBIR') {
    return { upgraded: false, detail: 'Report is already in PBIR format — no upgrade needed.' };
  }
  if (format !== 'PBIRLegacy') {
    return {
      upgraded: false,
      detail: `Report is in "${format || 'unknown'}" format. Only PBIRLegacy reports can be upgraded to PBIR.`,
    };
  }

  await upgradeReportToPbir(workspaceId, reportId);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const next = await getReportFormat(workspaceId, reportId);
    if (next === 'PBIR') {
      return { upgraded: true, detail: 'Report upgraded to PBIR format.' };
    }
  }
  return {
    upgraded: true,
    detail: 'Upgrade submitted — format change is still processing. Check the workspace shortly.',
  };
}

/* ------------------------------------------------------------------ *
 * A12 helper — Shorten tall report pages
 * ------------------------------------------------------------------ */

const PAGE_PATH_RE = /definition\/pages\/([^/]+)\/page\.json$/;
const MAX_PAGE_HEIGHT = 720;

/**
 * Clamp every report page taller than {@link MAX_PAGE_HEIGHT} down to that
 * height, removing the vertical scroll the "Avoid tall report pages" BPA rule
 * flags. One save round-trip; only changed pages are written.
 */
export async function applyTallPages(
  workspaceId: string,
  reportId: string
): Promise<{ changed: number; detail: string }> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  for (const part of parts) {
    if (part.binary) continue;
    if (!PAGE_PATH_RE.test(part.path)) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const height = num(doc.height, 0);
    if (height > MAX_PAGE_HEIGHT) {
      doc.height = MAX_PAGE_HEIGHT;
      edits[part.path] = JSON.stringify(doc, null, 2);
    }
  }
  const changed = Object.keys(edits).length;
  if (changed > 0) await saveDefinitionParts('report', workspaceId, reportId, edits);
  return {
    changed,
    detail:
      changed > 0
        ? `Reduced height to ${MAX_PAGE_HEIGHT}px on ${changed} tall page(s).`
        : 'No report pages exceed the recommended height.',
  };
}
