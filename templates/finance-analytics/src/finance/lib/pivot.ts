import type { CellValue, DataTable } from "./types";

export type Aggregation = "sum" | "avg" | "count" | "max" | "min";

export interface PivotConfig {
  rowDim: string;
  colDim?: string;
  measure: string;
  agg?: Aggregation;
}

export interface PivotResult {
  colKeys: string[];
  rows: { key: string; values: number[]; total: number }[];
  colTotals: number[];
  grandTotal: number;
}

function aggregate(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case "count": return values.length;
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "max": return Math.max(...values);
    case "min": return Math.min(...values);
    default: return values.reduce((a, b) => a + b, 0);
  }
}

/** Pure client-side pivot. No deps. Groups rows by rowDim (and optional colDim),
 *  aggregating `measure`. Totals re-aggregate from RAW values (correct for avg/min/max,
 *  not a sum-of-aggregates). Returns a render-ready matrix. */
export function pivot(table: DataTable, config: PivotConfig): PivotResult {
  const { rowDim, colDim, measure, agg = "sum" } = config;
  const colSet = new Set<string>();
  const cellValues = new Map<string, Map<string, number[]>>();
  const rowRaw = new Map<string, number[]>();

  for (const row of table.rows) {
    const rKey = String(row[rowDim] ?? "—");
    const cKey = colDim ? String(row[colDim] ?? "—") : "Total";
    colSet.add(cKey);
    const num = Number(row[measure]);
    if (Number.isNaN(num)) continue;
    if (!cellValues.has(rKey)) cellValues.set(rKey, new Map());
    const r = cellValues.get(rKey)!;
    if (!r.has(cKey)) r.set(cKey, []);
    r.get(cKey)!.push(num);
    if (!rowRaw.has(rKey)) rowRaw.set(rKey, []);
    rowRaw.get(rKey)!.push(num);
  }

  const colKeys = [...colSet].sort();
  const rows = [...cellValues.entries()].map(([key, cols]) => ({
    key,
    values: colKeys.map((c) => aggregate(cols.get(c) ?? [], agg)),
    total: aggregate(rowRaw.get(key) ?? [], agg),
  }));
  rows.sort((a, b) => b.total - a.total);

  const colRaw = colKeys.map(() => [] as number[]);
  const allRaw: number[] = [];
  for (const cols of cellValues.values()) {
    colKeys.forEach((c, i) => {
      const vals = cols.get(c);
      if (vals) { colRaw[i].push(...vals); allRaw.push(...vals); }
    });
  }
  const colTotals = colRaw.map((vals) => aggregate(vals, agg));
  const grandTotal = aggregate(allRaw, agg);
  return { colKeys, rows, colTotals, grandTotal };
}

// ---------------------------------------------------------------------------
// Hierarchical pivot builder (multi row-dim + multiple measures + optional colDim)
// ---------------------------------------------------------------------------

export interface PivotMeasure {
  /** Numeric column to aggregate. */
  column: string;
  /** Aggregation to apply (defaults to "sum"). */
  agg?: Aggregation;
  /** Optional display label (defaults to a derived "Agg of Column"). */
  label?: string;
}

export interface PivotBuilderConfig {
  /** Ordered list of category columns forming the row hierarchy (outer → inner). */
  rowDims: string[];
  /** Optional single category column pivoted across the top. */
  colDim?: string;
  /** One or more measures rendered as value columns (per column group). */
  measures: PivotMeasure[];
}

/** One rendered row of the hierarchy (any level). */
export interface PivotNode {
  /** Stable id = the path values joined; used for expand/collapse state. */
  id: string;
  /** The dimension value at this node's depth. */
  label: string;
  /** 0-based depth in the row hierarchy. */
  depth: number;
  /** Full path of dim values from the root to this node. */
  path: string[];
  /** True when this node has deeper children (expandable). */
  hasChildren: boolean;
  /** Number of matching source rows (for "n" badges). */
  count: number;
  /** Flat cell values, laid out as colGroups × measures (row-major by group). */
  cells: number[];
}

