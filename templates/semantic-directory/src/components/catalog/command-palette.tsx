//-----------------------------------------------------------------------
// Semantic Directory — command palette (⌘K / Ctrl+K).
//
// One keyboard-first surface to reach everything: jump to any measure, column,
// or table by fuzzy search, or run an action (open a tool, export the
// dictionary, copy a link, toggle theme, go home). Built on a native <dialog>
// so focus-trapping and Escape come for free and it escapes any stacking
// context. Reuses the same MiniSearch index as the main search.
//-----------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import type { CatalogModel } from "@/catalog/model/types";
import {
    buildSearchIndex,
    search,
    type CatalogSearchHit,
} from "@/catalog/search";

export interface PaletteAction {
    id: string;
    label: string;
    hint?: string;
    icon: React.ReactNode;
    /** Extra searchable words (comma/space separated). */
    keywords?: string;
    run: () => void;
}

type Item =
    | { type: "action"; action: PaletteAction }
    | { type: "entity"; hit: CatalogSearchHit };

const KIND_LABEL: Record<string, string> = {
    measure: "Measure",
    column: "Field",
    table: "Table",
};

const MAX_ENTITY_HITS = 7;

export function CommandPalette({
    open,
    onClose,
    catalog,
    actions,
    onOpenEntity,
}: {
    open: boolean;
    onClose: () => void;
    catalog?: CatalogModel;
    actions: PaletteAction[];
    onOpenEntity: (key: string) => void;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);

    // Build the search index only while the palette is open.
    const index = useMemo(
        () => (open && catalog ? buildSearchIndex(catalog) : undefined),
        [open, catalog],
    );

    const entityHits = useMemo(() => {
        if (!index || !query.trim()) return [] as CatalogSearchHit[];
        return search(index, query, MAX_ENTITY_HITS);
    }, [index, query]);

    const filteredActions = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return actions;
        return actions.filter(
            (a) =>
                a.label.toLowerCase().includes(q) ||
                (a.keywords ?? "").toLowerCase().includes(q),
        );
    }, [actions, query]);

    const items = useMemo<Item[]>(
        () => [
            ...filteredActions.map((action) => ({ type: "action" as const, action })),
            ...entityHits.map((hit) => ({ type: "entity" as const, hit })),
        ],
        [filteredActions, entityHits],
    );

    // Open / close the native dialog in step with the `open` prop.
    useEffect(() => {
        const el = dialogRef.current;
        if (!el) return;
        if (open && !el.open) {
            el.showModal();
            setQuery("");
            setActive(0);
            // Focus the input after the dialog paints.
            requestAnimationFrame(() => inputRef.current?.focus());
        } else if (!open && el.open) {
            el.close();
        }
    }, [open]);

    // Clamp the active index at render so a shrinking result set can never point
    // past the end (deriving avoids a state-sync effect + cascading render).
    const activeIndex = items.length === 0 ? 0 : Math.min(active, items.length - 1);

    // Scroll the keyboard-active option into view (below or above the fold).
    // Only while open — the dialog keeps its list mounted when closed, and there
    // is nothing to scroll to until it's visible.
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        if (!open) return;
        const el = listRef.current?.querySelector<HTMLElement>(`#cmdk-opt-${activeIndex}`);
        el?.scrollIntoView?.({ block: "nearest" });
    }, [open, activeIndex]);

    const activeId = items.length ? `cmdk-opt-${activeIndex}` : undefined;

    const runItem = (item: Item) => {
        if (item.type === "action") item.action.run();
        else onOpenEntity(item.hit.id);
        // Route the close through the native dialog so `onClose` fires exactly
        // once (via the bound `close` event), never twice.
        dialogRef.current?.close();
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(items.length ? (activeIndex + 1) % items.length : 0);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(items.length ? (activeIndex - 1 + items.length) % items.length : 0);
        } else if (e.key === "Enter") {
            e.preventDefault();
            const item = items[activeIndex];
            if (item) runItem(item);
        }
    };

    return (
        <dialog
            ref={dialogRef}
            // Native `close` fires on Escape and programmatic close — the single
            // source of truth for closing, so `onClose` runs exactly once.
            onClose={onClose}
            onClick={(e) => {
                // Backdrop click (target is the dialog itself) closes.
                if (e.target === dialogRef.current) dialogRef.current?.close();
            }}
            aria-label="Command palette"
            className="command-palette mx-auto mt-[12vh] mb-auto w-[calc(100%-2rem)] max-w-[36rem] rounded-2xl border border-border bg-card p-0 text-foreground shadow-[var(--e2)] backdrop:bg-black/40"
        >
            <div className="flex flex-col" onKeyDown={onKeyDown}>
                <div className="flex items-center gap-s border-b border-border px-l py-m">
                    <Search className="icon-size-200 text-muted-foreground" strokeWidth={2} aria-hidden />
                    <input
                        ref={inputRef}
                        type="text"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="cmdk-results"
                        aria-activedescendant={activeId}
                        aria-autocomplete="list"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActive(0);
                        }}
                        placeholder="Search entities or run a command…"
                        aria-label="Search entities or run a command"
                        className="w-full bg-transparent text-300 text-foreground outline-none placeholder:text-muted-foreground"
                    />
                    <kbd className="rounded-md border border-border bg-secondary px-xs py-xxs text-100 text-muted-foreground">
                        Esc
                    </kbd>
                </div>

                <ul
                    ref={listRef}
                    id="cmdk-results"
                    className="max-h-[22rem] overflow-y-auto p-xs"
                    role="listbox"
                    aria-label="Results"
                >
                    {items.length === 0 ? (
                        <li className="px-m py-l text-center text-200 text-muted-foreground">
                            No matches.
                        </li>
                    ) : (
                        items.map((item, i) => {
                            const isActive = i === activeIndex;
                            const key =
                                item.type === "action" ? `a:${item.action.id}` : `e:${item.hit.id}`;
                            return (
                                <li
                                    key={key}
                                    id={`cmdk-opt-${i}`}
                                    role="option"
                                    aria-selected={isActive}
                                    onClick={() => runItem(item)}
                                    onMouseMove={() => setActive(i)}
                                    className={`flex cursor-pointer items-center gap-s rounded-xl px-m py-s transition-colors ${
                                        isActive ? "bg-accent" : "hover:bg-accent/60"
                                    }`}
                                >
                                    <span
                                        aria-hidden
                                        className="grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-primary"
                                    >
                                        {item.type === "action" ? (
                                            item.action.icon
                                        ) : item.hit.emoji ? (
                                            <span className="text-200">{item.hit.emoji}</span>
                                        ) : (
                                            <Search className="icon-size-100" strokeWidth={2} />
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-200 font-medium text-foreground">
                                            {item.type === "action"
                                                ? item.action.label
                                                : item.hit.displayName}
                                        </span>
                                        <span className="block truncate text-100 text-muted-foreground">
                                            {item.type === "action"
                                                ? item.action.hint ?? "Command"
                                                : item.hit.kind === "table"
                                                  ? "Table"
                                                  : `${KIND_LABEL[item.hit.kind] ?? item.hit.kind}${
                                                        item.hit.table ? ` · ${item.hit.table}` : ""
                                                    }`}
                                        </span>
                                    </span>
                                    {isActive ? (
                                        <CornerDownLeft
                                            className="icon-size-100 shrink-0 text-muted-foreground"
                                            strokeWidth={2}
                                            aria-hidden
                                        />
                                    ) : null}
                                </li>
                            );
                        })
                    )}
                </ul>
            </div>
        </dialog>
    );
}
