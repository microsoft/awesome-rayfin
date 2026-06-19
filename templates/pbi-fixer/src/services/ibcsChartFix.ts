// IBCS chart formatting for NATIVE Power BI cartesian charts (bar / column / line).
//
// This is the report-side companion to `ibcsVisualFix.ts` (which swaps the two
// self-developed IBCS Multi-Tier CUSTOM visuals). Here we work on the built-in
// Power BI chart types and apply the shared IBCS / Hichert minimalist style:
//   • hide axis titles (redundant — the title already names the measure)
//   • hide the value axis and drop gridlines (data labels carry the numbers)
//   • turn data labels on
//   • keep the category axis labels
// Line charts keep their value axis (A3 — "keep Y values").
//
// Orientation rule (IBCS: time flows left→right):
//   • bar chart on a TIME category  → column chart        (A1)
//   • column chart on a NON-time    → bar chart           (A2)
//   • column chart on a full DATE   → line chart          (A2 — "date → line")
//   • line chart                    → left as-is          (A3)
//
// All patches go through one load/save round-trip per apply. Because we mutate
// the parsed `visual.objects` tree we re-serialise the visual.json (2-space
// indent, matching the PBIR on-disk format); Fabric ignores whitespace.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';

export type ChartFamily = 'bar' | 'column' | 'line';

const BAR_TYPES = [
  'barChart',
  'clusteredBarChart',
  'stackedBarChart',
  'hundredPercentStackedBarChart',
];
const COLUMN_TYPES = [
  'columnChart',
  'clusteredColumnChart',
  'stackedColumnChart',
  'hundredPercentStackedColumnChart',
];
const LINE_TYPES = ['lineChart'];

// Tokens that mark a category projection as a time dimension (German + English).
const TIME_TOKENS = [
  'jahr',
  'year',
  'monat',
  'month',
  'datum',
  'date',
  'quartal',
  'quarter',
  'woche',
  'week',
  'yearmonth',
  'tag',
  'day',
];

// Tokens that mark a category as a full, continuous date (→ line chart).
const DATE_TOKENS = ['datum', 'date', 'tag', 'day'];

export interface ChartFixInfo {
  page: string;
  visual: string;
  /** Current chart family. */
  family: ChartFamily;
  /** Best-guess category column property (the axis dimension). */
  category: string;
  /** IBCS formatting differs from the current visual.json. */
  needsFormat: boolean;
  /** Recommended target family if the orientation rule disagrees, else null. */
  reorientTo: ChartFamily | null;
}

export interface ChartScanResult {
  visuals: ChartFixInfo[];
  total: number;
  needsFormat: number;
  needsReorient: number;
}

export interface ChartFixResult {
  changed: number;
  formatted: number;
  reoriented: number;
  detail: string;
}

export interface ChartFixOptions {
  /** A1 — include native bar charts. */
  bar: boolean;
  /** A2 — include native column charts. */
  column: boolean;
  /** A3 — include native line charts. */
  line: boolean;
  /** Apply the time-horizontal / category-vertical orientation rule. */
  reorient: boolean;
}

export const DEFAULT_CHART_FIX_OPTIONS: ChartFixOptions = {
  bar: true,
  column: true,
  line: true,
  reorient: true,
};

const VISUAL_PATH_RE = /definition\/pages\/([^/]+)\/visuals\/([^/]+)\/visual\.json$/;

function familyOf(visualType: string): ChartFamily | null {
  if (BAR_TYPES.includes(visualType)) return 'bar';
  if (COLUMN_TYPES.includes(visualType)) return 'column';
  if (LINE_TYPES.includes(visualType)) return 'line';
  return null;
}

function isTimeProperty(prop: string): boolean {
  const p = prop.toLowerCase();
  return TIME_TOKENS.some((t) => p.includes(t));
}

function isDateProperty(prop: string): boolean {
  const p = prop.toLowerCase();
  return DATE_TOKENS.some((t) => p.includes(t));
}

