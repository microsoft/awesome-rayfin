// Report BPA engine — mirrors `sempy_labs.report.run_report_bpa`.
//
// `extractReportModel` turns the report's PBIR definition parts into the same
// per-scope object lists the Python ReportWrapper exposes (pages, visuals,
// custom visuals, report/page/visual filters, report-level measures).
// `runReportBpa` then evaluates each rule predicate across its scope(s) and
// emits violations, exactly as the source `execute_rule` does.

import type {
  ReportBpaRule,
  ReportBpaScope,
  ReportBpaViolation,
  ReportModel,
  ReportScopeObj,
  PageObj,
  VisualObj,
  CustomVisualObj,
  FilterObj,
  ReportLevelMeasureObj,
} from './types';

type ObjMap = Record<string, unknown>;

export interface RawPart {
  path: string;
  text: string;
  binary: boolean;
}

const VISUAL_PATH_RE = /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/;
const PAGE_PATH_RE = /definition\/pages\/([^/]+)\/page\.json$/;
const REPORT_JSON_RE = /definition\/report\.json$/;
const REPORT_EXT_RE = /definition\/reportExtensions\.json$/;

function parse(text: string): ObjMap | null {
  try {
    return JSON.parse(text) as ObjMap;
  } catch {
    return null;
  }
}

/** Count `showAll` keys anywhere in a visual document (read-only A6 probe). */
function countShowAll(node: unknown): number {
  if (Array.isArray(node)) {
    let n = 0;
    for (const item of node) n += countShowAll(item);
    return n;
  }
  if (node && typeof node === 'object') {
    const obj = node as ObjMap;
    let n = 'showAll' in obj ? 1 : 0;
    for (const v of Object.values(obj)) n += countShowAll(v);
    return n;
  }
  return 0;
}

/** Number of field projections across every query role of a visual. */
function countProjections(visual: ObjMap): number {
  const qs = (((visual.query as ObjMap | undefined)?.queryState as ObjMap | undefined) ??
    {}) as ObjMap;
  let n = 0;
  for (const role of Object.values(qs)) {
    const projs = ((role as ObjMap | undefined)?.projections as unknown[] | undefined) ?? [];
    n += projs.length;
  }
  return n;
}

/** Classify a filter's field as Measure / Column / Aggregation. */
function filterObjectType(filter: ObjMap): string {
  const f = (filter.field as ObjMap | undefined) ?? {};
  if ('Measure' in f) return 'Measure';
  if ('Aggregation' in f) return 'Aggregation';
  if ('Column' in f) return 'Column';
  return 'Unknown';
}

/** Build a "Entity[Property]" label for a filter's field. */
function filterLabel(filter: ObjMap): string {
  const f = (filter.field as ObjMap | undefined) ?? {};
  const agg = f.Aggregation as ObjMap | undefined;
  const node =
    (f.Measure as ObjMap | undefined) ??
    (f.Column as ObjMap | undefined) ??
    ((agg?.Column as ObjMap | undefined) ?? undefined) ??
    {};
  const entity =
    (((node?.Expression as ObjMap | undefined)?.SourceRef as ObjMap | undefined)?.Entity as
      | string
      | undefined) ?? '';
  const prop = (node?.Property as string | undefined) ?? '';
  if (entity && prop) return `${entity}[${prop}]`;
  return prop || (filter.name as string | undefined) || '(filter)';
}

function readFilters(
  doc: ObjMap,
  scope: 'Report Filter' | 'Page Filter' | 'Visual Filter',
  prefix: string
): FilterObj[] {
  const cfg = doc.filterConfig as ObjMap | undefined;
  const filters = (cfg?.filters as ObjMap[] | undefined) ?? [];
  return filters.map((f) => ({
    __scope: scope,
    label: prefix ? `${prefix} : ${filterLabel(f)}` : filterLabel(f),
    objectType: filterObjectType(f),
    filterType: String(f.type ?? ''),
  }));
}

/**
 * Build the per-scope object model from a report's PBIR definition parts.
 */
