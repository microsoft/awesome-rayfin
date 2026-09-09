//-----------------------------------------------------------------------
// Semantic Directory — typeahead dropdown (Level 1 instant results).
//
// Anchored directly under the search input. Renders up to a handful of ranked
// hits as the user types (≥4 chars, or a known short acronym). Keyboard
// navigation lives in the parent; this component just paints the listbox and a
// footer hint to keep browsing when there's more than fits.
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import type { CatalogSearchHit } from "@/catalog/search";
import { dur, ease } from "@/lib/motion";
import { TypeaheadRow } from "./typeahead-row";

interface TypeaheadDropdownProps {
    results: CatalogSearchHit[];
    selectedIndex: number;
    totalCount: number;
    onSelect: (key: string) => void;
    onHoverIndex: (index: number) => void;
    onSeeAll: () => void;
}

export function TypeaheadDropdown({
    results,
    selectedIndex,
    totalCount,
    onSelect,
    onHoverIndex,
    onSeeAll,
}: TypeaheadDropdownProps) {
    const more = totalCount - results.length;
    return (
        <m.div
            id="typeahead-listbox"
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: dur[2], ease: ease.outQuint }}
            className="absolute left-0 right-0 top-full z-50 mt-s max-h-[min(60vh,26rem)] overflow-y-auto rounded-xl border border-border bg-popover p-s shadow-[var(--e3)]"
        >
            {results.map((hit, i) => (
                <TypeaheadRow
                    key={hit.id}
                    id={`ogc-option-${i}`}
                    hit={hit}
                    isActive={i === selectedIndex}
                    onHover={() => onHoverIndex(i)}
                    onSelect={() => onSelect(hit.id)}
                />
            ))}
            {more > 0 ? (
                <button
                    type="button"
                    onClick={onSeeAll}
                    className="mt-xxs flex w-full items-center justify-center rounded-lg px-m py-s text-100 font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    See all {totalCount} results ↵
                </button>
            ) : null}
        </m.div>
    );
}
