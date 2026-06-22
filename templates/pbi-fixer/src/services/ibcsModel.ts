// IBCS implementation helpers — model side.
//
// Three IBCS building blocks applied to the semantic model's TMDL definition
// via the same updateDefinition path the Measure Editor and BPA fixer use:
//
//   1. Calendar table  — a marked DAX date table (CALENDARAUTO) so time
//      intelligence works, optionally related to detected fact date columns.
//   2. Previous-year measures — CALCULATE(<m>, SAMEPERIODLASTYEAR(Calendar[Date])).
//   3. Variance measures (the "error bars") — absolute Δ PY and percent Δ% PY,
//      the tiers an IBCS integrated-variance chart (or the bundled custom
//      visual) renders as green/red variance bars.
//
// All writes are explicit, user-initiated and reload the model afterwards.

import { loadDefinitionParts, saveDefinitionParts } from './fabricRest';
import { loadMeasures, type LoadedMeasure } from './measureEditor';

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export interface DateColumn {
  table: string;
  column: string;
  dataType: string;
  isKey: boolean;
}

export interface CalendarTableInfo {
  table: string;
  dateColumn: string;
  /** True when the table carries `dataCategory: Time` (marked date table). */
  marked: boolean;
}

export interface ModelAnalysis {
  tables: string[];
  dateColumns: DateColumn[];
  calendarTables: CalendarTableInfo[];
  calcGroups: string[];
  measures: LoadedMeasure[];
}

export interface AddCalendarOptions {
  tableName?: string;
  dateColumnName?: string;
  /** Relate the new Date column to unconnected fact date columns. */
  connect?: boolean;
  /** Build the rich 20-column calendar instead of the lean 6-column one. */
  rich?: boolean;
}

export interface CalendarResult {
  created: boolean;
  changed: number;
  relationships: number;
  detail: string;
}

export interface TimeIntelMeasure {
  table: string;
  name: string;
  formatString: string;
}

export interface TimeIntelOptions {
  calendarTable: string;
  dateColumn: string;
  measures: TimeIntelMeasure[];
  previousYear: boolean;
  varianceAbsolute: boolean;
  variancePercent: boolean;
  /** Also create the `Max Green PY` / `Max Red AC` measures the IBCS variance
   *  chart fixer binds its red/green error bars to. Implies previousYear +
   *  varianceAbsolute (those are their DAX prerequisites). */
  errorBars?: boolean;
  displayFolder: string;
}

export interface TimeIntelResult {
  created: string[];
  skipped: string[];
  changed: number;
  detail: string;
}

export interface CalcGroupItem {
  name: string;
  /** DAX expression with `@CAL@` placeholder for the date column reference. */
  expression: string;
  ordinal: number;
  /** Optional DAX format-string-definition (a quoted string literal). */
  formatStringDefinition?: string;
}

export interface CalcGroupTemplate {
  id: string;
  /** Default table name. */
  name: string;
  /** Visible calculation-group column name. */
  column: string;
  description: string;
  /** Time-intelligence templates need a date column reference. */
  needsDate: boolean;
  precedence: number;
  items: CalcGroupItem[];
}

export interface AddCalcGroupOptions {
  templateId: string;
  tableName?: string;
  /** Required when the template `needsDate`. */
  calendarTable?: string;
  dateColumn?: string;
}

export interface CalcGroupResult {
  created: boolean;
  changed: number;
  detail: string;
}

export interface MeasureTableResult {
  created: string[];
  skipped: string[];
  changed: number;
  detail: string;
}

export interface MeasuresFromColumnsResult {
  created: string[];
  skipped: string[];
  hidden: number;
  changed: number;
  detail: string;
}

// --------------------------------------------------------------------------- //
// TMDL primitives (kept local — the Measure Editor keeps its own private copy)
// --------------------------------------------------------------------------- //

function indentOf(line: string): number {
  const m = /^(\t*)/.exec(line);
  return m ? m[1].length : 0;
}

/** Declared name from a TMDL declaration line for the given keyword, or null. */
function declName(line: string, keyword: string): string | null {
  const trimmed = line.replace(/^\t*/, '');
  if (!new RegExp(`^${keyword}[\\s]`).test(trimmed)) return null;
  const rest = trimmed.slice(keyword.length).replace(/^\s+/, '');
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    return end < 0 ? null : rest.slice(1, end);
  }
  const m = /^([^\s=]+)/.exec(rest);
  return m ? m[1] : null;
}

/** Quote a TMDL identifier when it is not a bare word. */
function quoteName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

/** DAX measure reference: [Name] with `]` doubled. */
function mref(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

function findTableDecl(lines: string[], table: string): number {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && declName(lines[i], 'table') === table) return i;
  }
  return -1;
}

function tableBlockEnd(lines: string[], tableDeclIdx: number): number {
  for (let i = tableDeclIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && indentOf(lines[i]) === 0) return i;
  }
  return lines.length;
}

function hasMeasure(lines: string[], tIdx: number, tEnd: number, name: string): boolean {
  for (let i = tIdx + 1; i < tEnd; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], 'measure') === name) return true;
  }
  return false;
}

function uuid(): string {
  return crypto.randomUUID();
}

const CALENDAR_NAME_RE = /(calendar|kalender|datum|date|dim[\s_]?date|dim[\s_]?time)/i;
const DATE_TYPES = new Set(['datetime', 'date']);

// --------------------------------------------------------------------------- //
// Analysis
// --------------------------------------------------------------------------- //

/** Inspect the model TMDL: tables, date columns, existing calendar/date tables
 *  and the measure inventory. */
export async function analyzeModel(
  workspaceId: string,
  datasetId: string
): Promise<ModelAnalysis> {
  const [parts, loaded] = await Promise.all([
    loadDefinitionParts('model', workspaceId, datasetId),
    loadMeasures(workspaceId, datasetId),
  ]);

  const tables: string[] = [];
  const dateColumns: DateColumn[] = [];
  const calendarTables: CalendarTableInfo[] = [];
  const calcGroups: string[] = [];

  for (const part of parts) {
    if (part.binary || !/\/tables\//i.test(part.path)) continue;
    const lines = part.text.split('\n');
    const tIdx = lines.findIndex((l) => indentOf(l) === 0 && declName(l, 'table') !== null);
    if (tIdx < 0) continue;
    const table = declName(lines[tIdx], 'table')!;
    tables.push(table);
    const tEnd = tableBlockEnd(lines, tIdx);

    // Calculation group → `calculationGroup` keyword at table level (indent 1).
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1 && /^\tcalculationGroup\b/.test(lines[i])) {
        calcGroups.push(table);
        break;
      }
    }

    // Marked date table → `dataCategory: Time` at table level (indent 1).
    let marked = false;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (/^\tdataCategory:\s*Time\b/.test(lines[i])) {
        marked = true;
        break;
      }
      if (indentOf(lines[i]) === 1 && /^\t(column|measure|partition|hierarchy)\b/.test(lines[i])) break;
    }

    const tableDateCols: DateColumn[] = [];
    for (let i = tIdx + 1; i < tEnd; i++) {
      const col = indentOf(lines[i]) === 1 ? declName(lines[i], 'column') : null;
      if (!col) continue;
      let dataType = '';
      let isKey = false;
      for (let j = i + 1; j < tEnd; j++) {
        if (indentOf(lines[j]) <= 1 && lines[j].trim() !== '') break;
        const dt = /^\t\tdataType:\s*(\w+)/.exec(lines[j]);
        if (dt) dataType = dt[1];
        if (/^\t\tisKey\b/.test(lines[j])) isKey = true;
      }
      if (DATE_TYPES.has(dataType.toLowerCase())) {
        const dc: DateColumn = { table, column: col, dataType, isKey };
        dateColumns.push(dc);
        tableDateCols.push(dc);
      }
    }

    if (tableDateCols.length > 0 && (marked || CALENDAR_NAME_RE.test(table))) {
      const key = tableDateCols.find((c) => c.isKey) ?? tableDateCols[0];
      calendarTables.push({ table, dateColumn: key.column, marked });
    }
  }

  tables.sort();
  calcGroups.sort();
  return { tables, dateColumns, calendarTables, calcGroups, measures: loaded.measures };
}

// --------------------------------------------------------------------------- //
// Calendar table
// --------------------------------------------------------------------------- //

