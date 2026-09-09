//-----------------------------------------------------------------------
// Semantic Directory — catalog search hook.
//
// Memoizes the MiniSearch index for a catalog snapshot and exposes a debounced
// query API. Global enrichment synonyms are expanded into the raw query so
// business terms resolve to the right fields/values.
//-----------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogModel } from "@/catalog/model/types";
import { normName } from "@/catalog/model/types";
import {
    buildSearchIndex,
    search,
    type CatalogSearchHit,
} from "@/catalog/search";

/** Expand a query using global synonyms (term -> field/value hints). */
function expandQuery(
    query: string,
    synonyms: CatalogModel["synonyms"],
): string {
    const norm = normName(query);
    const extras: string[] = [];
    for (const [term, hint] of Object.entries(synonyms)) {
        if (norm.includes(term)) {
            if (hint.field) extras.push(hint.field);
            if (hint.values?.length) extras.push(...hint.values);
        }
    }
    return extras.length ? `${query} ${extras.join(" ")}` : query;
}

export interface CatalogSearchResult {
    /** Ranked hits for the query that has actually been applied to the index. */
    hits: CatalogSearchHit[];
    /**
     * The (debounced) query these hits were computed from. Callers deriving
     * per-hit UI — match evidence, token highlighting — must use THIS, not the
     * live input, so a row is never explained by a query it didn't match yet.
     */
    effectiveQuery: string;
}

export function useCatalogSearch(
    catalog: CatalogModel | undefined,
    query: string,
    debounceMs = 120,
): CatalogSearchResult {
    const [debounced, setDebounced] = useState(query);
    // Latches true on the first non-empty query. Gates the MiniSearch build so
    // the ~1k-doc index is never constructed on the startup critical path — the
    // landing page paints without paying for search machinery it doesn't use.
    // The setState lives inside the debounce timeout (async), so it stays off
    // the render/effect-sync path that `react-hooks/set-state-in-effect` guards.
    const [engaged, setEngaged] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            setDebounced(query);
            if (query.trim().length > 0) setEngaged(true);
        }, debounceMs);
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, [query, debounceMs]);

    // Build once, lazily: only after the user first engages, and only rebuilt
    // when the catalog itself changes (live overlay reconcile).
    const index = useMemo(
        () => (catalog && engaged ? buildSearchIndex(catalog) : undefined),
        [catalog, engaged],
    );

    return useMemo(() => {
        if (!index || !catalog) return { hits: [], effectiveQuery: debounced };
        const expanded = expandQuery(debounced, catalog.synonyms);
        return { hits: search(index, expanded), effectiveQuery: debounced };
    }, [index, catalog, debounced]);
}