export function extractReportModel(parts: RawPart[]): ReportModel {
  const pages: PageObj[] = [];
  const visuals: VisualObj[] = [];
  const filters: FilterObj[] = [];
  const reportLevelMeasures: ReportLevelMeasureObj[] = [];

  // Map pageId → displayName so visuals can render a friendly page label, and
  // pageId → visible visual tally for the page-level count rule.
  const pageDisplay = new Map<string, string>();
  const visibleByPage = new Map<string, number>();
  const usedVisualTypes = new Set<string>();

  // First pass: pages.
  for (const part of parts) {
    if (part.binary) continue;
    const pm = PAGE_PATH_RE.exec(part.path);
    if (!pm) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const id = (doc.name as string | undefined) ?? pm[1];
    const display = (doc.displayName as string | undefined) ?? id;
    pageDisplay.set(pm[1], display);
    filters.push(...readFilters(doc, 'Page Filter', display));
  }

  // Second pass: visuals (also tallies visible visuals + used visual types).
  for (const part of parts) {
    if (part.binary) continue;
    const vm = VISUAL_PATH_RE.exec(part.path);
    if (!vm) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const pageId = vm[1];
    const visualId = vm[2];
    const visual = (doc.visual as ObjMap | undefined) ?? {};
    const visualType = String(visual.visualType ?? '');
    if (visualType) usedVisualTypes.add(visualType);

    const hidden = doc.isHidden === true;
    if (!hidden) visibleByPage.set(pageId, (visibleByPage.get(pageId) ?? 0) + 1);

    const display = pageDisplay.get(pageId) ?? pageId;
    visuals.push({
      __scope: 'Visual',
      page: pageId,
      pageDisplay: display,
      name: (doc.name as string | undefined) ?? visualId,
      visualType,
      objectCount: countProjections(visual),
      showItemsWithNoData: countShowAll(visual) > 0,
      isCustomVisual: false, // set after custom-visual GUIDs are known
    });

    filters.push(
      ...readFilters(doc, 'Visual Filter', `${display} / ${(doc.name as string) ?? visualId}`)
    );
  }

  // Re-scan page docs for height/width (kept separate so visibleByPage is ready).
  for (const part of parts) {
    if (part.binary) continue;
    const pm = PAGE_PATH_RE.exec(part.path);
    if (!pm) continue;
    const doc = parse(part.text);
    if (!doc) continue;
    const id = (doc.name as string | undefined) ?? pm[1];
    const display = (doc.displayName as string | undefined) ?? id;
    pages.push({
      __scope: 'Page',
      name: id,
      displayName: display,
      height: Number(doc.height ?? 0),
      width: Number(doc.width ?? 0),
      visibleVisualCount: visibleByPage.get(pm[1]) ?? 0,
    });
  }

  // report.json: custom visuals + report-level filters.
  const reportPart = parts.find((p) => !p.binary && REPORT_JSON_RE.test(p.path));
  const reportDoc = reportPart ? parse(reportPart.text) : null;
  const declaredCv = (reportDoc?.publicCustomVisuals as string[] | undefined) ?? [];
  const customVisuals: CustomVisualObj[] = declaredCv.map((guid) => ({
    __scope: 'Custom Visual',
    name: guid,
    usedInReport: usedVisualTypes.has(guid),
  }));
  if (reportDoc) filters.push(...readFilters(reportDoc, 'Report Filter', ''));

  // Mark visuals that render through a declared custom visual.
  const cvSet = new Set(declaredCv);
  for (const v of visuals) v.isCustomVisual = cvSet.has(v.visualType);

  // reportExtensions.json: report-level measures.
  const extPart = parts.find((p) => !p.binary && REPORT_EXT_RE.test(p.path));
  const extDoc = extPart ? parse(extPart.text) : null;
  const entities = (extDoc?.entities as ObjMap[] | undefined) ?? [];
  for (const entity of entities) {
    const table = (entity.name as string | undefined) ?? '';
    const measures = (entity.measures as ObjMap[] | undefined) ?? [];
    for (const m of measures) {
      reportLevelMeasures.push({
        __scope: 'Report Level Measure',
        name: (m.name as string | undefined) ?? '',
        table,
      });
    }
  }

  return { pages, visuals, customVisuals, filters, reportLevelMeasures };
}

function scopeObjects(model: ReportModel, scope: ReportBpaScope): ReportScopeObj[] {
  switch (scope) {
    case 'Page':
      return model.pages;
    case 'Visual':
      return model.visuals;
    case 'Custom Visual':
      return model.customVisuals;
    case 'Report Level Measure':
      return model.reportLevelMeasures;
    case 'Report Filter':
    case 'Page Filter':
    case 'Visual Filter':
      return model.filters.filter((f) => f.__scope === scope);
    default:
      return [];
  }
}

function objectName(obj: ReportScopeObj): string {
  switch (obj.__scope) {
    case 'Page':
      return (obj as PageObj).displayName;
    case 'Visual': {
      const v = obj as VisualObj;
      return `${v.pageDisplay} / ${v.name}`;
    }
    case 'Custom Visual':
      return (obj as CustomVisualObj).name;
    case 'Report Level Measure': {
      const m = obj as ReportLevelMeasureObj;
      return m.table ? `${m.table}[${m.name}]` : m.name;
    }
    default:
      return (obj as FilterObj).label;
  }
}

/**
 * Run the report BPA rules against an extracted report model and return
 * violations. Synchronous, in-browser pass — no server round-trip.
 */
export function runReportBpa(model: ReportModel, rules: ReportBpaRule[]): ReportBpaViolation[] {
  const out: ReportBpaViolation[] = [];
  for (const rule of rules) {
    const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
    for (const scope of scopes) {
      for (const obj of scopeObjects(model, scope)) {
        if (!rule.predicate(obj)) continue;
        out.push({
          category: rule.category,
          ruleName: rule.name,
          severity: rule.severity,
          description: rule.description,
          url: rule.url,
          objectType: scope,
          objectName: objectName(obj),
        });
      }
    }
  }
  return out;
}

/** Stable slug from a rule name (id for findings/keys). */
export function ruleSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