function buildCalendarTmdl(tableName: string, dateCol: string): string {
  const t = quoteName(tableName);
  const d = quoteName(dateCol);
  return [
    `table ${t}`,
    `\tlineageTag: ${uuid()}`,
    `\tdataCategory: Time`,
    ``,
    `\tcolumn ${d}`,
    `\t\tdataType: dateTime`,
    `\t\tisKey`,
    `\t\tformatString: Short Date`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [${dateCol}]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\t\tannotation TabularEditor_MarkAsDateKey = 1`,
    ``,
    `\tcolumn Year`,
    `\t\tdataType: int64`,
    `\t\tformatString: 0`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Year]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn Quarter`,
    `\t\tdataType: string`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Quarter]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn MonthNumber`,
    `\t\tdataType: int64`,
    `\t\tformatString: 0`,
    `\t\tisHidden`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [MonthNumber]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn Month`,
    `\t\tdataType: string`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Month]`,
    `\t\tsortByColumn: MonthNumber`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn YearMonth`,
    `\t\tdataType: string`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [YearMonth]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource =`,
    `\t\t\t\tSELECTCOLUMNS(`,
    `\t\t\t\t    CALENDARAUTO(),`,
    `\t\t\t\t    "${dateCol}", [Date],`,
    `\t\t\t\t    "Year", YEAR([Date]),`,
    `\t\t\t\t    "Quarter", "Q" & FORMAT([Date], "Q"),`,
    `\t\t\t\t    "MonthNumber", MONTH([Date]),`,
    `\t\t\t\t    "Month", FORMAT([Date], "MMM"),`,
    `\t\t\t\t    "YearMonth", FORMAT([Date], "YYYY-MM")`,
    `\t\t\t\t)`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``,
  ].join('\n');
}

/**
 * Rich calendar (C6) — a 20-column DAX date table covering year/quarter/month,
 * ISO week, day-of-year, weekday names, weekend flags and integer sort keys, on
 * top of the same `CALENDARAUTO()` engine the lean variant uses.
 */
function buildRichCalendarTmdl(tableName: string, dateCol: string): string {
  const t = quoteName(tableName);
  const d = quoteName(dateCol);
  const strCol = (name: string, src: string, sortBy?: string, hidden?: boolean) => {
    const block = [
      `\tcolumn ${quoteName(name)}`,
      `\t\tdataType: string`,
    ];
    if (hidden) block.push(`\t\tisHidden`);
    block.push(`\t\tlineageTag: ${uuid()}`, `\t\tsummarizeBy: none`, `\t\tsourceColumn: [${src}]`);
    if (sortBy) block.push(`\t\tsortByColumn: ${quoteName(sortBy)}`);
    block.push(``, `\t\tannotation SummarizationSetBy = Automatic`, ``);
    return block;
  };
  const intCol = (name: string, src: string, hidden?: boolean) => {
    const block = [
      `\tcolumn ${quoteName(name)}`,
      `\t\tdataType: int64`,
      `\t\tformatString: 0`,
    ];
    if (hidden) block.push(`\t\tisHidden`);
    block.push(`\t\tlineageTag: ${uuid()}`, `\t\tsummarizeBy: none`, `\t\tsourceColumn: [${src}]`);
    block.push(``, `\t\tannotation SummarizationSetBy = Automatic`, ``);
    return block;
  };
  const boolCol = (name: string, src: string) => [
    `\tcolumn ${quoteName(name)}`,
    `\t\tdataType: boolean`,
    `\t\tformatString: """TRUE"";""TRUE"";""FALSE"""`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [${src}]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
  ];
  const dateColBlock = (name: string, src: string) => [
    `\tcolumn ${quoteName(name)}`,
    `\t\tdataType: dateTime`,
    `\t\tformatString: Short Date`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [${src}]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
  ];
  return [
    `table ${t}`,
    `\tlineageTag: ${uuid()}`,
    `\tdataCategory: Time`,
    ``,
    `\tcolumn ${d}`,
    `\t\tdataType: dateTime`,
    `\t\tisKey`,
    `\t\tformatString: Short Date`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [${dateCol}]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\t\tannotation TabularEditor_MarkAsDateKey = 1`,
    ``,
    ...intCol('Year', 'Year'),
    ...strCol('Quarter', 'Quarter'),
    ...intCol('QuarterNumber', 'QuarterNumber', true),
    ...strCol('Month', 'Month', 'MonthNumber'),
    ...intCol('MonthNumber', 'MonthNumber', true),
    ...strCol('MonthYear', 'MonthYear', 'YearMonthSort'),
    ...intCol('YearMonthSort', 'YearMonthSort', true),
    ...strCol('YearQuarter', 'YearQuarter'),
    ...intCol('Week', 'Week'),
    ...intCol('ISOWeek', 'ISOWeek'),
    ...intCol('DayOfMonth', 'DayOfMonth'),
    ...intCol('DayOfYear', 'DayOfYear'),
    ...strCol('Weekday', 'Weekday', 'WeekdayNumber'),
    ...intCol('WeekdayNumber', 'WeekdayNumber', true),
    ...boolCol('IsWeekend', 'IsWeekend'),
    ...boolCol('IsWeekday', 'IsWeekday'),
    ...intCol('DateKey', 'DateKey', true),
    ...dateColBlock('MonthStartDate', 'MonthStartDate'),
    ...dateColBlock('MonthEndDate', 'MonthEndDate'),
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource =`,
    `\t\t\t\tSELECTCOLUMNS(`,
    `\t\t\t\t    CALENDARAUTO(),`,
    `\t\t\t\t    "${dateCol}", [Date],`,
    `\t\t\t\t    "Year", YEAR([Date]),`,
    `\t\t\t\t    "Quarter", "Q" & FORMAT([Date], "Q"),`,
    `\t\t\t\t    "QuarterNumber", INT(FORMAT([Date], "Q")),`,
    `\t\t\t\t    "Month", FORMAT([Date], "MMM"),`,
    `\t\t\t\t    "MonthNumber", MONTH([Date]),`,
    `\t\t\t\t    "MonthYear", FORMAT([Date], "MMM YYYY"),`,
    `\t\t\t\t    "YearMonthSort", YEAR([Date]) * 100 + MONTH([Date]),`,
    `\t\t\t\t    "YearQuarter", YEAR([Date]) & " Q" & FORMAT([Date], "Q"),`,
    `\t\t\t\t    "Week", WEEKNUM([Date]),`,
    `\t\t\t\t    "ISOWeek", WEEKNUM([Date], 21),`,
    `\t\t\t\t    "DayOfMonth", DAY([Date]),`,
    `\t\t\t\t    "DayOfYear", DATEDIFF(DATE(YEAR([Date]), 1, 1), [Date], DAY) + 1,`,
    `\t\t\t\t    "Weekday", FORMAT([Date], "ddd"),`,
    `\t\t\t\t    "WeekdayNumber", WEEKDAY([Date], 2),`,
    `\t\t\t\t    "IsWeekend", WEEKDAY([Date], 2) > 5,`,
    `\t\t\t\t    "IsWeekday", WEEKDAY([Date], 2) <= 5,`,
    `\t\t\t\t    "DateKey", YEAR([Date]) * 10000 + MONTH([Date]) * 100 + DAY([Date]),`,
    `\t\t\t\t    "MonthStartDate", DATE(YEAR([Date]), MONTH([Date]), 1),`,
    `\t\t\t\t    "MonthEndDate", EOMONTH([Date], 0)`,
    `\t\t\t\t)`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``,
  ].join('\n');
}

/** Strip characters that are unsafe in a TMDL part file name (emoji, slashes). */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || `Table_${uuid().slice(0, 8)}`;
}

/** TMDL for an empty "measure container" calc-table (`{BLANK()}`, hidden Value). */
function buildMeasureTableTmdl(tableName: string): string {
  const t = quoteName(tableName);
  return [
    `table ${t}`,
    `\tlineageTag: ${uuid()}`,
    ``,
    `\tcolumn Value`,
    `\t\tdataType: int64`,
    `\t\tisHidden`,
    `\t\tformatString: 0`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Value]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource = {BLANK()}`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``,
  ].join('\n');
}
function existingRelationshipColumns(text: string): Set<string> {
  const set = new Set<string>();
  const re = /^\t(?:fromColumn|toColumn):\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) set.add(m[1].trim());
  return set;
}

function relColumnRef(table: string, column: string): string {
  return `${quoteName(table)}.${quoteName(column)}`;
}

/**
 * Add a marked DAX calendar/date table to the model. No-op (created:false) when
 * a table of the same name already exists. When `connect` is set, relates the
 * new Date column to fact date columns that are not already part of any
 * relationship (one active relationship per fact table).
 */
