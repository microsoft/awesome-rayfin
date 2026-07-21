/**
 * DAX composer (D2) — build a valid `EVALUATE SUMMARIZECOLUMNS(...)` query from a
 * *typed* spec of measures × dimensions × filters, plus the `FabricColumnMeta` map
 * the live `fabricDataSource` needs to project the result into clean field names.
 *
 * Why: authoring DAX by hand is the highest-friction, most error-prone step of
 * standing up a Fabric data app. This module turns a declarative spec — the shape a
 * Copilot agent can produce deterministically after reading the model's measures and
 * dimensions (via the INFO schema) — into (a) the query string, (b) a stable query id
 * for SWR caching, and (c) the column-metadata map, so the composed query and the
 * page config that reads it can never drift apart.
 *
 * It composes cleanly with **A2**: user selections are still pushed down at runtime by
 * `pushdownQuery`; the composer only builds the *base* query. Filters supplied here are
 * baked-in scope filters (e.g. "FY24 only"), applied via the same
 * `wrapEvaluateWithFilters` / `CALCULATETABLE` transform so there is exactly one DAX
 * escaping + wrapping code path in the package.
 *
 * Zero runtime dependencies — pure string work. Node-testable.
 */

import type { DataQuery } from "../data/data-source";
import type { FabricColumnMeta, FabricColumnMetaMap } from "../data/fabric-data-source";
import { escapeDaxString, daxColumnFilter, wrapEvaluateWithFilters } from "./dax-pushdown";

/**
 * A group-by column. The string form is the fully-qualified DAX column
 * (`"Segment[Segment]"`); the object form adds the presentation metadata the data
 * source projects onto the result (`key`/`label`/`format`).
 */
export type DaxDimension =
  | string
  | { column: string; key?: string; label?: string; format?: string };

/** A measure/expression column in the result, e.g. `{ name: "Revenue", expression: "[Total Revenue]" }`. */
export interface DaxMeasure {
  /** Result column alias — becomes the DAX quoted name and, by default, the header. */
  name: string;
  /** The DAX measure reference or expression, e.g. `"[Total Revenue]"` or `"SUM(Sales[Amt])"`. */
  expression: string;
  /** Field key the page config reads. Defaults to a slug of `name`. */
  key?: string;
  /** Header users see. Defaults to `name`. */
  label?: string;
  /** VBA/ECMA-376 format string carried onto the result column meta. */
  format?: string;
}

/** A baked-in scope filter over a column (distinct from runtime selection pushdown). */
export interface DaxComposerFilter {
  /** Fully-qualified column, e.g. `"Date[Fiscal Year]"`. */
  column: string;
  /** Values to keep (OR within the column). Empty → the filter is skipped. */
  values: string[];
  /** Emit bare numeric literals instead of quoted strings. */
  numeric?: boolean;
}

/** Sort clause. `by` matches a measure `name` (→ `[name]`) or is a column ref verbatim. */
export interface DaxOrderBy {
  by: string;
  dir?: "ASC" | "DESC";
}

export interface DaxComposerSpec {
  /** Group-by columns. */
  dimensions?: DaxDimension[];
  /** Measure/expression columns (at least one dimension OR measure is required). */
  measures?: DaxMeasure[];
  /** Baked-in scope filters, applied via CALCULATETABLE. */
  filters?: DaxComposerFilter[];
  /** Result ordering. */
  orderBy?: DaxOrderBy[];
  /** Keep only the top N rows (by `orderBy`, else first N). */
  topN?: number;
}

function dimColumn(d: DaxDimension): string {
  return typeof d === "string" ? d : d.column;
}

/** Strip the `Table[Col]` / `[Measure]` wrapper → bare label. */
function bareLabel(ref: string): string {
  return ref.replace(/^.*\[/, "").replace(/\]$/, "");
}

