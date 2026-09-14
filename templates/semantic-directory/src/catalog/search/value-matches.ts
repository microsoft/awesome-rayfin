//-----------------------------------------------------------------------
// Semantic Directory — dimension value matching (the "answer-first" payoff).
//
// When a user types a product / brand / value word ("Contoso"),
// the most useful answer is not the *field* — it's the confirmation that the
// model actually knows that thing, which values match, and how many metrics can
// be broken down by it. This module finds those value hits deterministically:
//   1. LIVE values pulled from the model (Product[ProductName] = …),
//      so brand-new values match automatically with no curation.
//   2. Curated enrichment synonyms as an offline fallback (works on localhost
//      and before the live overlay loads).
// No AI — every match is a literal substring / synonym hit.
//-----------------------------------------------------------------------

import type { CatalogModel, ColumnMeta } from "../model/types";
import { normName } from "../model/types";
import { reachableTables } from "../lineage/relationships";

export interface ValueMatch {
    /** The dimension column that carries the matching values. */
    columnKey: string;
    /** Fully-qualified `'Table'[Column]`. */
    ref: string;
    /** Friendly field name (e.g. "Brand"). */
    field: string;
    table: string;
    /** Distinct member values that matched the query (deduped, capped). */
    matches: string[];
    /** Total known values in the field, when known (live). */
    totalValues?: number;
    /** How many visible metrics can be broken down by this dimension. */
    metricCount: number;
    /** True when the matches came from live model values (vs curated synonyms). */
    live: boolean;
}

/** Normalize a `'Table'[Column]` ref for loose comparison. */
function normRef(ref: string): string {
    return ref.replace(/['"[\]]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const MAX_COLUMNS = 4;
const MAX_MATCHES = 60;

/**
 * Count the visible measures that can realistically be sliced by a dimension:
 * measures whose calculation touches a table reachable from the dimension's
 * table via active relationships. Deterministic and explainable.
 */
export function measuresSliceableBy(catalog: CatalogModel, column: ColumnMeta): number {
    const reach = reachableTables(catalog, column.table);
    const visible = catalog.measures.filter((m) => !m.isHidden);
    if (!reach) return visible.length; // dimension not wired in — model-wide
    let n = 0;
    for (const m of visible) {
        const uses = m.usesTables?.length ? m.usesTables : [m.table];
        if (uses.some((t) => reach.has(normName(t)))) n++;
    }
    return n;
}

/**
 * Find dimension-value matches for a raw query. Returns the strongest few
 * fields whose member values (live) or curated synonyms contain the query.
 */
export function findValueMatches(catalog: CatalogModel, query: string): ValueMatch[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const byKey = new Map<string, ValueMatch>();
    const colByRef = new Map<string, ColumnMeta>();
    for (const c of catalog.columns) {
        if (!c.isHidden) colByRef.set(normRef(c.ref), c);
    }

    const add = (col: ColumnMeta, values: string[], live: boolean, total?: number) => {
        if (!values.length) return;
        const existing = byKey.get(col.key);
        if (existing) {
            const seen = new Set(existing.matches.map((v) => v.toLowerCase()));
            for (const v of values) {
                if (!seen.has(v.toLowerCase())) {
                    existing.matches.push(v);
                    seen.add(v.toLowerCase());
                }
            }
            existing.live = existing.live || live;
            if (total != null) existing.totalValues = total;
            return;
        }
        byKey.set(col.key, {
            columnKey: col.key,
            ref: col.ref,
            field: col.displayName || col.name,
            table: col.table,
            matches: [...new Set(values)].slice(0, MAX_MATCHES),
            totalValues: total,
            metricCount: measuresSliceableBy(catalog, col),
            live,
        });
    };

    // 1) Live model values — the real, future-proof source.
    for (const c of catalog.columns) {
        if (c.isHidden || !c.liveValues?.length) continue;
        const matched = c.liveValues.filter((v) => v.toLowerCase().includes(q));
        if (matched.length) add(c, matched, true, c.liveValues.length);
    }

    // 2) Curated synonyms — offline / pre-live fallback.
    for (const [term, hint] of Object.entries(catalog.synonyms)) {
        if (!hint.field) continue;
        const t = term.toLowerCase();
        if (!(t.includes(q) || q.includes(t))) continue;
        const col = colByRef.get(normRef(hint.field));
        if (!col || col.isHidden) continue;
        const values = hint.values?.length ? hint.values : [];
        // If we have no representative values, still surface the field itself.
        add(col, values.length ? values : [capitalize(term)], false);
    }

    return [...byKey.values()]
        .sort(
            (a, b) =>
                Number(b.live) - Number(a.live) ||
                b.matches.length - a.matches.length ||
                b.metricCount - a.metricCount,
        )
        .slice(0, MAX_COLUMNS);
}

function capitalize(s: string): string {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