export async function addCalendarTable(
  workspaceId: string,
  datasetId: string,
  opts: AddCalendarOptions = {}
): Promise<CalendarResult> {
  const tableName = (opts.tableName ?? 'Calendar').trim() || 'Calendar';
  const dateCol = (opts.dateColumnName ?? 'Date').trim() || 'Date';

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) {
    return { created: false, changed: 0, relationships: 0, detail: 'model.tmdl part not found.' };
  }

  // Already present?
  const exists =
    parts.some((p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), tableName) >= 0) ||
    new RegExp(`^ref table ${tableName}\\b`, 'm').test(modelPart.text);
  if (exists) {
    return {
      created: false,
      changed: 0,
      relationships: 0,
      detail: `A table named "${tableName}" already exists — using it as-is.`,
    };
  }

  // Derive the tables directory from an existing table part.
  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';
  const newTablePath = `${tablesDir}/${tableName}.tmdl`;

  const edits: Record<string, string> = {
    [newTablePath]: opts.rich
      ? buildRichCalendarTmdl(tableName, dateCol)
      : buildCalendarTmdl(tableName, dateCol),
  };

  // Register the table in model.tmdl (after the last `ref table` line).
  const modelLines = modelPart.text.split('\n');
  let lastRef = -1;
  for (let i = 0; i < modelLines.length; i++) {
    if (/^ref table /.test(modelLines[i])) lastRef = i;
  }
  const refLine = `ref table ${quoteName(tableName)}`;
  if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, refLine);
  else modelLines.push('', refLine);
  edits[modelPart.path] = modelLines.join('\n');

  // Optionally relate unconnected fact date columns to Calendar[Date].
  let relationships = 0;
  if (opts.connect) {
    const analysis = await analyzeModel(workspaceId, datasetId);
    const relPart = parts.find((p) => /\/relationships\.tmdl$/i.test(p.path) && !p.binary);
    const relText = relPart?.text ?? '';
    const used = existingRelationshipColumns(relText);
    const connectedTables = new Set<string>();
    const blocks: string[] = [];
    for (const dc of analysis.dateColumns) {
      if (dc.table === tableName) continue;
      const ref = relColumnRef(dc.table, dc.column);
      if (used.has(ref) || connectedTables.has(dc.table)) continue;
      connectedTables.add(dc.table);
      blocks.push(
        [
          `relationship ${uuid()}`,
          `\tfromColumn: ${ref}`,
          `\ttoColumn: ${relColumnRef(tableName, dateCol)}`,
        ].join('\n')
      );
      relationships++;
    }
    if (blocks.length > 0) {
      const relPath = relPart?.path ?? 'definition/relationships.tmdl';
      const joined = blocks.join('\n\n');
      edits[relPath] = relText.trim() ? `${relText.replace(/\s*$/, '')}\n\n${joined}\n` : `${joined}\n`;
    }
  }

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    created: changed > 0,
    changed,
    relationships,
    detail:
      changed > 0
        ? `Created date table "${tableName}"${relationships ? ` and ${relationships} relationship(s)` : ''}.`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// Measure tables & explicit measures
// --------------------------------------------------------------------------- //

/** Three themed, emoji-prefixed measure-container tables (C2). */
export const THEMED_MEASURE_TABLES = ['\u{1F4CA} Measures', '\u{1F522} KPIs', '\u{1F4C5} Time Intelligence'];

/** Create one or more empty `{BLANK()}` measure-container tables in one round trip. */
async function addMeasureTablesInternal(
  workspaceId: string,
  datasetId: string,
  names: string[]
): Promise<MeasureTableResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) {
    return { created: [], skipped: [], changed: 0, detail: 'model.tmdl part not found.' };
  }

  const existing = new Set<string>();
  for (const p of parts) {
    if (p.binary || !/\/tables\//i.test(p.path)) continue;
    const lines = p.text.split('\n');
    const idx = lines.findIndex((l) => indentOf(l) === 0 && declName(l, 'table') !== null);
    if (idx >= 0) existing.add(declName(lines[idx], 'table')!);
  }

  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';

  const edits: Record<string, string> = {};
  const modelLines = modelPart.text.split('\n');
  let lastRef = -1;
  for (let i = 0; i < modelLines.length; i++) {
    if (/^ref table /.test(modelLines[i])) lastRef = i;
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const refsToAdd: string[] = [];
  const usedFiles = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (existing.has(name)) {
      skipped.push(name);
      continue;
    }
    existing.add(name);
    const base = sanitizeFileName(name);
    let file = base;
    let n = 2;
    while (usedFiles.has(file.toLowerCase())) file = `${base} ${n++}`;
    usedFiles.add(file.toLowerCase());
    edits[`${tablesDir}/${file}.tmdl`] = buildMeasureTableTmdl(name);
    refsToAdd.push(`ref table ${quoteName(name)}`);
    created.push(name);
  }

  if (refsToAdd.length > 0) {
    if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, ...refsToAdd);
    else modelLines.push('', ...refsToAdd);
    edits[modelPart.path] = modelLines.join('\n');
  }

  const changed = created.length > 0 ? await saveDefinitionParts('model', workspaceId, datasetId, edits) : 0;
  return {
    created,
    skipped,
    changed,
    detail:
      created.length > 0
        ? `Created ${created.length} measure table(s): ${created.join(', ')}${skipped.length ? ` (skipped ${skipped.length} existing)` : ''}.`
        : skipped.length
          ? `Nothing created — ${skipped.join(', ')} already exist.`
          : 'No table name supplied.',
  };
}

/** C1 — add a single empty "Measure" container calc-table. */
export async function addMeasureTableEmpty(
  workspaceId: string,
  datasetId: string,
  tableName = 'Measure'
): Promise<MeasureTableResult> {
  return addMeasureTablesInternal(workspaceId, datasetId, [(tableName ?? 'Measure').trim() || 'Measure']);
}

/** C2 — add three themed, emoji-prefixed measure-container tables. */
export async function addMeasureTables3WithIcons(
  workspaceId: string,
  datasetId: string
): Promise<MeasureTableResult> {
  return addMeasureTablesInternal(workspaceId, datasetId, THEMED_MEASURE_TABLES);
}

const NUMERIC_TYPES = new Set(['int64', 'decimal', 'double']);
const AGG_LABEL: Record<string, string> = {
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  distinctcount: 'Distinct Count',
};
const AGG_DAX: Record<string, string> = {
  sum: 'SUM',
  average: 'AVERAGE',
  min: 'MIN',
  max: 'MAX',
  count: 'COUNT',
  distinctcount: 'DISTINCTCOUNT',
};

/**
 * C3 — create explicit aggregation measures from a table's numeric columns.
 * A measure is created for every numeric column whose `summarizeBy` is an
 * explicit aggregation (sum/average/min/max/count/distinctCount); the source
 * column is hidden so report authors use the measure instead of the implicit
 * column. Columns with `summarizeBy: none` (or no aggregation) are left alone.
 */