/** First Column projection property found in a visual — the category axis. */
function findCategoryColumn(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  const col = obj['Column'] as { Property?: string } | undefined;
  if (col && typeof col.Property === 'string') return col.Property;
  for (const v of Object.values(obj)) {
    const found = findCategoryColumn(v);
    if (found) return found;
  }
  return null;
}

/** Recommended target family given the current family + category dimension. */
function recommendFamily(family: ChartFamily, category: string | null): ChartFamily {
  if (!category) return family;
  if (family === 'bar') {
    return isTimeProperty(category) ? 'column' : 'bar';
  }
  if (family === 'column') {
    if (isDateProperty(category)) return 'line';
    if (!isTimeProperty(category)) return 'bar';
    return 'column';
  }
  return 'line'; // line charts are left as-is
}

/** Map a chart's visualType GUID/name to the equivalent name in another family.
 *  Preserves the clustered/stacked prefix where it exists. */
function convertVisualType(visualType: string, target: ChartFamily): string {
  if (target === 'line') return 'lineChart';
  if (target === 'column') {
    return visualType.replace(/Bar/g, 'Column').replace(/bar/g, 'column');
  }
  // target === 'bar'
  if (LINE_TYPES.includes(visualType)) return 'clusteredBarChart';
  return visualType.replace(/Column/g, 'Bar').replace(/column/g, 'bar');
}

function litBool(v: boolean): Record<string, unknown> {
  return { expr: { Literal: { Value: v ? 'true' : 'false' } } };
}

type ObjMap = Record<string, unknown>;

/** Ensure `objects[key]` is a non-empty array whose first entry has a
 *  `properties` object; return that properties object. */
function ensureProperties(objects: ObjMap, key: string): ObjMap {
  let arr = objects[key] as Array<ObjMap> | undefined;
  if (!Array.isArray(arr) || arr.length === 0) {
    arr = [{ properties: {} }];
    objects[key] = arr;
  }
  if (!arr[0].properties || typeof arr[0].properties !== 'object') {
    arr[0].properties = {};
  }
  return arr[0].properties as ObjMap;
}

/** Apply the IBCS minimalist style to a parsed visual for the given family.
 *  Returns true if anything actually changed. */
function applyIbcsFormat(visual: ObjMap, family: ChartFamily): boolean {
  const objects = (visual.objects ??= {}) as ObjMap;
  let changed = false;

  const setBool = (props: ObjMap, name: string, value: boolean) => {
    const desired = JSON.stringify(litBool(value));
    if (JSON.stringify(props[name]) !== desired) {
      props[name] = litBool(value);
      changed = true;
    }
  };

  // Category axis: keep the labels, drop the title and gridlines.
  const cat = ensureProperties(objects, 'categoryAxis');
  setBool(cat, 'show', true);
  setBool(cat, 'showAxisTitle', false);
  setBool(cat, 'gridlineShow', false);

  // Value axis: hide for bar/column (labels carry the numbers); keep for line.
  const val = ensureProperties(objects, 'valueAxis');
  setBool(val, 'show', family === 'line');
  setBool(val, 'showAxisTitle', false);
  setBool(val, 'gridlineShow', false);

  // Data labels on.
  const labels = ensureProperties(objects, 'labels');
  setBool(labels, 'show', true);

  return changed;
}

function familyAllowed(family: ChartFamily, options: ChartFixOptions): boolean {
  return (
    (family === 'bar' && options.bar) ||
    (family === 'column' && options.column) ||
    (family === 'line' && options.line)
  );
}

/** Scan a report's native cartesian charts and report which need IBCS
 *  formatting and/or an orientation change. */
export async function scanChartFixes(
  workspaceId: string,
  reportId: string,
  options: ChartFixOptions = DEFAULT_CHART_FIX_OPTIONS
): Promise<ChartScanResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const visuals: ChartFixInfo[] = [];

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: ObjMap;
    try {
      doc = JSON.parse(part.text) as ObjMap;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as ObjMap;
    const family = familyOf(String(visual.visualType ?? ''));
    if (!family || !familyAllowed(family, options)) continue;

    const category = findCategoryColumn(visual) ?? '';
    const target = options.reorient ? recommendFamily(family, category || null) : family;

    // Probe formatting on a deep copy so the scan stays read-only.
    const probe = JSON.parse(JSON.stringify(visual)) as ObjMap;
    const needsFormat = applyIbcsFormat(probe, target);

    visuals.push({
      page: m[1],
      visual: m[2],
      family,
      category,
      needsFormat,
      reorientTo: target !== family ? target : null,
    });
  }

  return {
    visuals,
    total: visuals.length,
    needsFormat: visuals.filter((v) => v.needsFormat).length,
    needsReorient: visuals.filter((v) => v.reorientTo).length,
  };
}

