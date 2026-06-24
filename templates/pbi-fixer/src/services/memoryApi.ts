// Memory Analyzer — VertiPaq footprint analysis.
//
// Two size sources, in order of preference:
//   1. REAL sizes — the storage INFO DAX functions, run through the
//      `executeQueries` proxy, expose the engine's own dictionary + segment
//      bytes without needing the XMLA/DMV endpoint:
//        • INFO.STORAGETABLECOLUMNS()        — per-column DICTIONARY_SIZE
//        • INFO.STORAGETABLECOLUMNSEGMENTS() — per-column data USED_SIZE
//      These need write permission on the model; for import models they cover
//      every column, so the reported KB/MB are exact.
//   2. ESTIMATE fallback — when the storage functions are blocked or only
//      partially resident (e.g. Direct Lake), we derive a cardinality-based
//      estimate from COLUMNSTATISTICS() (distinct count + max length) and
//      INFO.VIEW.TABLES() (row counts). Distinct count dominates VertiPaq
//      memory, so the ranking still tracks the real footprint.
//
// `summary.hasActualSizes` tells the UI which source won, so it can label the
// numbers "actual" vs "estimated".

import { executeDax, loadModelData } from './fabricRest';
import type { ModelData } from '@/explorer/types';
import type { ModelFixKind } from './modelBpaFix';

// ── Row / result shapes ────────────────────────────────────────────

export interface MemoryColumnStat {
  table: string;
  column: string;
  dataType: string;
  cardinality: number;
  maxLength: number;
  /** Row count of the owning table (for granularity findings). */
  rows: number;
  isHidden: boolean;
  isKey: boolean;
  usedInRelationship: boolean;
  /** Estimated dictionary bytes (distinct values × per-value width). */
  estDictBytes: number;
  /** Estimated column data bytes (rows × hash-index bit width / 8). */
  estDataBytes: number;
  estTotalBytes: number;
  /** Number of VertiPaq data segments across all partitions (storage source). */
  segments: number;
  /** Total records stored across those segments (storage source). */
  records: number;
  /** Whether any segment of this column is currently resident in memory. */
  resident: boolean;
  /** Highest VertiPaq access temperature across segments (Direct Lake heat). */
  temperature: number;
  pctOfTable: number;
  pctOfModel: number;
}

export interface MemoryTableStat {
  table: string;
  rows: number;
  columns: number;
  estTotalBytes: number;
  pctOfModel: number;
  isHidden: boolean;
}

export interface MemorySummary {
  tableCount: number;
  columnCount: number;
  totalRows: number;
  estTotalBytes: number;
  /** True when COLUMNSTATISTICS() returned cardinality data. */
  hasCardinality: boolean;
  /** True when sizes are REAL VertiPaq bytes (storage INFO functions), not the
   *  cardinality estimate. */
  hasActualSizes: boolean;
  /** Model is Direct Lake (columns page in/out — residency matters). */
  isDirectLake: boolean;
  /** Columns with at least one segment currently resident in memory. */
  residentColumns: number;
  /** Total VertiPaq data segments across the whole model (storage source). */
  totalSegments: number;
}

export type MemorySeverity = 'High' | 'Medium' | 'Low';

export interface MemoryFinding {
  id: string;
  severity: MemorySeverity;
  category: string;
  title: string;
  detail: string;
  /** `Table[Column]` for column findings, or `Table` for table findings. */
  objectPath: string;
  estTotalBytes: number;
  fixKind?: ModelFixKind;
}

export interface MemoryData {
  summary: MemorySummary;
  columns: MemoryColumnStat[];
  tables: MemoryTableStat[];
  findings: MemoryFinding[];
}

// ── Helpers ────────────────────────────────────────────────────────

/** Read a column from an executeQueries row, tolerating `[Table Name]`,
 *  `COLUMNSTATISTICS()[Cardinality]` or a bare key, case-insensitively. */
function cell(row: Record<string, unknown>, name: string): unknown {
  const target = name.toLowerCase();
  for (const k of Object.keys(row)) {
    const m = k.match(/\[([^\]]+)\]\s*$/);
    const bare = (m ? m[1] : k).toLowerCase();
    if (bare === target) return row[k];
  }
  return undefined;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