export async function addMeasuresFromColumns(
  workspaceId: string,
  datasetId: string,
  opts: { table: string; hideSources?: boolean; displayFolder?: string }
): Promise<MeasuresFromColumnsResult> {
  const table = opts.table.trim();
  const hideSources = opts.hideSources !== false;
  const folder = (opts.displayFolder ?? '').trim();

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const part = parts.find(
    (p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), table) >= 0
  );
  if (!part) {
    return { created: [], skipped: [], hidden: 0, changed: 0, detail: `Table "${table}" not found.` };
  }

  const lines = part.text.split('\n');
  const tIdx = findTableDecl(lines, table);
  let tEnd = tableBlockEnd(lines, tIdx);

  interface ColMeta {
    name: string;
    dataType: string;
    summarizeBy: string;
    isHidden: boolean;
    declIdx: number;
  }
  const cols: ColMeta[] = [];
  for (let i = tIdx + 1; i < tEnd; i++) {
    const cn = indentOf(lines[i]) === 1 ? declName(lines[i], 'column') : null;
    if (!cn) continue;
    let dataType = '';
    let summarizeBy = '';
    let isHidden = false;
    for (let j = i + 1; j < tEnd; j++) {
      if (lines[j].trim() !== '' && indentOf(lines[j]) <= 1) break;
      const dt = /^\t\tdataType:\s*(\w+)/.exec(lines[j]);
      if (dt) dataType = dt[1];
      const sb = /^\t\tsummarizeBy:\s*(\w+)/.exec(lines[j]);
      if (sb) summarizeBy = sb[1];
      if (/^\t\tisHidden\b/.test(lines[j])) isHidden = true;
    }
    cols.push({ name: cn, dataType, summarizeBy, isHidden, declIdx: i });
  }

  const eligible = cols.filter(
    (c) => NUMERIC_TYPES.has(c.dataType.toLowerCase()) && !!AGG_DAX[c.summarizeBy.toLowerCase()]
  );
  if (eligible.length === 0) {
    return {
      created: [],
      skipped: [],
      hidden: 0,
      changed: 0,
      detail: `No aggregatable numeric columns on "${table}" (need an explicit summarizeBy).`,
    };
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const measureBlocks: string[][] = [];
  const hideTargets: ColMeta[] = [];
  for (const c of eligible) {
    const agg = c.summarizeBy.toLowerCase();
    const mName = `${AGG_LABEL[agg]} of ${c.name}`;
    if (hasMeasure(lines, tIdx, tEnd, mName)) {
      skipped.push(`${mName} (exists)`);
      continue;
    }
    const colRef = `${quoteName(table)}[${c.name.replace(/]/g, ']]')}]`;
    const expr = `${AGG_DAX[agg]} ( ${colRef} )`;
    const fmt = c.dataType.toLowerCase() === 'int64' ? '#,0' : '#,0.00';
    measureBlocks.push(buildMeasureBlock({ table, name: mName, expression: expr, formatString: fmt, displayFolder: folder }));
    created.push(mName);
    if (hideSources && !c.isHidden) hideTargets.push(c);
  }

  // Hide source columns first (descending order keeps earlier indices valid).
  let hidden = 0;
  for (const c of [...hideTargets].sort((a, b) => b.declIdx - a.declIdx)) {
    lines.splice(c.declIdx + 1, 0, '\t\tisHidden');
    hidden++;
  }

  // Insert measures before the first partition (or at the end of the block).
  if (measureBlocks.length > 0) {
    tEnd = tableBlockEnd(lines, tIdx);
    let insertAt = tEnd;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1 && declName(lines[i], 'partition') !== null) {
        insertAt = i;
        break;
      }
    }
    while (insertAt - 1 > tIdx && lines[insertAt - 1].trim() === '') insertAt--;
    const toInsert: string[] = [];
    for (const block of measureBlocks) toInsert.push('', ...block);
    lines.splice(insertAt, 0, ...toInsert);
  }

  if (created.length === 0 && hidden === 0) {
    return {
      created: [],
      skipped,
      hidden: 0,
      changed: 0,
      detail: skipped.length ? `Nothing created — ${skipped.length} measure(s) already exist.` : 'No change.',
    };
  }

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, { [part.path]: lines.join('\n') });
  return {
    created,
    skipped,
    hidden,
    changed,
    detail:
      changed > 0
        ? `Created ${created.length} measure(s) on "${table}"${hidden ? `, hid ${hidden} source column(s)` : ''}${skipped.length ? `, skipped ${skipped.length}` : ''}.`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// Previous-year + variance measures
// --------------------------------------------------------------------------- //

interface NewMeasure {
  table: string;
  name: string;
  expression: string;
  formatString: string;
  displayFolder: string;
}

function buildMeasureBlock(m: NewMeasure): string[] {
  const out = [`\tmeasure ${quoteName(m.name)} = ${m.expression}`];
  if (m.formatString) out.push(`\t\tformatString: ${m.formatString}`);
  if (m.displayFolder) out.push(`\t\tdisplayFolder: ${m.displayFolder}`);
  out.push(`\t\tlineageTag: ${uuid()}`);
  return out;
}

/**
 * Generate previous-year and variance measures for the supplied base measures.
 * For each base measure up to three measures are created:
 *   "<m> PY"    = CALCULATE(<m>, SAMEPERIODLASTYEAR(Calendar[Date]))
 *   "<m> Δ PY"  = <m> - [<m> PY]
 *   "<m> Δ% PY" = DIVIDE([<m> Δ PY], [<m> PY])
 * Measures whose target name already exists are skipped. One round trip.
 */
export async function generateTimeIntelligence(
  workspaceId: string,
  datasetId: string,
  opts: TimeIntelOptions
): Promise<TimeIntelResult> {
  if (!opts.previousYear && !opts.varianceAbsolute && !opts.variancePercent) {
    return { created: [], skipped: [], changed: 0, detail: 'Nothing selected to generate.' };
  }
  if (opts.measures.length === 0) {
    return { created: [], skipped: [], changed: 0, detail: 'No base measures selected.' };
  }

  const calRef = `${quoteName(opts.calendarTable)}[${opts.dateColumn}]`;
  const folder = opts.displayFolder.trim();

  // Error bars need PY + Δ PY (their DAX prerequisites).
  const wantPy = opts.previousYear || opts.errorBars;
  const wantAbs = opts.varianceAbsolute || opts.errorBars;

  // Plan the measures per home table.
  const plan: NewMeasure[] = [];
  const planNames = new Set<string>();
  for (const base of opts.measures) {
    const pyName = `${base.name} PY`;
    const absName = `${base.name} Δ PY`;
    const pctName = `${base.name} Δ% PY`;
    const maxGreenName = `${base.name} Max Green PY`;
    const maxRedName = `${base.name} Max Red AC`;
    if (wantPy) {
      plan.push({
        table: base.table,
        name: pyName,
        expression: `CALCULATE ( ${mref(base.name)}, SAMEPERIODLASTYEAR ( ${calRef} ) )`,
        formatString: base.formatString,
        displayFolder: folder,
      });
      planNames.add(`${base.table}\u0000${pyName}`);
    }
    if (wantAbs) {
      plan.push({
        table: base.table,
        name: absName,
        expression: `${mref(base.name)} - ${mref(pyName)}`,
        formatString: base.formatString,
        displayFolder: folder,
      });
      planNames.add(`${base.table}\u0000${absName}`);
    }
    if (opts.variancePercent) {
      plan.push({
        table: base.table,
        name: pctName,
        expression: `DIVIDE ( ${mref(absName)}, ${mref(pyName)} )`,
        formatString: '0.0%;-0.0%;0.0%',
        displayFolder: folder,
      });
      planNames.add(`${base.table}\u0000${pctName}`);
    }
    if (opts.errorBars) {
      plan.push({
        table: base.table,
        name: maxGreenName,
        expression: `IF ( ${mref(absName)} > 0, MAX ( ${mref(base.name)}, ${mref(pyName)} ) )`,
        formatString: base.formatString,
        displayFolder: folder,
      });
      planNames.add(`${base.table}\u0000${maxGreenName}`);
      plan.push({
        table: base.table,
        name: maxRedName,
        expression: `IF ( ${mref(absName)} < 0, MAX ( ${mref(base.name)}, ${mref(pyName)} ) )`,
        formatString: base.formatString,
        displayFolder: folder,
      });
      planNames.add(`${base.table}\u0000${maxRedName}`);
    }
  }

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const created: string[] = [];
  const skipped: string[] = [];
  const edits: Record<string, string> = {};

  // Group planned measures by home table.
  const byTable = new Map<string, NewMeasure[]>();
  for (const m of plan) {
    const arr = byTable.get(m.table) ?? [];
    arr.push(m);
    byTable.set(m.table, arr);
  }

  for (const [table, wanted] of byTable) {
    const part = parts.find(
      (p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), table) >= 0
    );
    if (!part) {
      for (const m of wanted) skipped.push(`${table}[${m.name}] (table not found)`);
      continue;
    }
    const lines = part.path in edits ? edits[part.path].split('\n') : part.text.split('\n');
    const tIdx = findTableDecl(lines, table);
    const tEnd = tableBlockEnd(lines, tIdx);

    // Insertion point: before the first partition, else end of the table block.
    let insertAt = tEnd;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1 && declName(lines[i], 'partition') !== null) {
        insertAt = i;
        break;
      }
    }
    while (insertAt - 1 > tIdx && lines[insertAt - 1].trim() === '') insertAt--;

    const toInsert: string[] = [];
    for (const m of wanted) {
      if (hasMeasure(lines, tIdx, tEnd, m.name)) {
        skipped.push(`${table}[${m.name}] (already exists)`);
        continue;
      }
      toInsert.push('', ...buildMeasureBlock(m));
      created.push(`${table}[${m.name}]`);
    }
    if (toInsert.length > 0) {
      lines.splice(insertAt, 0, ...toInsert);
      edits[part.path] = lines.join('\n');
    }
  }

  const changed = created.length > 0 ? await saveDefinitionParts('model', workspaceId, datasetId, edits) : 0;
  return {
    created,
    skipped,
    changed,
    detail:
      created.length > 0
        ? `Created ${created.length} measure(s)${skipped.length ? `, skipped ${skipped.length}` : ''}.`
        : skipped.length
          ? `Nothing created — ${skipped.length} measure(s) already exist.`
          : 'No measures generated.',
  };
}

// --------------------------------------------------------------------------- //
// Calculation group templates
// --------------------------------------------------------------------------- //

/** Built-in calculation-group templates. `@CAL@` in an expression is replaced
 *  by the selected date column reference (e.g. `Calendar[Date]`). */