/** Apply IBCS formatting (+ optional orientation) to the report's native
 *  cartesian charts. One round trip. */
export async function applyChartFixes(
  workspaceId: string,
  reportId: string,
  options: ChartFixOptions = DEFAULT_CHART_FIX_OPTIONS
): Promise<ChartFixResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  let formatted = 0;
  let reoriented = 0;

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: ObjMap;
    try {
      doc = JSON.parse(part.text) as ObjMap;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as ObjMap;
    const currentType = String(visual.visualType ?? '');
    const family = familyOf(currentType);
    if (!family || !familyAllowed(family, options)) continue;

    const category = findCategoryColumn(visual);
    const target = options.reorient ? recommendFamily(family, category) : family;

    let touched = false;
    if (target !== family) {
      const newType = convertVisualType(currentType, target);
      if (newType !== currentType) {
        visual.visualType = newType;
        reoriented += 1;
        touched = true;
      }
    }
    if (applyIbcsFormat(visual, target)) {
      formatted += 1;
      touched = true;
    }

    if (touched) {
      edits[part.path] = JSON.stringify(doc, null, 2);
    }
  }

  const changed = Object.keys(edits).length
    ? await saveDefinitionParts('report', workspaceId, reportId, edits)
    : 0;

  return {
    changed,
    formatted,
    reoriented,
    detail:
      changed > 0
        ? `IBCS-styled ${formatted} chart(s)` +
          (reoriented > 0 ? ` and re-oriented ${reoriented} to match its category axis.` : '.')
        : formatted === 0 && reoriented === 0
          ? 'All native charts already follow the IBCS style (or none were found).'
          : 'No change was written.',
  };
}

// =========================================================================== //
// A4 — Fix_IBCSVariance: integrated-variance styling on native bar/column charts
//
// Ported from `sempy_labs.report._Fix_IBCSVariance`. For every bar/column chart
// that plots exactly ONE actuals (AC) measure we turn it into an IBCS
// integrated-variance chart:
//   • stacked → clustered (column → bar for non-time category)
//   • add the `<AC> PY` measure to the Y axis (behind AC in the overlap)
//   • red/green deviation error bars driven by `<AC> Max Red AC` / `<AC> Max Green PY`
//   • IBCS data-point colors (AC dark grey, PY light grey)
//   • overlap layout, white label backgrounds, hidden value axis
//   • bar charts sorted descending by the AC measure
//
// The four supporting measures (`<AC> PY`, `<AC> Δ PY`, `<AC> Max Green PY`,
// `<AC> Max Red AC`) are created on the model by the "Previous-year & variance
// measures" tool (ibcsModel.generateTimeIntelligence with `errorBars`). This
// fixer is report-only: it references those measures by their conventional
// names. Missing measures simply leave the error bars un-bound — the clustered
// layout, PY series, colors and sort still apply.
// =========================================================================== //

/** Suffixes that mark a measure as PY-derived (i.e. NOT an actuals measure). */
const PY_SUFFIXES = [' PY', ' Δ PY', ' Δ PY %', ' Δ% PY', ' Max Green PY', ' Max Red AC'];

const AC_COLOR = '#404040';
const PY_COLOR = '#A0A0A0';
const ERROR_RED = '#FF0000';
const ERROR_GREEN = '#92D050';

const VARIANCE_TARGET_TYPES = ['barChart', 'clusteredBarChart', 'columnChart', 'clusteredColumnChart'];

function litExpr(value: string): Record<string, unknown> {
  return { expr: { Literal: { Value: value } } };
}