function isTrue(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(true|1|yes)$/i.test(v.trim());
  return false;
}

const isStringType = (dt: string): boolean => {
  const d = dt.toLowerCase();
  return d === 'string' || d === 'text';
};
const isDateTimeType = (dt: string): boolean => {
  const d = dt.toLowerCase();
  return d === 'datetime' || d === 'date' || d === 'time';
};

/** Per-value dictionary width (bytes) used by the estimate. */
function perValueBytes(dataType: string, maxLength: number): number {
  if (isStringType(dataType)) return Math.max(maxLength, 1) * 2 + 8; // UTF-16 + overhead
  return 8; // numeric / datetime / boolean
}

/** Estimate column memory from cardinality + rows. Clearly an approximation —
 *  see the module header. Dictionary ∝ distinct values; data ∝ rows × index
 *  bit width (ceil(log2(cardinality))). */
function estimateColumnBytes(
  cardinality: number,
  rows: number,
  dataType: string,
  maxLength: number
): { dict: number; data: number; total: number } {
  const dict = cardinality * perValueBytes(dataType, maxLength);
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(cardinality, 2))));
  const data = (rows * bits) / 8;
  return { dict, data, total: dict + data };
}

/** Real per-column VertiPaq bytes (dictionary + data segments) plus the
 *  per-segment / residency detail that the segments query also exposes. */
interface StorageSize {
  dict: number;
  data: number;
  total: number;
  segments: number;
  records: number;
  resident: boolean;
  temperature: number;
}

/**
 * Read REAL per-column VertiPaq sizes via the storage INFO functions. Maps the
 * friendly `Table[Column]` to dictionary + data bytes by joining
 * INFO.STORAGETABLECOLUMNS() (dictionary size, ATTRIBUTE_NAME, COLUMN_ID) with
 * INFO.STORAGETABLECOLUMNSEGMENTS() (USED_SIZE per segment) on table +
 * COLUMN_ID. Returns null when the functions are unavailable (no write
 * permission, blocked, or no rows) so the caller falls back to the estimate.
 */
async function loadStorageSizes(
  workspaceId: string,
  datasetId: string
): Promise<Map<string, StorageSize> | null> {
  const [colRows, segRows] = await Promise.all([
    executeDax(workspaceId, datasetId, 'EVALUATE INFO.STORAGETABLECOLUMNS()').catch(
      () => [] as Record<string, unknown>[]
    ),
    executeDax(workspaceId, datasetId, 'EVALUATE INFO.STORAGETABLECOLUMNSEGMENTS()').catch(
      () => [] as Record<string, unknown>[]
    ),
  ]);
  if (colRows.length === 0) return null;

  // Sum USED_SIZE per (table, column id) across all segments — that's the
  // hash-encoded data size for the column — and capture the per-segment detail
  // (segment count, records, residency, temperature) alongside it. For Direct
  // Lake the residency/temperature flags say which columns are paged in.
  const dataByColId = new Map<string, number>();
  const segsByColId = new Map<string, number>();
  const recsByColId = new Map<string, number>();
  const residentByColId = new Map<string, boolean>();
  const tempByColId = new Map<string, number>();
  for (const r of segRows) {
    const tbl = toStr(cell(r, 'DIMENSION_NAME'));
    const colId = toStr(cell(r, 'COLUMN_ID'));
    if (!tbl || !colId) continue;
    const k = `${tbl}\u0000${colId}`;
    dataByColId.set(k, (dataByColId.get(k) ?? 0) + toNum(cell(r, 'USED_SIZE')));
    segsByColId.set(k, (segsByColId.get(k) ?? 0) + 1);
    recsByColId.set(k, (recsByColId.get(k) ?? 0) + toNum(cell(r, 'RECORDS')));
    if (isTrue(cell(r, 'ISRESIDENT'))) residentByColId.set(k, true);
    const t = toNum(cell(r, 'TEMPERATURE'));
    if (t > (tempByColId.get(k) ?? 0)) tempByColId.set(k, t);
  }

  // Map friendly Table[Column] → dictionary + data bytes for real user columns.
  const sizes = new Map<string, StorageSize>();
  for (const r of colRows) {
    const tbl = toStr(cell(r, 'DIMENSION_NAME'));
    const colName = toStr(cell(r, 'ATTRIBUTE_NAME'));
    if (!tbl || !colName) continue;
    // Skip relationship / hierarchy / id structures — only data columns carry a
    // user-facing attribute name we can join to the model.
    const colType = toStr(cell(r, 'COLUMN_TYPE')).toUpperCase();
    if (colType && colType !== 'BASIC_DATA' && colType !== 'CALCULATED_DATA') continue;
    const colId = toStr(cell(r, 'COLUMN_ID'));
    const ck = colId ? `${tbl}\u0000${colId}` : '';
    const dict = toNum(cell(r, 'DICTIONARY_SIZE'));
    const data = ck ? dataByColId.get(ck) ?? 0 : 0;
    const records = ck ? recsByColId.get(ck) ?? 0 : 0;
    const total = dict + data;
    // Keep paged-out Direct Lake columns (total 0) when they still report
    // segment records, so residency/segment detail survives the join.
    if (total <= 0 && records <= 0) continue;
    sizes.set(`${tbl}[${colName}]`, {
      dict,
      data,
      total,
      segments: ck ? segsByColId.get(ck) ?? 0 : 0,
      records,
      resident: ck ? residentByColId.get(ck) ?? false : false,
      temperature: ck ? tempByColId.get(ck) ?? 0 : 0,
    });
  }
  return sizes.size > 0 ? sizes : null;
}