export const CALC_GROUP_TEMPLATES: CalcGroupTemplate[] = [
  {
    id: 'time-intelligence',
    name: 'Time Intelligence',
    column: 'Time Calculation',
    description: 'Current, MTD, QTD, YTD, previous year and year-over-year on any measure.',
    needsDate: true,
    precedence: 10,
    items: [
      { name: 'Current', expression: 'SELECTEDMEASURE ()', ordinal: 0 },
      { name: 'MTD', expression: 'CALCULATE ( SELECTEDMEASURE (), DATESMTD ( @CAL@ ) )', ordinal: 1 },
      { name: 'QTD', expression: 'CALCULATE ( SELECTEDMEASURE (), DATESQTD ( @CAL@ ) )', ordinal: 2 },
      { name: 'YTD', expression: 'CALCULATE ( SELECTEDMEASURE (), DATESYTD ( @CAL@ ) )', ordinal: 3 },
      { name: 'PY', expression: 'CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( @CAL@ ) )', ordinal: 4 },
      {
        name: 'PY YTD',
        expression: 'CALCULATE ( SELECTEDMEASURE (), DATESYTD ( @CAL@ ), SAMEPERIODLASTYEAR ( @CAL@ ) )',
        ordinal: 5,
      },
      {
        name: 'YoY',
        expression: 'SELECTEDMEASURE () - CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( @CAL@ ) )',
        ordinal: 6,
      },
      {
        name: 'YoY %',
        expression:
          'DIVIDE ( SELECTEDMEASURE () - CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( @CAL@ ) ), CALCULATE ( SELECTEDMEASURE (), SAMEPERIODLASTYEAR ( @CAL@ ) ) )',
        ordinal: 7,
        formatStringDefinition: '"0.0%;-0.0%;0.0%"',
      },
    ],
  },
  {
    id: 'units',
    name: 'Units',
    column: 'Scale',
    description: 'Show any measure as units, thousands, millions or billions.',
    needsDate: false,
    precedence: 20,
    items: [
      { name: 'Units', expression: 'SELECTEDMEASURE ()', ordinal: 0 },
      {
        name: 'Thousands',
        expression: 'SELECTEDMEASURE () / 1E3',
        ordinal: 1,
        formatStringDefinition: '"#,##0.0"',
      },
      {
        name: 'Millions',
        expression: 'SELECTEDMEASURE () / 1E6',
        ordinal: 2,
        formatStringDefinition: '"#,##0.0"',
      },
      {
        name: 'Billions',
        expression: 'SELECTEDMEASURE () / 1E9',
        ordinal: 3,
        formatStringDefinition: '"#,##0.00"',
      },
    ],
  },
];

/** Available calculation-group templates. */
export function listCalcGroupTemplates(): CalcGroupTemplate[] {
  return CALC_GROUP_TEMPLATES;
}

/** Build the TMDL for a calculation-group table from a template. */
function buildCalcGroupTmdl(
  tpl: CalcGroupTemplate,
  tableName: string,
  columnName: string,
  calRef: string
): string {
  const t = quoteName(tableName);
  const lines: string[] = [];
  lines.push(`table ${t}`);
  lines.push(`\tlineageTag: ${uuid()}`);
  lines.push(``);
  lines.push(`\tcalculationGroup`);
  lines.push(`\t\tprecedence: ${tpl.precedence}`);
  for (const item of tpl.items) {
    const expr = item.expression.replace(/@CAL@/g, calRef);
    lines.push(``);
    lines.push(`\t\tcalculationItem ${quoteName(item.name)} = ${expr}`);
    lines.push(`\t\t\tordinal: ${item.ordinal}`);
    if (item.formatStringDefinition) {
      lines.push(``);
      lines.push(`\t\t\tformatStringDefinition = ${item.formatStringDefinition}`);
    }
  }
  lines.push(``);
  lines.push(`\tcolumn ${quoteName(columnName)}`);
  lines.push(`\t\tdataType: string`);
  lines.push(`\t\tlineageTag: ${uuid()}`);
  lines.push(`\t\tsummarizeBy: none`);
  lines.push(`\t\tsourceColumn: Name`);
  lines.push(`\t\tsortByColumn: Ordinal`);
  lines.push(``);
  lines.push(`\t\tannotation SummarizationSetBy = Automatic`);
  lines.push(``);
  lines.push(`\tcolumn Ordinal`);
  lines.push(`\t\tdataType: int64`);
  lines.push(`\t\tformatString: 0`);
  lines.push(`\t\tisHidden`);
  lines.push(`\t\tlineageTag: ${uuid()}`);
  lines.push(`\t\tsummarizeBy: none`);
  lines.push(`\t\tsourceColumn: Ordinal`);
  lines.push(``);
  lines.push(`\t\tannotation SummarizationSetBy = Automatic`);
  lines.push(``);
  lines.push(`\tpartition ${t} = calculationGroup`);
  lines.push(`\t\tmode: import`);
  lines.push(``);
  return lines.join('\n');
}

/**
 * Add a calculation group built from a template to the model. No-op
 * (created:false) when a table of the same name already exists. Time-intelligence
 * templates require a date column reference (calendarTable + dateColumn).
 */
export async function addCalculationGroup(
  workspaceId: string,
  datasetId: string,
  opts: AddCalcGroupOptions
): Promise<CalcGroupResult> {
  const tpl = CALC_GROUP_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!tpl) {
    return { created: false, changed: 0, detail: `Unknown template "${opts.templateId}".` };
  }
  const tableName = (opts.tableName ?? tpl.name).trim() || tpl.name;

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) {
    return { created: false, changed: 0, detail: 'model.tmdl part not found.' };
  }

  const exists =
    parts.some(
      (p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), tableName) >= 0
    ) || new RegExp(`^ref table ${tableName}\\b`, 'm').test(modelPart.text);
  if (exists) {
    return {
      created: false,
      changed: 0,
      detail: `A table named "${tableName}" already exists — using it as-is.`,
    };
  }

  let calRef = '';
  if (tpl.needsDate) {
    const calTable = (opts.calendarTable ?? '').trim();
    const dateCol = (opts.dateColumn ?? '').trim();
    if (!calTable || !dateCol) {
      return {
        created: false,
        changed: 0,
        detail: 'This template needs a date column — pick a marked date table first.',
      };
    }
    calRef = `${quoteName(calTable)}[${dateCol}]`;
  }

  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';
  const newTablePath = `${tablesDir}/${tableName}.tmdl`;

  const edits: Record<string, string> = {
    [newTablePath]: buildCalcGroupTmdl(tpl, tableName, tpl.column, calRef),
  };

  // Register the table in model.tmdl (after the last `ref table` line).
  const modelLines = modelPart.text.split('\n');
  let lastRef = -1;
  for (let i = 0; i < modelLines.length; i++) {
    if (/^ref table /.test(modelLines[i])) lastRef = i;
  }
  const refLine = `ref table ${quoteName(tableName)}`;
  if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, refLine);
  else modelLines.push('', refLine);
  edits[modelPart.path] = modelLines.join('\n');

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    created: changed > 0,
    changed,
    detail:
      changed > 0
        ? `Created calculation group "${tableName}" with ${tpl.items.length} item(s).`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// Field parameters (MA6 / PKG-13)
// --------------------------------------------------------------------------- //

export type FieldParamKind = 'measure' | 'column';

export interface FieldParamCandidate {
  kind: FieldParamKind;
  table: string;
  /** Column or measure name. */
  name: string;
  /** `'Table'[Name]` DAX reference. */
  ref: string;
  /** Stable selection key. */
  key: string;
}

export interface FieldParamScan {
  measures: FieldParamCandidate[];
  columns: FieldParamCandidate[];
}

export interface FieldParamField {
  kind: FieldParamKind;
  table: string;
  name: string;
  /** Slicer display label. */
  label: string;
}

export interface FieldParameterResult {
  created: boolean;
  changed: number;
  detail: string;
}

const SYS_COLUMN_RE = /^RowNumber-/i;

/** `'Table'[Name]` reference with `]` doubled. */
function fieldRef(table: string, name: string): string {
  return `${quoteName(table)}[${name.replace(/]/g, ']]')}]`;
}

function fieldKey(kind: FieldParamKind, table: string, name: string): string {
  return `${kind}::${table}::${name}`;
}

/**
 * Enumerate the measures and report-usable columns that can be wired into a
 * field parameter. Calculation-group tables and the internal RowNumber system
 * columns are excluded; hidden objects are kept (the author may still want to
 * expose them through the parameter).
 */