export interface PivotBuilderResult {
  /** Distinct pivot-column values (empty when no colDim). */
  colKeys: string[];
  hasColDim: boolean;
  measures: PivotMeasure[];
  /** Column groups rendered left→right: the colKeys then a trailing "Total". */
  colGroups: string[];
  /** Depth-first list of every node at every level (render honors expand state). */
  nodes: PivotNode[];
  /** Grand totals, same layout as PivotNode.cells. */
  grandTotals: number[];
  /** Count of deepest-level groups (for "N groups"). */
  leafCount: number;
}

const TOTAL_GROUP = "Total";

export function measureLabel(m: PivotMeasure, table?: DataTable): string {
  if (m.label) return m.label;
  const col = table?.columns.find((c) => c.key === m.column);
  const name = col?.label ?? m.column;
  const agg = m.agg ?? "sum";
  const pretty = agg.charAt(0).toUpperCase() + agg.slice(1);
  return `${pretty} of ${name}`;
}

type Row = Record<string, CellValue>;

function computeCells(subset: Row[], colGroups: string[], hasColDim: boolean, colDim: string | undefined, measures: PivotMeasure[]): number[] {
  const cells: number[] = [];
  for (const g of colGroups) {
    const gRows = !hasColDim || g === TOTAL_GROUP ? subset : subset.filter((r) => String(r[colDim!] ?? "—") === g);
    for (const m of measures) {
      const vals: number[] = [];
      for (const r of gRows) {
        const n = Number(r[m.column]);
        if (!Number.isNaN(n)) vals.push(n);
      }
      cells.push(aggregate(vals, m.agg ?? "sum"));
    }
  }
  return cells;
}

/**
 * Build a hierarchical pivot: rows are grouped by an ordered list of `rowDims`
 * (each level expandable, with its own subtotal), values are one or more
 * `measures`, optionally pivoted across a single `colDim`. Every subtotal /
 * grand-total re-aggregates from RAW values (correct for avg/min/max), never a
 * sum-of-aggregates. Zero deps, fully client-side.
 */
export function buildPivot(table: DataTable, config: PivotBuilderConfig): PivotBuilderResult {
  const rowDims = config.rowDims.filter(Boolean);
  const measures = config.measures.length ? config.measures : [];
  const hasColDim = Boolean(config.colDim);

  const colKeys = hasColDim
    ? [...new Set(table.rows.map((r) => String(r[config.colDim!] ?? "—")))].sort()
    : [];
  const colGroups = hasColDim ? [...colKeys, TOTAL_GROUP] : [TOTAL_GROUP];

  const cellsOf = (subset: Row[]) => computeCells(subset, colGroups, hasColDim, config.colDim, measures);
  // Sort key = the trailing Total group's first measure (largest first).
  const sortIndex = (colGroups.length - 1) * Math.max(measures.length, 1);

  const nodes: PivotNode[] = [];
  let leafCount = 0;

  const walk = (subset: Row[], dims: string[], depth: number, prefix: string[]) => {
    const [dim, ...rest] = dims;
    const groups = new Map<string, Row[]>();
    for (const r of subset) {
      const key = String(r[dim] ?? "—");
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
    const entries = [...groups.entries()].map(([key, rows]) => {
      const path = [...prefix, key];
      return { key, rows, path, cells: cellsOf(rows) };
    });
    entries.sort((a, b) => (b.cells[sortIndex] ?? 0) - (a.cells[sortIndex] ?? 0));
    for (const e of entries) {
      const hasChildren = rest.length > 0;
      nodes.push({
        id: e.path.join(" / "),
        label: e.key,
        depth,
        path: e.path,
        hasChildren,
        count: e.rows.length,
        cells: e.cells,
      });
      if (hasChildren) walk(e.rows, rest, depth + 1, e.path);
      else leafCount += 1;
    }
  };

  if (rowDims.length && measures.length) walk(table.rows, rowDims, 0, []);

  return {
    colKeys,
    hasColDim,
    measures,
    colGroups,
    nodes,
    grandTotals: measures.length ? cellsOf(table.rows) : [],
    leafCount,
  };
}