/** Deterministic field key: lower-camel-ish slug of a label. */
function slug(label: string): string {
  const cleaned = label.replace(/[^0-9a-zA-Z]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "field";
  return (
    parts[0].toLowerCase() +
    parts.slice(1).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("")
  );
}

/** The exact DAX result name for a measure alias: `Revenue` → `[Revenue]`. */
function measureResultName(name: string): string {
  return `[${name}]`;
}

/** Resolve an ORDER BY / TOPN sort key to its DAX reference. */
function orderRef(by: string, measures: DaxMeasure[]): string {
  return measures.some((m) => m.name === by) ? measureResultName(by) : by;
}

/**
 * Build the DAX text of the composed query (`[DEFINE] EVALUATE SUMMARIZECOLUMNS(…) [ORDER BY …]`).
 * Throws if the spec has neither a dimension nor a measure (SUMMARIZECOLUMNS needs at least one).
 */
export function composeEvaluate(spec: DaxComposerSpec): string {
  const dims = (spec.dimensions ?? []).map(dimColumn);
  const measures = spec.measures ?? [];
  if (!dims.length && !measures.length) {
    throw new Error("composeEvaluate: spec needs at least one dimension or measure.");
  }

  const args: string[] = [...dims];
  for (const m of measures) {
    args.push(escapeDaxString(m.name), m.expression);
  }
  let tableExpr = `SUMMARIZECOLUMNS(\n  ${args.join(",\n  ")}\n)`;

  // TOPN wrap (deterministic when an orderBy is supplied; otherwise first-N).
  if (spec.topN != null && Number.isFinite(spec.topN) && spec.topN > 0) {
    const n = Math.floor(spec.topN);
    // Use the SAME resolved direction as the outer ORDER BY (default ASC) so the
    // sliced rows and the displayed order agree — never "top by DESC, shown ASC".
    const orderPairs = (spec.orderBy ?? [])
      .map((o) => `${orderRef(o.by, measures)}, ${o.dir ?? "ASC"}`)
      .join(", ");
    tableExpr = orderPairs
      ? `TOPN(${n}, ${tableExpr}, ${orderPairs})`
      : `TOPN(${n}, ${tableExpr})`;
  }

  let query = `EVALUATE\n${tableExpr}`;

  if (spec.orderBy && spec.orderBy.length) {
    const clause = spec.orderBy
      .map((o) => `${orderRef(o.by, measures)} ${o.dir ?? "ASC"}`)
      .join(", ");
    query += `\nORDER BY ${clause}`;
  }

  // Baked-in scope filters → CALCULATETABLE (single DAX escaping/wrapping path, shared with A2).
  const filterExprs = (spec.filters ?? [])
    .map((f) => daxColumnFilter({ ref: f.column, numeric: f.numeric }, f.values, f.numeric))
    .filter((e): e is string => e != null);
  if (filterExprs.length) {
    const wrapped = wrapEvaluateWithFilters(query, filterExprs);
    if (wrapped) query = wrapped;
  }

  return query;
}

/** Small, stable, non-crypto hash (djb2) → short base-36 string. */
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * A short, **collision-free** signature of the spec, derived from the *emitted DAX*
 * rather than a hand-rolled field digest. Because the query text already encodes every
 * detail that changes the result — filter `numeric` (`= 1` vs `= "1"`), sort direction,
 * floored `topN`, value ordering — hashing it guarantees that two specs producing
 * different DAX get different ids (no wrong-cache reuse) and identical DAX gets the same
 * id (no needless refetch). This is the SWR/cache key via `composeQuery`.
 */
export function composerSignature(spec: DaxComposerSpec): string {
  return hashString(composeEvaluate(spec));
}

/**
 * Compose the spec into a `DataQuery` (`{ query, id }`) ready for `useDataQuery` /
 * `fabricDataSource`. The id is derived from a stable signature so an unchanged spec
 * re-uses the SWR cache and a changed spec re-runs.
 */
export function composeQuery(spec: DaxComposerSpec, id?: string): DataQuery {
  const query = composeEvaluate(spec);
  return { query, id: id ?? `composed::${composerSignature(spec)}` };
}

/**
 * The `FabricColumnMeta` map for the composed result, **keyed by exact DAX result name**
 * so `fabricDataSource` projects clean field keys/labels/formats. Keeping this next to
 * `composeEvaluate` is the whole point of the composer: the query and the metadata that
 * reads it are generated together and cannot drift.
 *
 * Dimensions are keyed by their column ref (`Segment[Segment]`). Measures are keyed under
 * **both** the bare alias (`Revenue`) and the bracketed form (`[Revenue]`): the package's
 * data contract surfaces SUMMARIZECOLUMNS extension columns as the bare alias, while the
 * raw Power BI *Execute Queries* result names them bracketed. Emitting both means the
 * lookup in `fabricDataSource` (`columns[c.name]`) hits regardless of how the live SDK
 * surfaces the alias — a mismatch would otherwise silently drop the measure's
 * key/label/format/numeric at runtime. Extra unused keys are harmless (the data source
 * only reads the one matching the returned column name).
 */
export function composeColumnMeta(spec: DaxComposerSpec): FabricColumnMetaMap {
  const map: FabricColumnMetaMap = {};
  for (const d of spec.dimensions ?? []) {
    const column = dimColumn(d);
    const obj = typeof d === "string" ? undefined : d;
    map[column] = {
      key: obj?.key ?? slug(bareLabel(column)),
      label: obj?.label ?? bareLabel(column),
      numeric: false,
      format: obj?.format,
    };
  }
  for (const m of spec.measures ?? []) {
    const meta: FabricColumnMeta = {
      key: m.key ?? slug(m.name),
      label: m.label ?? m.name,
      numeric: true,
      format: m.format,
    };
    map[m.name] = meta; // bare alias (package data contract)
    map[measureResultName(m.name)] = meta; // bracketed (raw Execute Queries)
  }
  return map;
}

// ---------------------------------------------------------------------------
// Schema-driven scaffold — the deterministic seam a Copilot agent uses after
// reading the model's measures + dimensions (via the DAX INFO functions).
// ---------------------------------------------------------------------------

/** One measure discovered from the model (INFO.MEASURES / a curated list). */
export interface ModelMeasure {
  /** Display name, e.g. `"Total Revenue"`. */
  name: string;
  /** DAX reference, e.g. `"[Total Revenue]"`. Defaults to `[name]`. */
  expression?: string;
  /** Optional format string from the model. */
  format?: string;
}

/** One group-by dimension discovered from the model (a column suitable for slicing). */
export interface ModelDimension {
  /** Fully-qualified column, e.g. `"Segment[Segment]"`. */
  column: string;
  /** Header override. Defaults to the bare column label. */
  label?: string;
}

export interface ModelSchema {
  measures: ModelMeasure[];
  dimensions: ModelDimension[];
}

export interface ScaffoldOptions {
  /** Which dimension to group by (defaults to the first). */
  dimension?: string;
  /** Cap the measures included (defaults to all). */
  maxMeasures?: number;
  /** Order the result by this measure name, descending. Defaults to the first measure. */
  orderByMeasure?: string;
  /** Keep only the top N rows. */
  topN?: number;
}

/**
 * Build a standard "overview" `DaxComposerSpec` from a discovered model schema —
 * group by one dimension, project the measures, order by a headline measure. This is
 * the deterministic path the scaffold prompt drives so an agent produces the same
 * query + column metadata every time for a given model.
 */
export function scaffoldOverviewSpec(schema: ModelSchema, opts: ScaffoldOptions = {}): DaxComposerSpec {
  if (!schema.measures.length && !schema.dimensions.length) {
    throw new Error("scaffoldOverviewSpec: schema has no measures or dimensions.");
  }
  const dim = schema.dimensions.find((d) => d.column === opts.dimension) ?? schema.dimensions[0];
  const measures: DaxMeasure[] = schema.measures
    .slice(0, opts.maxMeasures ?? schema.measures.length)
    .map((m) => ({
      name: m.name,
      expression: m.expression ?? `[${m.name}]`,
      format: m.format,
    }));

  const spec: DaxComposerSpec = {
    dimensions: dim ? [{ column: dim.column, label: dim.label }] : [],
    measures,
  };

  const orderName = opts.orderByMeasure ?? measures[0]?.name;
  if (orderName) spec.orderBy = [{ by: orderName, dir: "DESC" }];
  if (opts.topN != null) spec.topN = opts.topN;

  return spec;
}