function litColor(hex: string): Record<string, unknown> {
  return { solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } };
}

function measureRef(table: string, measure: string): Record<string, unknown> {
  return { expr: { Measure: { Expression: { SourceRef: { Entity: table } }, Property: measure } } };
}

function getYProjections(visual: ObjMap): ObjMap[] {
  const query = (visual.query ?? {}) as ObjMap;
  const queryState = (query.queryState ?? {}) as ObjMap;
  const y = (queryState.Y ?? {}) as ObjMap;
  const projections = y.projections;
  return Array.isArray(projections) ? (projections as ObjMap[]) : [];
}

/** Extract `{ table, name }` for a Measure projection, else null. */
function measureFromProj(proj: ObjMap): { table: string; name: string } | null {
  const field = (proj.field ?? {}) as ObjMap;
  const measure = (field.Measure ?? {}) as ObjMap;
  const prop = measure.Property;
  const expr = (measure.Expression ?? {}) as ObjMap;
  const sourceRef = (expr.SourceRef ?? {}) as ObjMap;
  const entity = sourceRef.Entity;
  if (typeof prop === 'string' && typeof entity === 'string') return { table: entity, name: prop };
  return null;
}

/** Category column projections → `{ table, column }[]`. */
function getCategoryFields(visual: ObjMap): { table: string; column: string }[] {
  const query = (visual.query ?? {}) as ObjMap;
  const queryState = (query.queryState ?? {}) as ObjMap;
  const cat = (queryState.Category ?? {}) as ObjMap;
  const projections = cat.projections;
  const out: { table: string; column: string }[] = [];
  if (!Array.isArray(projections)) return out;
  for (const proj of projections as ObjMap[]) {
    const field = (proj.field ?? {}) as ObjMap;
    const col = (field.Column ?? {}) as ObjMap;
    const prop = col.Property;
    const expr = (col.Expression ?? {}) as ObjMap;
    const sourceRef = (expr.SourceRef ?? {}) as ObjMap;
    const entity = sourceRef.Entity;
    if (typeof prop === 'string' && typeof entity === 'string') out.push({ table: entity, column: prop });
  }
  return out;
}

function isAcMeasure(name: string): boolean {
  return !PY_SUFFIXES.some((s) => name.endsWith(s));
}

/** Red (negative) + green (positive) deviation error-bar objects array. */
function buildErrorBarConfig(
  acTable: string,
  acMeasure: string,
  pyMeasure: string,
  maxRed: string,
  maxGreen: string
): ObjMap[] {
  const acMeta = `${acTable}.${acMeasure}`;
  const pyMeta = `${acTable}.${pyMeasure}`;
  return [
    {
      properties: {
        errorRange: {
          kind: 'ErrorRange',
          explicit: { isRelative: litExpr('false'), upperBound: measureRef(acTable, maxRed) },
        },
      },
      selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: acMeta, highlightMatching: 1 },
    },
    {
      properties: {
        enabled: litExpr('true'),
        barColor: litColor(ERROR_RED),
        barWidth: litExpr('10D'),
        markerShow: litExpr('false'),
        tooltipShow: litExpr('false'),
        barBorderSize: litExpr('0L'),
      },
      selector: { metadata: acMeta },
    },
    {
      properties: {
        errorRange: {
          kind: 'ErrorRange',
          explicit: { isRelative: litExpr('false'), upperBound: measureRef(acTable, maxGreen) },
        },
      },
      selector: { data: [{ dataViewWildcard: { matchingOption: 0 } }], metadata: pyMeta, highlightMatching: 1 },
    },
    {
      properties: {
        enabled: litExpr('true'),
        barColor: litColor(ERROR_GREEN),
        barWidth: litExpr('10D'),
        markerShow: litExpr('false'),
        markerSize: litExpr('5D'),
        barBorderColor: litColor(ERROR_GREEN),
        barBorderSize: litExpr('0L'),
        tooltipShow: litExpr('false'),
      },
      selector: { metadata: pyMeta },
    },
  ];
}

