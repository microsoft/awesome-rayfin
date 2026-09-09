//-----------------------------------------------------------------------
// Semantic Directory — typeahead hook (Level 1 instant search).
//
// Decides *when* the dropdown should open and *what* it shows. Honors the
// explicit 4-character threshold, but fires early when the query exactly
// matches a known short acronym (YTD, QTD, SKU…) or an entity's display
// name, so shorthand and precise names both feel instant. Results reuse the
// existing MiniSearch catalog index and are capped for a tight dropdown.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import type { CatalogModel } from "@/catalog/model/types";
import { useCatalogSearch } from "@/hooks/use-catalog-search";
import type { CatalogSearchHit } from "@/catalog/search";
import { SHORT_TOKENS, TYPEAHEAD_LIMIT, TYPEAHEAD_MIN_CHARS } from "@/catalog/constants";

export interface TypeaheadState {
    /** Whether the dropdown should render (threshold met AND has results). */
    isOpen: boolean;
    /** Whether the query passed the trigger threshold (regardless of results). */
    triggered: boolean;
    /** Top ranked hits, capped at TYPEAHEAD_LIMIT. */
    results: CatalogSearchHit[];
    /** Total ranked hits before the cap (for a "see all N" affordance). */
    total: number;
}

/** Should the query open the typeahead at all? */
function shouldTrigger(query: string, catalog: CatalogModel | undefined): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    if (q.length >= TYPEAHEAD_MIN_CHARS) return true;
    if (SHORT_TOKENS.includes(q)) return true;
    if (catalog) {
        for (const meas of catalog.measures) {
            if (meas.isHidden) continue;
            const dn = meas.displayName.toLowerCase();
            if (dn === q || dn.startsWith(q + " ")) return true;
        }
    }
    return false;
}

export function useTypeahead(
    query: string,
    catalog: CatalogModel | undefined,
): TypeaheadState {
    const { hits: allHits } = useCatalogSearch(catalog, query, 90);
    const results = useMemo(() => allHits.slice(0, TYPEAHEAD_LIMIT), [allHits]);
    const triggered = shouldTrigger(query, catalog);
    return { isOpen: triggered && results.length > 0, triggered, results, total: allHits.length };
}