export async function scanFieldParamCandidates(
  workspaceId: string,
  datasetId: string
): Promise<FieldParamScan> {
  const [parts, loaded] = await Promise.all([
    loadDefinitionParts('model', workspaceId, datasetId),
    loadMeasures(workspaceId, datasetId),
  ]);

  const measures: FieldParamCandidate[] = loaded.measures
    .map((m) => ({
      kind: 'measure' as const,
      table: m.table,
      name: m.values.name,
      ref: fieldRef(m.table, m.values.name),
      key: fieldKey('measure', m.table, m.values.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const columns: FieldParamCandidate[] = [];
  for (const part of parts) {
    if (part.binary || !/\/tables\//i.test(part.path)) continue;
    const lines = part.text.split('\n');
    const tIdx = lines.findIndex((l) => indentOf(l) === 0 && declName(l, 'table') !== null);
    if (tIdx < 0) continue;
    const table = declName(lines[tIdx], 'table')!;
    const tEnd = tableBlockEnd(lines, tIdx);
    // Skip calculation-group tables (their single column is internal).
    if (lines.slice(tIdx + 1, tEnd).some((l) => /^\tpartition\b.*=\s*calculationGroup\b/.test(l))) continue;
    for (let i = tIdx + 1; i < tEnd; i++) {
      const cn = indentOf(lines[i]) === 1 ? declName(lines[i], 'column') : null;
      if (!cn || SYS_COLUMN_RE.test(cn)) continue;
      columns.push({
        kind: 'column',
        table,
        name: cn,
        ref: fieldRef(table, cn),
        key: fieldKey('column', table, cn),
      });
    }
  }
  columns.sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name));
  return { measures, columns };
}

/** Escape a DAX string literal (double the double-quotes). */
function escapeDaxString(s: string): string {
  return s.replace(/"/g, '""');
}

/** Build the three-column field-parameter calc-table TMDL. */
function buildFieldParameterTmdl(name: string, fields: FieldParamField[]): string {
  const t = quoteName(name);
  const fieldsCol = quoteName(`${name} Fields`);
  const orderCol = quoteName(`${name} Order`);
  const rows = fields
    .map((f, i) => `\t\t\t\t    ("${escapeDaxString(f.label)}", NAMEOF(${fieldRef(f.table, f.name)}), ${i})`)
    .join(',\n');
  return [
    `table ${t}`,
    `\tlineageTag: ${uuid()}`,
    ``,
    `\tcolumn ${t}`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Value1]`,
    `\t\tsortByColumn: ${orderCol}`,
    ``,
    `\t\trelatedColumnDetails`,
    `\t\t\tgroupByColumn: ${fieldsCol}`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn ${fieldsCol}`,
    `\t\tisHidden`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: [Value2]`,
    `\t\tsortByColumn: ${orderCol}`,
    ``,
    `\t\textendedProperty ParameterMetadata = {"version":3,"kind":2}`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tcolumn ${orderCol}`,
    `\t\tisHidden`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: sum`,
    `\t\tsourceColumn: [Value3]`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tpartition ${t} = calculated`,
    `\t\tmode: import`,
    `\t\tsource =`,
    `\t\t\t\t{`,
    rows,
    `\t\t\t\t}`,
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``,
  ].join('\n');
}

/**
 * Create a field parameter calc-table from the selected measures/columns. The
 * generated table carries the three field-parameter columns (display / fields /
 * order), the `ParameterMetadata` extended property and a literal-tuple
 * calculated partition so Power BI renders it as a field-parameter slicer.
 * No-op (created:false) when a table of the same name already exists.
 */
export async function addFieldParameter(
  workspaceId: string,
  datasetId: string,
  opts: { name: string; fields: FieldParamField[] }
): Promise<FieldParameterResult> {
  const name = (opts.name ?? '').trim();
  if (!name) return { created: false, changed: 0, detail: 'A parameter name is required.' };
  const fields = opts.fields.filter((f) => f.name && f.table);
  if (fields.length === 0) return { created: false, changed: 0, detail: 'Select at least one field.' };

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) return { created: false, changed: 0, detail: 'model.tmdl part not found.' };

  const exists =
    parts.some((p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), name) >= 0) ||
    new RegExp(`^ref table ${name}\\b`, 'm').test(modelPart.text);
  if (exists) {
    return { created: false, changed: 0, detail: `A table named "${name}" already exists — pick another name.` };
  }

  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';
  const newTablePath = `${tablesDir}/${sanitizeFileName(name)}.tmdl`;

  const edits: Record<string, string> = {
    [newTablePath]: buildFieldParameterTmdl(name, fields),
  };

  const modelLines = modelPart.text.split('\n');
  let lastRef = -1;
  for (let i = 0; i < modelLines.length; i++) {
    if (/^ref table /.test(modelLines[i])) lastRef = i;
  }
  const refLine = `ref table ${quoteName(name)}`;
  if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, refLine);
  else modelLines.push('', refLine);
  edits[modelPart.path] = modelLines.join('\n');

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    created: changed > 0,
    changed,
    detail:
      changed > 0
        ? `Created field parameter "${name}" with ${fields.length} field(s).`
        : 'No change was written.',
  };
}

// --------------------------------------------------------------------------- //
// Refresh-policy / last-refresh / calendar adders (PKG-9 — C4/C5/C7/C9)
// --------------------------------------------------------------------------- //

export type LastRefreshVariant = 'localNow' | 'europeCet';

export interface LastRefreshResult {
  created: boolean;
  changed: number;
  detail: string;
}

export interface ExpressionResult {
  created: boolean;
  changed: number;
  detail: string;
}

export interface IncrRefreshTarget {
  table: string;
  partition: string;
  dateColumns: string[];
  hasPolicy: boolean;
}

export interface IncrRefreshScan {
  targets: IncrRefreshTarget[];
}

export type RefreshGranularity = 'day' | 'month' | 'quarter' | 'year';

export interface IncrRefreshOptions {
  table: string;
  dateColumn: string;
  /** Archive (rolling) window. */
  storePeriods: number;
  storeGranularity: RefreshGranularity;
  /** Incremental (refresh) window. */
  refreshPeriods: number;
  refreshGranularity: RefreshGranularity;
}

export interface IncrRefreshResult {
  created: boolean;
  changed: number;
  detail: string;
}

/** Prefix each M line with the 4-tab indent a TMDL `source =` block expects. */
function mSourceBlock(mLines: string[]): string[] {
  return ['\t\tsource =', ...mLines.map((l) => (l === '' ? '' : `\t\t\t\t${l}`))];
}

/** Whether a named expression already exists in the model's expressions part. */
function hasExpressionDecl(text: string, name: string): boolean {
  return text.split('\n').some((l) => {
    const m = /^expression\s+('([^']*)'|[^\s=]+)\s*=/.exec(l);
    if (!m) return false;
    const decl = m[2] !== undefined ? m[2] : m[1];
    return decl === name;
  });
}

/** Locate the `definition/expressions.tmdl` part path (existing or default). */
function expressionsPath(parts: Array<{ path: string; binary?: boolean }>): string {
  const p = parts.find((x) => /\/expressions\.tmdl$/i.test(x.path) && !x.binary);
  return p ? p.path : 'definition/expressions.tmdl';
}

