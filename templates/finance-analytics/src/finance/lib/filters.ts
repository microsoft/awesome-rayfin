import type { DataTable } from "./types";

/** column key → selected value. Empty string / absent = no filter on that column. */
export type FilterState = Record<string, string>;

/** Distinct string values for a column, in first-seen order. */
export function distinctValues(table: DataTable, column: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of table.rows) {
    const v = r[column];
    if (v == null) continue;
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Keep only rows matching every active filter (AND across columns). */
export function applyFilters(table: DataTable, active: FilterState): DataTable {
  const entries = Object.entries(active).filter(([, v]) => v !== "" && v != null);
  if (!entries.length) return table;
  return {
    columns: table.columns,
    rows: table.rows.filter((r) => entries.every(([col, val]) => String(r[col] ?? "") === val)),
  };
}

/** Serialize filters for a URL query param: `col:value` pairs joined by `~`. */
export function encodeFilters(active: FilterState): string {
  // encodeURIComponent escapes `:` (→ %3A) but NOT `~`, so a value containing a
  // tilde would collide with the pair delimiter — escape it explicitly.
  const esc = (s: string) => encodeURIComponent(s).replace(/~/g, "%7E");
  const parts = Object.entries(active)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${esc(k)}:${esc(v)}`);
  return parts.join("~");
}

export function decodeFilters(param: string): FilterState {
  const out: FilterState = {};
  if (!param) return out;
  for (const pair of param.split("~")) {
    const idx = pair.indexOf(":");
    if (idx < 0) continue;
    const k = decodeURIComponent(pair.slice(0, idx));
    const v = decodeURIComponent(pair.slice(idx + 1));
    if (k) out[k] = v;
  }
  return out;
}

export function countActive(active: FilterState): number {
  return Object.values(active).filter((v) => v !== "" && v != null).length;
}