// ── Loader ─────────────────────────────────────────────────────────

/**
 * Load cardinality-based memory statistics for the connected model. Runs
 * COLUMNSTATISTICS() and INFO.VIEW.TABLES() through the executeQueries proxy,
 * joins them with the already-parsed `ModelData` (data types, hidden flags,
 * relationships, sort-by + hierarchy usage), and derives per-column / per-table
 * estimates plus a set of memory findings.
 */
export async function loadMemoryData(
  workspaceId: string,
  datasetId: string,
  model: ModelData
): Promise<MemoryData> {
  // Cardinality, row counts and real VertiPaq sizes are all best-effort: each
  // is tolerated to fail (blocked DMV / no write permission / Direct Lake) so
  // the analyzer still renders whatever it can.
  const [statRows, tableRows, storage] = await Promise.all([
    executeDax(workspaceId, datasetId, 'EVALUATE COLUMNSTATISTICS()').catch(() => [] as Record<string, unknown>[]),
    executeDax(workspaceId, datasetId, 'EVALUATE INFO.VIEW.TABLES()').catch(() => [] as Record<string, unknown>[]),
    loadStorageSizes(workspaceId, datasetId).catch(() => null),
  ]);

  // Row counts per table from INFO.VIEW.TABLES().
  const rowsByTable = new Map<string, number>();
  for (const r of tableRows) {
    const name = toStr(cell(r, 'Name'));
    if (name) rowsByTable.set(name, toNum(cell(r, 'RowsCount')));
  }

  // Cardinality + max length per `Table[Column]`.
  const cardByKey = new Map<string, { cardinality: number; maxLength: number }>();
  for (const r of statRows) {
    const t = toStr(cell(r, 'Table Name'));
    const c = toStr(cell(r, 'Column Name'));
    if (!t || !c) continue;
    cardByKey.set(`${t}[${c}]`, {
      cardinality: toNum(cell(r, 'Cardinality')),
      maxLength: toNum(cell(r, 'Max Length')),
    });
  }

  // Sets describing how each column is referenced, used to decide which
  // attribute hierarchies are safe to disable.
  const relColumns = new Set<string>();
  for (const rel of model.relationships) {
    if (rel.fromTable && rel.fromColumn) relColumns.add(`${rel.fromTable}[${rel.fromColumn}]`);
    if (rel.toTable && rel.toColumn) relColumns.add(`${rel.toTable}[${rel.toColumn}]`);
  }
  const mdxNeeded = new Set<string>(); // sort-by targets + hierarchy levels
  for (const [tName, t] of Object.entries(model.tables)) {
    for (const col of Object.values(t.columns)) {
      if (col.sortByColumn) mdxNeeded.add(`${tName}[${col.sortByColumn}]`);
    }
    for (const h of Object.values(t.hierarchies)) {
      for (const lvl of h.levels) mdxNeeded.add(`${tName}[${lvl}]`);
    }
  }

  // Build per-column stats with estimated sizes first.
  const columns: MemoryColumnStat[] = [];
  for (const [tName, t] of Object.entries(model.tables)) {
    const rows = rowsByTable.get(tName) ?? 0;
    for (const [cName, col] of Object.entries(t.columns)) {
      if (cName.startsWith('RowNumber-')) continue;
      const key = `${tName}[${cName}]`;
      const stat = cardByKey.get(key);
      const cardinality = stat?.cardinality ?? 0;
      const maxLength = stat?.maxLength ?? 0;
      const est = estimateColumnBytes(cardinality, rows, col.dataType, maxLength);
      columns.push({
        table: tName,
        column: cName,
        dataType: col.dataType,
        cardinality,
        maxLength,
        rows,
        isHidden: col.isHidden,
        isKey: col.isKey,
        usedInRelationship: relColumns.has(key),
        estDictBytes: est.dict,
        estDataBytes: est.data,
        estTotalBytes: est.total,
        segments: 0,
        records: 0,
        resident: false,
        temperature: 0,
        pctOfTable: 0,
        pctOfModel: 0,
      });
    }
  }

  // Attach per-segment / residency detail from the storage functions wherever
  // it's available — independent of the size-source decision below, so Direct
  // Lake models still surface residency even when sizes fall back to estimate.
  if (storage) {
    for (const c of columns) {
      const s = storage.get(`${c.table}[${c.column}]`);
      if (s) {
        c.segments = s.segments;
        c.records = s.records;
        c.resident = s.resident;
        c.temperature = s.temperature;
      }
    }
  }

  // Prefer REAL VertiPaq sizes when the storage INFO functions covered enough of
  // the model (≥ 50% of columns). Below that (e.g. a mostly non-resident Direct
  // Lake model) the cardinality estimate is the more complete picture.
  let hasActualSizes = false;
  if (storage && columns.length > 0) {
    let covered = 0;
    for (const c of columns) if (storage.has(`${c.table}[${c.column}]`)) covered++;
    if (covered / columns.length >= 0.5) {
      hasActualSizes = true;
      for (const c of columns) {
        const s = storage.get(`${c.table}[${c.column}]`);
        c.estDictBytes = s?.dict ?? 0;
        c.estDataBytes = s?.data ?? 0;
        c.estTotalBytes = s?.total ?? 0;
      }
    }
  }

  // Aggregate to tables + model once the size source is settled.
  const tableBytes = new Map<string, number>();
  for (const c of columns) tableBytes.set(c.table, (tableBytes.get(c.table) ?? 0) + c.estTotalBytes);
  const modelBytes = columns.reduce((s, c) => s + c.estTotalBytes, 0);
  for (const c of columns) {
    const tBytes = tableBytes.get(c.table) ?? 0;
    c.pctOfTable = tBytes > 0 ? (c.estTotalBytes / tBytes) * 100 : 0;
    c.pctOfModel = modelBytes > 0 ? (c.estTotalBytes / modelBytes) * 100 : 0;
  }
  columns.sort((a, b) => b.estTotalBytes - a.estTotalBytes);

  const tables: MemoryTableStat[] = Object.entries(model.tables).map(([tName, t]) => ({
    table: tName,
    rows: rowsByTable.get(tName) ?? 0,
    columns: Object.keys(t.columns).filter((c) => !c.startsWith('RowNumber-')).length,
    estTotalBytes: tableBytes.get(tName) ?? 0,
    pctOfModel: modelBytes > 0 ? ((tableBytes.get(tName) ?? 0) / modelBytes) * 100 : 0,
    isHidden: t.isHidden,
  }));
  tables.sort((a, b) => b.estTotalBytes - a.estTotalBytes);

  const summary: MemorySummary = {
    tableCount: tables.length,
    columnCount: columns.length,
    totalRows: [...rowsByTable.values()].reduce((s, n) => s + n, 0),
    estTotalBytes: modelBytes,
    hasCardinality: cardByKey.size > 0,
    hasActualSizes,
    isDirectLake: (model.modelProperties?.defaultMode || '').toLowerCase() === 'directlake',
    residentColumns: columns.filter((c) => c.resident).length,
    totalSegments: columns.reduce((s, c) => s + c.segments, 0),
  };

  const findings = buildFindings(columns, mdxNeeded, summary.hasCardinality, hasActualSizes);

  return { summary, columns, tables, findings };
}

