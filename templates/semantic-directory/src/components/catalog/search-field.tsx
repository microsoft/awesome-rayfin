//-----------------------------------------------------------------------
// Semantic Directory — search field (input + typeahead + keyboard nav).
//
// Encapsulates the whole "type and get instant answers" interaction so the
// calm landing hero and the slim active top bar share one implementation:
// combobox input, an anchored dropdown that opens at ≥4 chars (or a known
// short acronym), full arrow-key / Enter / Escape navigation, and a
// "see all" hand-off to the full results list.
//-----------------------------------------------------------------------

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { CatalogModel } from "@/catalog/model/types";
import { useTypeahead } from "@/hooks/use-typeahead";
import { SearchBar } from "./search-bar";
import { TypeaheadDropdown } from "./typeahead-dropdown";

interface SearchFieldProps {
    catalog: CatalogModel | undefined;
    query: string;
    onQueryChange: (value: string) => void;
    onSelect: (key: string) => void;
    /** Commit the raw query to the full results list ("see all" / Enter). */
    onSubmit: () => void;
    size?: "md" | "lg";
    placeholder?: string;
    autoFocus?: boolean;
}

export function SearchField({
    catalog,
    query,
    onQueryChange,
    onSelect,
    onSubmit,
    size = "md",
    placeholder,
    autoFocus,
}: SearchFieldProps) {
    const { isOpen, results, total } = useTypeahead(query, catalog);
    const [focused, setFocused] = useState(false);
    const [index, setIndex] = useState(0);
    const [prevQuery, setPrevQuery] = useState(query);
    const inputRef = useRef<HTMLInputElement>(null);

    const open = isOpen && focused;
    const activeOptionId = open && results[index] ? `ogc-option-${index}` : undefined;

    // Reset the active row when the query changes (adjust-state-during-render).
    if (query !== prevQuery) {
        setPrevQuery(query);
        setIndex(0);
    }

    // Focus synchronously (before paint) and drop the caret at the end of any
    // existing text. When the landing hero hands off to the top-bar field mid-
    // type, this claims focus within the same commit so the in-flight keystroke
    // and everything after it lands here — the caret continues the word instead
    // of the field losing focus for a frame.
    useLayoutEffect(() => {
        if (!autoFocus) return;
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
    }, [autoFocus]);

    const commitSelect = (key: string) => {
        onSelect(key);
        setFocused(false);
        inputRef.current?.blur();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            setFocused(false);
            inputRef.current?.blur();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (open && results[index]) commitSelect(results[index].id);
            else if (query.trim()) onSubmit();
            return;
        }
        if (!open) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
        }
    };

    return (
        <div className="relative">
            <SearchBar
                ref={inputRef}
                value={query}
                onChange={onQueryChange}
                size={size}
                placeholder={placeholder}
                expanded={open}
                activeDescendant={activeOptionId}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
            />
            {/* Screen-reader-only count so results announce without stealing focus. */}
            <span className="sr-only" role="status" aria-live="polite">
                {open ? `${total} result${total === 1 ? "" : "s"} available` : ""}
            </span>
            {/* Keep focus during a mouse click so row selection registers. */}
            <div onMouseDown={(e) => e.preventDefault()}>
                <AnimatePresence>
                    {open ? (
                        <TypeaheadDropdown
                            results={results}
                            selectedIndex={index}
                            totalCount={total}
                            onSelect={commitSelect}
                            onHoverIndex={setIndex}
                            onSeeAll={() => {
                                onSubmit();
                                setFocused(false);
                                inputRef.current?.blur();
                            }}
                        />
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
}