/** AC labels with a white background; PY labels hidden. */
function buildLabelConfig(pyMeta: string): ObjMap[] {
  return [
    {
      properties: {
        show: litExpr('true'),
        enableBackground: litExpr('true'),
        backgroundColor: litColor('#FFFFFF'),
        backgroundTransparency: litExpr('50D'),
      },
    },
    { properties: { showSeries: litExpr('false') }, selector: { metadata: pyMeta } },
  ];
}

/** AC dark grey, PY light grey. */
function buildDataPointConfig(acMeta: string, pyMeta: string): ObjMap[] {
  return [
    { properties: { fill: litColor(AC_COLOR) }, selector: { metadata: acMeta } },
    { properties: { fill: litColor(PY_COLOR) }, selector: { metadata: pyMeta } },
  ];
}

/** Overlap enabled, 40% gap between series. */
function buildLayoutConfig(): ObjMap[] {
  return [{ properties: { clusteredGapOverlaps: litExpr('true'), clusteredGapSize: litExpr('40D') } }];
}

function buildPyProjection(acTable: string, pyMeasure: string): ObjMap {
  return {
    field: { Measure: { Expression: { SourceRef: { Entity: acTable } }, Property: pyMeasure } },
    queryRef: `${acTable}.${pyMeasure}`,
    nativeQueryRef: pyMeasure,
  };
}

/** Sort the visual descending by the AC measure (bar charts only). */
function setSortDescending(visual: ObjMap, acTable: string, acMeasure: string): void {
  const query = (visual.query ??= {}) as ObjMap;
  query.sortDefinition = {
    sort: [
      {
        field: { Measure: { Expression: { SourceRef: { Entity: acTable } }, Property: acMeasure } },
        direction: 'Descending',
      },
    ],
    isDefaultSort: true,
  };
}

export interface VarianceFixInfo {
  page: string;
  visual: string;
  /** Home table of the AC measure. */
  acTable: string;
  /** The single actuals measure plotted on the Y axis. */
  acMeasure: string;
  /** Whether the chart will end up as a bar (vs column) variant. */
  isBar: boolean;
  /** The `<AC> PY` series is already on the Y axis. */
  hasPy: boolean;
  /** The error-bar / variance styling is already present. */
  styled: boolean;
}

export interface VarianceScanResult {
  candidates: VarianceFixInfo[];
  /** Visuals skipped because they carry more than one AC measure. */
  ambiguous: number;
}

export interface VarianceFixResult {
  changed: number;
  fixed: number;
  detail: string;
}

/** Decide the bar/column target for a candidate from its category axis. */
function varianceIsBar(visualType: string, categoryFields: { column: string }[]): boolean {
  if (visualType === 'barChart' || visualType === 'clusteredBarChart') return true;
  const isTime = categoryFields.some((c) => isTimeProperty(c.column));
  return !isTime;
}

/** Scan a report for bar/column charts that can take IBCS variance styling. */
export async function scanVarianceFixes(
  workspaceId: string,
  reportId: string
): Promise<VarianceScanResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const candidates: VarianceFixInfo[] = [];
  let ambiguous = 0;

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: ObjMap;
    try {
      doc = JSON.parse(part.text) as ObjMap;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as ObjMap;
    const vtype = String(visual.visualType ?? '');
    if (!VARIANCE_TARGET_TYPES.includes(vtype)) continue;

    const yProjs = getYProjections(visual);
    const acMeasures = yProjs
      .map(measureFromProj)
      .filter((x): x is { table: string; name: string } => !!x && isAcMeasure(x.name));
    if (acMeasures.length !== 1) {
      if (acMeasures.length > 1) ambiguous += 1;
      continue;
    }

    const { table: acTable, name: acMeasure } = acMeasures[0];
    const isBar = varianceIsBar(vtype, getCategoryFields(visual));
    const pyMeasure = `${acMeasure} PY`;
    const hasPy = yProjs.some((p) => {
      const info = measureFromProj(p);
      return !!info && info.table === acTable && info.name === pyMeasure;
    });
    const objects = (visual.objects ?? {}) as ObjMap;
    const styled = Array.isArray(objects.error) && (objects.error as unknown[]).length > 0;

    candidates.push({ page: m[1], visual: m[2], acTable, acMeasure, isBar, hasPy, styled });
  }

  return { candidates, ambiguous };
}