// ── Findings ───────────────────────────────────────────────────────

const HIGH_CARD_ABS = 1_000_000; // distinct values that dominate any model
const DATETIME_CARD = 5_000; // a date column rarely needs this many distinct values
const ATTR_HIER_MIN_CARD = 100; // ignore tiny attribute hierarchies (negligible)

function buildFindings(
  columns: MemoryColumnStat[],
  mdxNeeded: Set<string>,
  hasCardinality: boolean,
  hasActualSizes: boolean
): MemoryFinding[] {
  if (!hasCardinality) return [];
  const findings: MemoryFinding[] = [];
  const basis = hasActualSizes ? 'actual' : 'estimated';

  for (const c of columns) {
    const path = `${c.table}[${c.column}]`;

    // 1) High-cardinality memory hotspot. Severity scales with the share of
    //    the model's footprint this single column represents.
    if (c.cardinality >= HIGH_CARD_ABS || c.pctOfModel >= 10) {
      const sev: MemorySeverity = c.pctOfModel >= 25 ? 'High' : c.pctOfModel >= 10 ? 'Medium' : 'Low';
      findings.push({
        id: `highcard:${path}`,
        severity: sev,
        category: 'High cardinality',
        title: 'High-cardinality column dominates memory',
        detail: `${c.cardinality.toLocaleString()} distinct values — about ${c.pctOfModel.toFixed(1)}% of the model's ${basis} footprint. Reduce precision, split, or remove the column if it isn't needed for analysis.`,
        objectPath: path,
        estTotalBytes: c.estTotalBytes,
      });
    }

    // 2) Near-unique column on a large table that isn't a relationship key.
    //    Row-level granularity barely compresses, so these are prime removal
    //    candidates when they aren't needed for analysis.
    if (
      !c.usedInRelationship &&
      !c.isKey &&
      c.rows >= 100_000 &&
      c.cardinality >= c.rows * 0.9 &&
      c.pctOfModel >= 5
    ) {
      findings.push({
        id: `unique:${path}`,
        severity: c.pctOfModel >= 15 ? 'High' : 'Medium',
        category: 'Over-granular column',
        title: 'Near-unique column on a large table',
        detail: `${c.cardinality.toLocaleString()} distinct values across ${c.rows.toLocaleString()} rows (≈ row-level uniqueness) and it isn't used in any relationship. Columns this granular barely compress — drop it, or move it to a detail table reached on demand, if it isn't needed for analysis.`,
        objectPath: path,
        estTotalBytes: c.estTotalBytes,
      });
    }

    // 2) DateTime column carrying a time component (very high distinct count).
    if (isDateTimeType(c.dataType) && c.cardinality >= DATETIME_CARD) {
      findings.push({
        id: `datetime:${path}`,
        severity: c.cardinality >= 50_000 ? 'High' : 'Medium',
        category: 'Date/time split',
        title: 'DateTime column likely carries a time component',
        detail: `${c.cardinality.toLocaleString()} distinct values suggests a date+time column. Splitting it into separate Date and Time columns collapses cardinality and saves substantial memory.`,
        objectPath: path,
        estTotalBytes: c.estTotalBytes,
      });
    }

    // 3) Hidden column with a redundant attribute hierarchy. Disabling
    //    IsAvailableInMdx frees the attribute hierarchy (memory ∝ cardinality)
    //    when the column isn't reached via MDX (sort-by / user hierarchy).
    //    Auto-fixable and fully reversible.
    if (
      c.isHidden &&
      c.cardinality >= ATTR_HIER_MIN_CARD &&
      !mdxNeeded.has(`${c.table}[${c.column}]`)
    ) {
      findings.push({
        id: `attrhier:${path}`,
        severity: c.cardinality >= 100_000 ? 'Medium' : 'Low',
        category: 'Attribute hierarchy',
        title: 'Hidden column keeps an unused attribute hierarchy',
        detail: `Hidden column with ${c.cardinality.toLocaleString()} distinct values still builds an attribute hierarchy. Set IsAvailableInMdx to false to free that memory (applies to import models; safe to revert).`,
        objectPath: path,
        estTotalBytes: c.estTotalBytes,
        fixKind: 'DisableAttributeHierarchy',
      });
    }

    // 4) Segment fragmentation — a sizeable column spread across many
    //    under-filled segments wastes per-segment overhead. Only meaningful
    //    with real storage stats (segment counts come from the storage source).
    if (hasActualSizes && c.segments >= 4 && c.records > 0 && c.estTotalBytes > 1_000_000) {
      const perSeg = c.records / c.segments;
      if (perSeg < 1_000_000) {
        findings.push({
          id: `segfrag:${path}`,
          severity: 'Low',
          category: 'Segment fragmentation',
          title: 'Column stored in many small segments',
          detail: `${c.segments} segments holding ${c.records.toLocaleString()} records (≈ ${Math.round(perSeg).toLocaleString()} per segment). Under-filled segments add dictionary and header overhead — a full refresh repacks them into fewer, denser segments.`,
          objectPath: path,
          estTotalBytes: c.estTotalBytes,
        });
      }
    }
  }

  const sevRank: Record<MemorySeverity, number> = { High: 0, Medium: 1, Low: 2 };
  findings.sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || b.estTotalBytes - a.estTotalBytes
  );
  return findings;
}

