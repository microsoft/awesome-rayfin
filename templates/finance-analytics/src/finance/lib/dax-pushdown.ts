/**
 * DAX selection pushdown (A2) — compose the app's canonical, host-owned `FilterState`
 * into the base DAX query so **the semantic model does the filtering**, not the client.
 *
 * Why: the standardized shell filters the fetched `DataTable` in-browser
 * (`applyFilters`). That's perfect for a summarized result, but on a large model the
 * honest, Fabric-native move is to fold the active selection into the `EVALUATE` and let
 * the engine filter at the source. This module is the pure, node-testable transform that
 * turns `FilterState` + a column map into a re-keyed `DataQuery`; the app hands the new
 * query to `useDataQuery`, whose SWR cache keys off the query id, so a selection change
 * simply re-runs the (now-filtered) query against the model.
 *
 * It is intentionally **opt-in** and **conservative**:
 * - Only columns present in the supplied `map` are pushed down; everything else stays
 *   client-side (so it composes with period filters and un-mapped columns).
 * - The transform wraps the single `EVALUATE` table expression in `CALCULATETABLE(expr,
 *   <filters>)`, preserving any leading `DEFINE` block and trailing `ORDER BY` / `START AT`
 *   clause. Queries it can't safely rewrite (no `EVALUATE`, or multiple statements) are
 *   returned unchanged — pushdown degrades to client-side filtering, never breaks.
 * - Values are DAX-escaped (string literals double their quotes; numeric columns emit bare
 *   numbers) so a selection value can't inject DAX.
 *
 * Zero runtime dependencies — pure string work over `FilterState`.
 */

import type { DataQuery } from "../data/data-source";
import type { FilterState } from "./filters";

/**
 * How one `FilterState` key maps to a DAX column reference. The string form is the fully
 * qualified column (`"Segment[Segment]"`); the object form adds `numeric` so numeric
 * dimension values are emitted as bare DAX numbers instead of quoted strings.
 */
export type DaxColumnRef = string | { ref: string; numeric?: boolean };

/** Map of `FilterState` key → DAX column reference. Only mapped columns are pushed down. */
export type DaxColumnMap = Record<string, DaxColumnRef>;

function refOf(r: DaxColumnRef): string {
  return typeof r === "string" ? r : r.ref;
}
function isNumericRef(r: DaxColumnRef): boolean {
  return typeof r === "string" ? false : r.numeric === true;
}

/** Escape a DAX string literal: wrap in double quotes, doubling any interior quote. */
export function escapeDaxString(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A single value as a DAX literal. Numeric columns emit a bare number when the value
 * parses as a finite number (else fall back to a quoted string so we never emit invalid
 * DAX); non-numeric columns always emit an escaped string literal.
 */
export function daxLiteral(value: string, numeric: boolean): string {
  if (numeric) {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) return String(n);
  }
  return escapeDaxString(value);
}

/**
 * A boolean filter expression for one column, e.g. `Segment[Segment] = "Surface"` (single
 * value) or `Segment[Segment] IN { "A", "B" }` (multiple). Returns `null` for an empty
 * value list. Exported for testing and reuse.
 */
export function daxColumnFilter(ref: DaxColumnRef, values: string[], _numeric?: boolean): string | null {
  const vals = values.filter((v) => v !== "" && v != null);
  if (!vals.length) return null;
  const column = refOf(ref);
  const numeric = _numeric ?? isNumericRef(ref);
  const literals = vals.map((v) => daxLiteral(v, numeric));
  if (literals.length === 1) return `${column} = ${literals[0]}`;
  return `${column} IN { ${literals.join(", ")} }`;
}

/** The `FilterState` keys that this map can push down (present in both the state and the map). */
export function pushableColumns(filters: FilterState, map: DaxColumnMap): string[] {
  return Object.keys(map).filter((k) => {
    const v = filters[k];
    return v !== undefined && v !== "" && v != null;
  });
}

/**
 * The list of DAX boolean filter expressions for the active, mappable filters, in stable
 * (sorted-by-key) order so the produced query and its id are deterministic.
 */
