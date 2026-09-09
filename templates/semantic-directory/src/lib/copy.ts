//-----------------------------------------------------------------------
// Semantic Directory — small copy helpers for correct, humane microcopy.
//
// Centralizes pluralization and count phrasing so the tools never render
// "1 hops" or "All 0 measures". Pure string helpers, no dependencies.
//-----------------------------------------------------------------------

/** The noun form for a count: `pluralize(1, "hop") → "hop"`, `pluralize(2,…) → "hops"`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return Math.abs(count) === 1 ? singular : plural;
}

/** A count with its noun: `countNoun(0, "measure") → "0 measures"`, `countNoun(1,…) → "1 measure"`. */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${pluralize(count, singular, plural)}`;
}

/**
 * A relationship-path summary reading in travel terms:
 * `pathSummary(0, 1) → "0 hops · 1 table"`, `pathSummary(1, 2) → "1 hop · 2 tables"`,
 * `pathSummary(2, 3) → "2 hops · 3 tables"`.
 */
export function pathSummary(hops: number, tables: number): string {
    return `${countNoun(hops, "hop")} · ${countNoun(tables, "table")}`;
}