/** Apply IBCS integrated-variance styling to the report's bar/column charts. */
export async function applyVarianceFixes(
  workspaceId: string,
  reportId: string
): Promise<VarianceFixResult> {
  const parts = await loadDefinitionParts('report', workspaceId, reportId);
  const edits: Record<string, string> = {};
  let fixed = 0;

  for (const part of parts) {
    if (part.binary) continue;
    const m = VISUAL_PATH_RE.exec(part.path);
    if (!m) continue;
    let doc: ObjMap;
    try {
      doc = JSON.parse(part.text) as ObjMap;
    } catch {
      continue;
    }
    const visual = (doc.visual ?? {}) as ObjMap;
    const vtype = String(visual.visualType ?? '');
    if (!VARIANCE_TARGET_TYPES.includes(vtype)) continue;

    const yProjs = getYProjections(visual);
    const acMeasures = yProjs
      .map(measureFromProj)
      .filter((x): x is { table: string; name: string } => !!x && isAcMeasure(x.name));
    if (acMeasures.length !== 1) continue;

    const { table: acTable, name: acMeasure } = acMeasures[0];
    const isBar = varianceIsBar(vtype, getCategoryFields(visual));
    const pyMeasure = `${acMeasure} PY`;
    const maxGreen = `${acMeasure} Max Green PY`;
    const maxRed = `${acMeasure} Max Red AC`;
    const acMeta = `${acTable}.${acMeasure}`;
    const pyMeta = `${acTable}.${pyMeasure}`;

    // Step 1: stacked/single → clustered, column → bar for non-time axes.
    if (vtype === 'columnChart') {
      visual.visualType = isBar ? 'clusteredBarChart' : 'clusteredColumnChart';
    } else if (vtype === 'barChart') {
      visual.visualType = 'clusteredBarChart';
    }

    // Step 2: add the PY series to the Y axis (front of the list → behind AC).
    const hasPy = yProjs.some((p) => {
      const info = measureFromProj(p);
      return !!info && info.table === acTable && info.name === pyMeasure;
    });
    if (!hasPy) {
      yProjs.unshift(buildPyProjection(acTable, pyMeasure));
      // Re-attach in case queryState was rebuilt from defaults.
      const query = (visual.query ??= {}) as ObjMap;
      const queryState = (query.queryState ??= {}) as ObjMap;
      const y = (queryState.Y ??= {}) as ObjMap;
      y.projections = yProjs;
    }

    // Step 3: error bars, labels, data-point colors, overlap, axes.
    const objects = (visual.objects ??= {}) as ObjMap;
    objects.error = buildErrorBarConfig(acTable, acMeasure, pyMeasure, maxRed, maxGreen);
    objects.labels = buildLabelConfig(pyMeta);
    objects.dataPoint = buildDataPointConfig(acMeta, pyMeta);
    objects.layout = buildLayoutConfig();
    objects.valueAxis = [
      { properties: { show: litExpr('false'), gridlineShow: litExpr('false'), showAxisTitle: litExpr('false') } },
    ];
    objects.categoryAxis = [{ properties: { show: litExpr('true'), showAxisTitle: litExpr('false') } }];

    // Step 4: sort bar charts descending by AC.
    const finalType = String(visual.visualType ?? '');
    if (finalType === 'barChart' || finalType === 'clusteredBarChart') {
      setSortDescending(visual, acTable, acMeasure);
    }

    edits[part.path] = JSON.stringify(doc, null, 2);
    fixed += 1;
  }

  const changed = Object.keys(edits).length
    ? await saveDefinitionParts('report', workspaceId, reportId, edits)
    : 0;

  return {
    changed,
    fixed,
    detail:
      fixed > 0
        ? `Applied IBCS variance styling to ${fixed} chart(s). Bind the model's "<AC> PY / Max Green PY / Max Red AC" measures (Previous-year & variance tool) so the red/green error bars render.`
        : 'No bar/column chart with a single actuals measure was found.',
  };
}