/** Append an expression block to expressions.tmdl edits (no-op when present). */
function appendExpression(
  parts: Array<{ path: string; text: string; binary?: boolean }>,
  edits: Record<string, string>,
  name: string,
  block: string
): boolean {
  const path = expressionsPath(parts);
  const exprPart = parts.find((p) => p.path === path && !p.binary);
  const current = edits[path] ?? exprPart?.text ?? '';
  if (hasExpressionDecl(current, name)) return false;
  edits[path] = current.trim() ? `${current.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
  return true;
}

/** TMDL for a Last-Refresh M-import table (one datetime column + a label measure). */
function buildLastRefreshTmdl(
  tableName: string,
  columnName: string,
  mBody: string[],
  measureExpr: string,
  measureName: string
): string {
  const t = quoteName(tableName);
  const c = quoteName(columnName);
  return [
    `table ${t}`,
    `\tlineageTag: ${uuid()}`,
    ``,
    `\tcolumn ${c}`,
    `\t\tdataType: dateTime`,
    `\t\tformatString: General Date`,
    `\t\tlineageTag: ${uuid()}`,
    `\t\tsummarizeBy: none`,
    `\t\tsourceColumn: ${columnName}`,
    ``,
    `\t\tannotation SummarizationSetBy = Automatic`,
    ``,
    `\tmeasure ${quoteName(measureName)} = ${measureExpr}`,
    `\t\tlineageTag: ${uuid()}`,
    ``,
    `\tpartition ${t} = m`,
    `\t\tmode: import`,
    ...mSourceBlock(mBody),
    ``,
    `\tannotation PBI_Id = ${uuid().replace(/-/g, '')}`,
    ``,
  ].join('\n');
}

// M bodies below use RELATIVE indentation (top-level `let`/`in` at 0 tabs).
// `buildSharedExpression` prefixes every line with 2 tabs so the expression
// value sits one level deeper than the `lineageTag` property — TMDL rejects a
// value indented at the same level as a property (UnknownKeyword 'let').

/** M body: UTC datetimezone → Europe/Berlin (CET/CEST, DST-aware). */
const CET_M = [
  `(utc as datetimezone) as datetimezone =>`,
  `let`,
  `\tYear         = Date.Year(DateTimeZone.RemoveZone(utc)),`,
  `\tLastSundayOf = (y as number, m as number) as date =>`,
  `\t\tlet`,
  `\t\t\tLastDay = Date.EndOfMonth(#date(y, m, 1)),`,
  `\t\t\tWd      = Date.DayOfWeek(LastDay, Day.Sunday)`,
  `\t\tin`,
  `\t\t\tDate.AddDays(LastDay, -Wd),`,
  `\tDstStart  = DateTime.From(LastSundayOf(Year, 3))  + #duration(0, 1, 0, 0),`,
  `\tDstEnd    = DateTime.From(LastSundayOf(Year, 10)) + #duration(0, 1, 0, 0),`,
  `\tUtcNaive  = DateTimeZone.RemoveZone(utc),`,
  `\tIsDst     = UtcNaive >= DstStart and UtcNaive < DstEnd,`,
  `\tOffset    = if IsDst then #duration(0, 2, 0, 0) else #duration(0, 1, 0, 0),`,
  `\tResult    = DateTimeZone.SwitchZone(utc + Offset, if IsDst then 2 else 1)`,
  `in`,
  `\tResult`,
];

/** M body: Lars Schreiber calendar-table function (ISO weeks, fiscal year). */
const KALENDER_M = [
  `(StartJahr as number, NumberOfYears as number, optional Culture as nullable text, optional FYStartMonth as nullable text, optional WeekStart as nullable text) as table =>`,
  `let`,
  `\tCulture          = if Culture        = null then "en-us" else Culture,`,
  `\tFYStartMonth     = if FYStartMonth   = null then "Jan"   else FYStartMonth,`,
  `\tWeekStart        = if WeekStart      = null then "Mo"    else WeekStart,`,
  `\tDays             = Number.From(#date(StartJahr + NumberOfYears, 1, 1) - #date(StartJahr, 1, 1)),`,
  `\tSource           = List.Dates(#date(StartJahr, 1, 1), Days, #duration(1, 0, 0, 0)),`,
  `\tAsTable          = Table.FromList(Source, Splitter.SplitByNothing(), {"Date"}),`,
  `\tAddYear          = Table.AddColumn(AsTable, "Year",          each Date.Year([Date]),                            Int64.Type),`,
  `\tAddQuarter       = Table.AddColumn(AddYear, "Quarter",       each "Q" & Text.From(Date.QuarterOfYear([Date])),  type text),`,
  `\tAddMonth         = Table.AddColumn(AddQuarter, "Month",      each Date.Month([Date]),                           Int64.Type),`,
  `\tAddMonthName     = Table.AddColumn(AddMonth, "MonthName",    each Date.MonthName([Date], Culture),              type text),`,
  `\tAddWeekIso       = Table.AddColumn(AddMonthName, "ISOWeek",  each`,
  `\t\tlet`,
  `\t\t\tThu = Date.AddDays([Date], 3 - (Date.DayOfWeek([Date], Day.Monday) + 1) + 1),`,
  `\t\t\tY   = Date.Year(Thu)`,
  `\t\tin`,
  `\t\t\tNumber.RoundDown(Number.From(Thu - #date(Y,1,1))/7) + 1, Int64.Type),`,
  `\tAddDayOfWeek     = Table.AddColumn(AddWeekIso, "DayOfWeek",  each Date.DayOfWeekName([Date], Culture),          type text),`,
  `\tAddDayOfWeekNum  = Table.AddColumn(AddDayOfWeek, "DayOfWeekNumber", each Date.DayOfWeek([Date], if WeekStart = "Mo" then Day.Monday else Day.Sunday) + 1, Int64.Type),`,
  `\tFYStart          = if FYStartMonth = "Jan" then 1 else if FYStartMonth = "Feb" then 2 else if FYStartMonth = "Mar" then 3 else if FYStartMonth = "Apr" then 4 else if FYStartMonth = "May" then 5 else if FYStartMonth = "Jun" then 6 else if FYStartMonth = "Jul" then 7 else if FYStartMonth = "Aug" then 8 else if FYStartMonth = "Sep" then 9 else if FYStartMonth = "Oct" then 10 else if FYStartMonth = "Nov" then 11 else 12,`,
  `\tAddFiscalYear    = Table.AddColumn(AddDayOfWeekNum, "FiscalYear", each if Date.Month([Date]) >= FYStart then Date.Year([Date]) else Date.Year([Date]) - 1, Int64.Type),`,
  `\tAddIsToday       = Table.AddColumn(AddFiscalYear, "IsToday",      each [Date] = Date.From(DateTime.LocalNow()),    type logical),`,
  `\tAddIs2Go         = Table.AddColumn(AddIsToday,    "Is2Go",        each [Date] >= Date.From(DateTime.LocalNow()),   type logical),`,
  `\tResult           = AddIs2Go`,
  `in`,
  `\tResult`,
];

/** Quote a TMDL object name only when it isn't a bare identifier. */
function tmdlName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/**
 * Build a top-level shared-expression block. The M value (`mLines`, supplied at
 * relative indent) is prefixed with 2 tabs so it sits one level below the
 * `lineageTag` property, matching TMDL's multi-line expression grammar.
 */
function buildSharedExpression(name: string, mLines: string[]): string {
  return [
    `expression ${tmdlName(name)} =`,
    ...mLines.map((l) => (l === '' ? '' : `\t\t${l}`)),
    `\tlineageTag: ${uuid()}`,
    ``,
    `\tannotation PBI_NavigationStepName = Navigation`,
  ].join('\n');
}

/**
 * C4 / C5 — add a Last-Refresh table. `localNow` uses `DateTime.LocalNow()`;
 * `europeCet` converts UTC→CET/CEST via a shared DST-aware M function it also
 * creates. No-op when a table of the same name already exists.
 */
export async function addLastRefreshTable(
  workspaceId: string,
  datasetId: string,
  variant: LastRefreshVariant,
  tableName = 'Last Refresh'
): Promise<LastRefreshResult> {
  const name = (tableName || 'Last Refresh').trim() || 'Last Refresh';
  const columnName = 'Last Refresh';

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const modelPart = parts.find((p) => /\/model\.tmdl$/i.test(p.path) && !p.binary);
  if (!modelPart) {
    return { created: false, changed: 0, detail: 'model.tmdl part not found.' };
  }

  const exists =
    parts.some((p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), name) >= 0) ||
    new RegExp(`^ref table ${name}\\b`, 'm').test(modelPart.text);
  if (exists) {
    return { created: false, changed: 0, detail: `A table named "${name}" already exists — using it as-is.` };
  }

  const colRef = `${quoteName(name)}[${columnName.replace(/]/g, ']]')}]`;
  const mBody =
    variant === 'localNow'
      ? ['let', `    Source = #table({"${columnName}"}, {{DateTime.LocalNow()}})`, 'in', '    Source']
      : [
          'let',
          '    UtcNow = DateTimeZone.UtcNow(),',
          '    Cet = #"UTC to CEST/CET"(UtcNow),',
          `    Source = #table({"${columnName}"}, {{DateTime.From(Cet)}})`,
          'in',
          '    Source',
        ];
  const measureExpr =
    variant === 'localNow'
      ? `"Last Refresh: " & FORMAT(MAX(${colRef}), "General Date")`
      : `"Last Refresh (CET): " & FORMAT(MAX(${colRef}), "General Date")`;

  const sampleTablePart = parts.find((p) => /\/tables\/[^/]+\.tmdl$/i.test(p.path));
  const tablesDir = sampleTablePart
    ? sampleTablePart.path.replace(/\/[^/]+\.tmdl$/i, '')
    : 'definition/tables';
  const newTablePath = `${tablesDir}/${sanitizeFileName(name)}.tmdl`;

  // Measures are model-global — derive a unique name from the table so that two
  // Last-Refresh tables (e.g. LocalNow + CET) don't collide on the measure name.
  const allTableText = parts
    .filter((p) => !p.binary && /\/tables\//i.test(p.path))
    .map((p) => p.text)
    .join('\n');
  const measureExists = (m: string) =>
    new RegExp(`^\\s*measure\\s+(?:'${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*=`, 'm').test(allTableText);
  let measureName = `${name} Measure`;
  for (let i = 2; measureExists(measureName); i++) measureName = `${name} Measure ${i}`;

  const edits: Record<string, string> = {
    [newTablePath]: buildLastRefreshTmdl(name, columnName, mBody, measureExpr, measureName),
  };

  // Register the table in model.tmdl.
  const modelLines = modelPart.text.split('\n');
  let lastRef = -1;
  for (let i = 0; i < modelLines.length; i++) {
    if (/^ref table /.test(modelLines[i])) lastRef = i;
  }
  const refLine = `ref table ${quoteName(name)}`;
  if (lastRef >= 0) modelLines.splice(lastRef + 1, 0, refLine);
  else modelLines.push('', refLine);
  edits[modelPart.path] = modelLines.join('\n');

  // CET variant needs the shared conversion function.
  let fnAdded = false;
  if (variant === 'europeCet') {
    fnAdded = appendExpression(parts, edits, 'UTC to CEST/CET', buildSharedExpression('UTC to CEST/CET', CET_M));
  }

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  const fnNote = variant === 'europeCet' ? (fnAdded ? ' + "UTC to CEST/CET" function' : '') : '';
  return {
    created: changed > 0,
    changed,
    detail:
      changed > 0
        ? `Created "${name}" table${fnNote}.`
        : 'No change was written.',
  };
}

/**
 * C7 — add Lars Schreiber's shared M calendar-table function ("Kalenderfunktion").
 * The function itself builds no table; call it from a new query, e.g.
 * `= Kalenderfunktion(2019, 5, "de-de", "Jul", "Mo")`.
 */
export async function addCalendarFunction(
  workspaceId: string,
  datasetId: string
): Promise<ExpressionResult> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const path = expressionsPath(parts);
  const exprPart = parts.find((p) => p.path === path && !p.binary);
  if (exprPart && hasExpressionDecl(exprPart.text, 'Kalenderfunktion')) {
    return { created: false, changed: 0, detail: 'The "Kalenderfunktion" function already exists.' };
  }

  const edits: Record<string, string> = {};
  appendExpression(parts, edits, 'Kalenderfunktion', buildSharedExpression('Kalenderfunktion', KALENDER_M));
  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    created: changed > 0,
    changed,
    detail: changed > 0 ? 'Created the "Kalenderfunktion" calendar function.' : 'No change was written.',
  };
}

