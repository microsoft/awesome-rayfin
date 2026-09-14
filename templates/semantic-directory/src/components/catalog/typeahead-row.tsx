//-----------------------------------------------------------------------
// Semantic Directory — typeahead row (a single result inside the dropdown).
//
// Lightweight, keyboard- and mouse-selectable. Shows emoji + name + kind badge
// + a one-line description so a user can recognize the right item without
// opening it. Active state is driven by the parent (arrow keys) or hover.
//-----------------------------------------------------------------------

import type { CatalogSearchHit } from "@/catalog/search";
import { KindBadge } from "./kind-badge";

interface TypeaheadRowProps {
    id: string;
    hit: CatalogSearchHit;
    isActive: boolean;
    onHover: () => void;
    onSelect: () => void;
}

export function TypeaheadRow({ id, hit, isActive, onHover, onSelect }: TypeaheadRowProps) {
    return (
        <button
            type="button"
            id={id}
            role="option"
            aria-selected={isActive}
            onClick={onSelect}
            onMouseEnter={onHover}
            className={`flex w-full items-center gap-m rounded-lg px-m py-s text-left transition-colors ${
                isActive ? "bg-accent" : "hover:bg-accent/60"
            }`}
        >
            <span aria-hidden className="text-400">
                {hit.emoji || "•"}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-s">
                    <span className="truncate text-300 font-medium text-foreground">{hit.displayName}</span>
                    <KindBadge kind={hit.kind} />
                </span>
                {hit.description ? (
                    <span className="mt-xxs block truncate text-100 text-muted-foreground">
                        {hit.description}
                    </span>
                ) : hit.table ? (
                    <span className="mt-xxs block truncate text-100 text-muted-foreground">
                        in {hit.table}
                    </span>
                ) : null}
            </span>
        </button>
    );
}