export function filtersToDaxFilters(filters: FilterState, map: DaxColumnMap): string[] {
  const out: string[] = [];
  for (const key of pushableColumns(filters, map).sort()) {
    const expr = daxColumnFilter(map[key], [filters[key]]);
    if (expr) out.push(expr);
  }
  return out;
}

/** Positions of top-level (paren-depth 0, outside string literals) keyword matches. */
function topLevelKeywordIndex(text: string, keyword: RegExp): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++; // escaped quote
        else inStr = false;
      }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      keyword.lastIndex = i;
      const m = keyword.exec(text);
      if (m && m.index === i) return i;
    }
  }
  return -1;
}

/**
 * Wrap the single `EVALUATE` table expression of a DAX query in
 * `CALCULATETABLE(<expr>, <filter…>)`, preserving a leading `DEFINE` block and any trailing
 * `ORDER BY` / `START AT` clause. Returns `null` when the query can't be safely rewritten
 * (no `EVALUATE`, or more than one `EVALUATE` statement) so callers fall back to the base
 * query. No filters → returns the query text unchanged.
 */
export function wrapEvaluateWithFilters(queryText: string, filters: string[]): string | null {
  if (!filters.length) return queryText;

  const evalRe = /\bEVALUATE\b/gi;
  const matches = [...queryText.matchAll(evalRe)];
  if (matches.length !== 1) return null; // 0 or multiple EVALUATE statements — don't rewrite.

  const evalIdx = matches[0].index ?? -1;
  if (evalIdx < 0) return null;

  const prefix = queryText.slice(0, evalIdx + "EVALUATE".length); // includes DEFINE… + EVALUATE
  const afterEval = queryText.slice(evalIdx + "EVALUATE".length);

  // Split off a trailing top-level ORDER BY / START AT clause from the table expression.
  const orderIdx = topLevelKeywordIndex(afterEval, /\bORDER\s+BY\b/gi);
  const bodyEnd = orderIdx >= 0 ? orderIdx : afterEval.length;
  const tableExpr = afterEval.slice(0, bodyEnd).trim();
  const suffix = afterEval.slice(bodyEnd); // "" or " ORDER BY … [START AT …]"
  if (!tableExpr) return null;

  const filterArgs = filters.map((f) => `\n  ${f}`).join(",");
  const wrapped = `CALCULATETABLE(\n  ${tableExpr},${filterArgs}\n)`;
  const suffixText = suffix.trim() ? `\n${suffix.trim()}` : "";
  return `${prefix}\n${wrapped}${suffixText}`;
}

/** A short, stable signature of the pushed filters, used to re-key the query for SWR. */
function filterKey(filters: FilterState, map: DaxColumnMap): string {
  return pushableColumns(filters, map)
    .sort()
    .map((k) => `${k}=${filters[k]}`)
    .join("&");
}

/**
 * Compose the active, mappable `FilterState` into `base` and return a re-keyed `DataQuery`.
 *
 * - No mappable active filters, or a query that can't be safely rewritten → returns `base`
 *   unchanged (client-side filtering still applies).
 * - Otherwise returns `{ query: <base wrapped in CALCULATETABLE>, id: <base id>::<sig> }`
 *   so `useDataQuery` treats it as a distinct cache entry and re-runs it against the model.
 *
 * The columns actually pushed down are reported by {@link pushableColumns} so the app can
 * drop them from its client-side `applyFilters` (the model already applied them, and a
 * grouped-away dimension would otherwise be filtered to zero rows client-side).
 */
export function pushdownQuery(base: DataQuery, filters: FilterState, map: DaxColumnMap): DataQuery {
  const daxFilters = filtersToDaxFilters(filters, map);
  if (!daxFilters.length) return base;
  const wrapped = wrapEvaluateWithFilters(base.query, daxFilters);
  if (wrapped == null || wrapped === base.query) return base;
  const baseId = base.id ?? base.query;
  return { query: wrapped, id: `${baseId}::${filterKey(filters, map)}` };
}