// ── Formatters ─────────────────────────────────────────────────────

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2)} ${UNITS[unit]}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString();
}

// ── Multi-model comparison ───────────────────────────────────────────

/** One row of the model-comparison table. */
export interface ModelMemorySummary {
  datasetId: string;
  datasetName: string;
  tableCount: number;
  columnCount: number;
  totalRows: number;
  estTotalBytes: number;
  hasActualSizes: boolean;
  isDirectLake: boolean;
  findingCount: number;
  /** Largest single column, `Table[Column]`. */
  topColumn: string;
  topColumnBytes: number;
  /** Set when the model failed to analyze (the rest of the row is zeroed). */
  error?: string;
}

/**
 * Analyze several models in the same workspace concurrently and return a
 * footprint summary per model, sorted largest-first. Each model is loaded and
 * measured independently (Promise.all), and a single model's failure is
 * captured on its own row instead of failing the whole batch.
 */
export async function analyzeModelsParallel(
  workspaceId: string,
  datasets: { id: string; name: string }[]
): Promise<ModelMemorySummary[]> {
  const results = await Promise.all(
    datasets.map(async (d): Promise<ModelMemorySummary> => {
      try {
        const model = await loadModelData(workspaceId, d.id, d.name);
        const mem = await loadMemoryData(workspaceId, d.id, model);
        const top = mem.columns[0];
        return {
          datasetId: d.id,
          datasetName: d.name,
          tableCount: mem.summary.tableCount,
          columnCount: mem.summary.columnCount,
          totalRows: mem.summary.totalRows,
          estTotalBytes: mem.summary.estTotalBytes,
          hasActualSizes: mem.summary.hasActualSizes,
          isDirectLake: mem.summary.isDirectLake,
          findingCount: mem.findings.length,
          topColumn: top ? `${top.table}[${top.column}]` : '—',
          topColumnBytes: top?.estTotalBytes ?? 0,
        };
      } catch (e) {
        return {
          datasetId: d.id,
          datasetName: d.name,
          tableCount: 0,
          columnCount: 0,
          totalRows: 0,
          estTotalBytes: 0,
          hasActualSizes: false,
          isDirectLake: false,
          findingCount: 0,
          topColumn: '—',
          topColumnBytes: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
  return results.sort((a, b) => b.estTotalBytes - a.estTotalBytes);
}
