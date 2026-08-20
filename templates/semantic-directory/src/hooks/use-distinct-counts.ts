//-----------------------------------------------------------------------
// Semantic Directory — live distinct-count "grain" for a set of fields.
//
// Fetches the true number of distinct values for each ref in ONE query so the
// hierarchy can show each level's grain (Year 5 → Quarter 20 → Month 60). Covers
// date/numeric levels the string-only value overlay never pulls. Best-effort and
// module-cached; degrades silently outside the Fabric runtime. Deterministic.
//-----------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { rowsToObjects, str } from "@/lib/rows-to-objects";
import { runMetadataQuery } from "@/lib/run-metadata-query";
import { distinctCountsQuery, type ValueColumnRef } from "@/queries/metadata";

/** lowercased `table[column]` -> distinct count, shared across mounts. */
const cache = new Map<string, number>();

export function clearDistinctCountsCache(): void {
    cache.clear();
}

interface CountRow {
    Ref: unknown;
    N: unknown;
}

/**
 * Returns a map of `table[column]` (lowercased) -> distinct count for the given
 * refs. Only the refs not already cached are fetched, and always as a single
 * batched query. A stale-guard prevents an older set from overwriting a newer.
 */
export function useDistinctCounts(refs: ValueColumnRef[]): Map<string, number> {
    // Stable signature so the effect only re-runs when the ref set truly changes.
    const signature = useMemo(
        () => refs.map((r) => `${r.table}[${r.column}]`.toLowerCase()).sort().join("|"),
        [refs],
    );
    const [counts, setCounts] = useState<Map<string, number>>(() => new Map());

    useEffect(() => {
        const keys = signature ? signature.split("|") : [];
        const seed = new Map<string, number>();
        const missing: ValueColumnRef[] = [];
        for (const r of refs) {
            const key = `${r.table}[${r.column}]`.toLowerCase();
            if (cache.has(key)) seed.set(key, cache.get(key)!);
            else missing.push(r);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- seed from cache before async fetch
        setCounts(new Map(seed));
        if (missing.length === 0) return;

        const built = distinctCountsQuery(missing);
        if (!built) return;
        let cancelled = false;
        void runMetadataQuery(built.query)
            .then((table) => {
                if (cancelled) return;
                const next = new Map(seed);
                for (const row of rowsToObjects<CountRow>(table)) {
                    const ref = str(row.Ref);
                    const n = Number(row.N);
                    if (!ref || !Number.isFinite(n)) continue;
                    const key = ref.toLowerCase();
                    cache.set(key, n);
                    next.set(key, n);
                }
                // Ignore if the ref set changed underneath us (rapid navigation).
                if (keys.every((k) => next.has(k) || !cache.has(k))) setCounts(next);
            })
            .catch(() => {
                // Grain is a bonus — never surface an error.
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    return counts;
}