/** C9 — list import-mode M tables (with date columns) eligible for incremental refresh. */
export async function scanIncrementalRefreshTargets(
  workspaceId: string,
  datasetId: string
): Promise<IncrRefreshScan> {
  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const targets: IncrRefreshTarget[] = [];

  for (const part of parts) {
    if (part.binary || !/\/tables\//i.test(part.path)) continue;
    const lines = part.text.split('\n');
    const tIdx = lines.findIndex((l) => indentOf(l) === 0 && declName(l, 'table') !== null);
    if (tIdx < 0) continue;
    const table = declName(lines[tIdx], 'table')!;
    const tEnd = tableBlockEnd(lines, tIdx);

    // Find an M import partition + an existing refresh policy.
    let partition: string | null = null;
    let hasPolicy = false;
    for (let i = tIdx + 1; i < tEnd; i++) {
      if (indentOf(lines[i]) === 1) {
        const p = declName(lines[i], 'partition');
        if (p && /=\s*m\s*$/.test(lines[i])) {
          // Confirm mode: import within the next few lines.
          for (let j = i + 1; j < tEnd && indentOf(lines[j]) >= 2; j++) {
            if (/^\t\tmode:\s*import\b/.test(lines[j])) {
              partition = p;
              break;
            }
          }
        }
        if (/^\trefreshPolicy\b/.test(lines[i])) hasPolicy = true;
      }
    }
    if (!partition) continue;

    // Collect date/datetime columns.
    const dateColumns: string[] = [];
    for (let i = tIdx + 1; i < tEnd; i++) {
      const col = indentOf(lines[i]) === 1 ? declName(lines[i], 'column') : null;
      if (!col) continue;
      let dataType = '';
      for (let j = i + 1; j < tEnd; j++) {
        if (indentOf(lines[j]) <= 1 && lines[j].trim() !== '') break;
        const dt = /^\t\tdataType:\s*(\w+)/.exec(lines[j]);
        if (dt) dataType = dt[1];
      }
      if (DATE_TYPES.has(dataType.toLowerCase())) dateColumns.push(col);
    }
    if (dateColumns.length === 0) continue;

    targets.push({ table, partition, dateColumns, hasPolicy });
  }

  targets.sort((a, b) => a.table.localeCompare(b.table));
  return { targets };
}

/** RangeStart / RangeEnd datetime parameter expression block. */
function buildRangeParam(name: string, dt: string): string {
  return [
    `expression ${name} = ${dt} meta [IsParameterQuery=true, Type="DateTime", IsParameterQueryRequired=true]`,
    `\tlineageTag: ${uuid()}`,
    ``,
    `\tannotation PBI_NavigationStepName = Navigation`,
    ``,
    `\tannotation PBI_ResultType = DateTime`,
  ].join('\n');
}

/** Dedent M body lines (strip the common leading tab indent). */
function dedentM(body: string[]): string[] {
  const nonEmpty = body.filter((l) => l.trim() !== '');
  const minTabs = nonEmpty.reduce((min, l) => Math.min(min, indentOf(l)), Infinity);
  const strip = minTabs === Infinity ? 0 : minTabs;
  return body.map((l) => (l.trim() === '' ? '' : l.slice(strip)));
}

/**
 * C9 — add a basic incremental-refresh policy to an import-mode table. Ensures
 * RangeStart/RangeEnd parameters, wraps the partition source with a
 * RangeStart/RangeEnd date filter and attaches a `refreshPolicy basic` block.
 */
export async function addIncrementalRefresh(
  workspaceId: string,
  datasetId: string,
  opts: IncrRefreshOptions
): Promise<IncrRefreshResult> {
  const table = opts.table.trim();
  const dateColumn = opts.dateColumn.trim();
  if (!table || !dateColumn) {
    return { created: false, changed: 0, detail: 'Pick a table and a date column.' };
  }

  const parts = await loadDefinitionParts('model', workspaceId, datasetId);
  const tablePart = parts.find(
    (p) => !p.binary && /\/tables\//i.test(p.path) && findTableDecl(p.text.split('\n'), table) >= 0
  );
  if (!tablePart) {
    return { created: false, changed: 0, detail: `Table "${table}" was not found.` };
  }

  const lines = tablePart.text.split('\n');
  const tIdx = findTableDecl(lines, table);
  const tEnd = tableBlockEnd(lines, tIdx);

  if (lines.slice(tIdx, tEnd).some((l) => /^\trefreshPolicy\b/.test(l))) {
    return { created: false, changed: 0, detail: `Table "${table}" already has a refresh policy.` };
  }

  // Find the M import partition's `source =` block.
  let srcIdx = -1;
  for (let i = tIdx + 1; i < tEnd; i++) {
    if (indentOf(lines[i]) === 1 && declName(lines[i], 'partition') && /=\s*m\s*$/.test(lines[i])) {
      for (let j = i + 1; j < tEnd; j++) {
        if (indentOf(lines[j]) <= 1 && lines[j].trim() !== '') break;
        if (/^\t\tsource\s*=/.test(lines[j])) {
          srcIdx = j;
          break;
        }
      }
      if (srcIdx >= 0) break;
    }
  }
  if (srcIdx < 0) {
    return { created: false, changed: 0, detail: `No M import partition found on "${table}".` };
  }

  // The source body = lines after `source =` while indented deeper than `source =` (2 tabs).
  let bodyEnd = srcIdx + 1;
  while (bodyEnd < tEnd && (lines[bodyEnd].trim() === '' || indentOf(lines[bodyEnd]) >= 3)) bodyEnd++;
  // Trim trailing blank lines out of the captured body.
  let lastNonBlank = bodyEnd - 1;
  while (lastNonBlank > srcIdx && lines[lastNonBlank].trim() === '') lastNonBlank--;
  const rawBody = dedentM(lines.slice(srcIdx + 1, lastNonBlank + 1));
  if (rawBody.length === 0) {
    return { created: false, changed: 0, detail: `Partition source on "${table}" is empty.` };
  }

  const col = `[${dateColumn.replace(/]/g, ']]')}]`;
  const filteredM = [
    'let',
    '    __IRSource =',
    '    (',
    ...rawBody.map((l) => (l === '' ? '' : `        ${l}`)),
    '    ),',
    `    __IRFiltered = Table.SelectRows(__IRSource, each ${col} >= RangeStart and ${col} < RangeEnd)`,
    'in',
    '    __IRFiltered',
  ];

  // Rebuild the partition source with the filtered query and a refreshPolicy block.
  // `refreshPolicy` is an unnamed single object on the table; its type is the
  // `policyType: basic` property (NOT `refreshPolicy basic`, which TMDL parses as
  // a named-object declaration and rejects). The multi-line M `sourceExpression`
  // goes last so the scalar properties terminate cleanly before it.
  const refreshPolicyLines = [
    `\trefreshPolicy`,
    `\t\tpolicyType: basic`,
    `\t\tmode: import`,
    `\t\trollingWindowGranularity: ${opts.storeGranularity}`,
    `\t\trollingWindowPeriods: ${Math.max(1, Math.round(opts.storePeriods))}`,
    `\t\tincrementalGranularity: ${opts.refreshGranularity}`,
    `\t\tincrementalPeriods: ${Math.max(1, Math.round(opts.refreshPeriods))}`,
    `\t\tsourceExpression =`,
    ...filteredM.map((l) => (l === '' ? '' : `\t\t\t\t${l}`)),
  ];

  // Splice: replace old source block, then insert refreshPolicy after the partition block.
  const before = lines.slice(0, srcIdx);
  const after = lines.slice(lastNonBlank + 1);
  const rebuilt = [
    ...before,
    ...mSourceBlock(filteredM),
    '',
    ...refreshPolicyLines,
    ...(after.length && after[0].trim() === '' ? after : ['', ...after]),
  ];

  const edits: Record<string, string> = { [tablePart.path]: rebuilt.join('\n') };
  // Ensure RangeStart / RangeEnd parameters.
  appendExpression(parts, edits, 'RangeStart', buildRangeParam('RangeStart', '#datetime(2024, 1, 1, 0, 0, 0)'));
  appendExpression(parts, edits, 'RangeEnd', buildRangeParam('RangeEnd', '#datetime(2025, 1, 1, 0, 0, 0)'));

  const changed = await saveDefinitionParts('model', workspaceId, datasetId, edits);
  return {
    created: changed > 0,
    changed,
    detail:
      changed > 0
        ? `Added incremental-refresh policy to "${table}" (store ${opts.storePeriods} ${opts.storeGranularity}, refresh ${opts.refreshPeriods} ${opts.refreshGranularity}).`
        : 'No change was written.',
  };
}
