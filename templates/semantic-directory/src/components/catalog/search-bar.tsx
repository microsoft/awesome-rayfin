//-----------------------------------------------------------------------
// Semantic Directory — search bar.
//
// A single input used in two places: the calm landing hero (size "lg") and the
// slim active top bar (size "md"). Exposes keyboard + focus hooks and combobox
// aria so the typeahead dropdown can wire up arrow-key navigation and screen
// reader semantics.
//-----------------------------------------------------------------------

import { forwardRef } from "react";
import { appConfig } from "@/app.config";

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    resultCount?: number;
    placeholder?: string;
    size?: "md" | "lg";
    expanded?: boolean;
    /** Accessible name for the combobox input. */
    label?: string;
    /** DOM id of the active listbox option (arrow-key navigation). */
    activeDescendant?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(
    { value, onChange, resultCount, placeholder, size = "md", expanded, label, activeDescendant, onKeyDown, onFocus, onBlur },
    ref,
) {
    const pad = size === "lg" ? "py-m pl-[3.25rem] pr-l text-400" : "py-m pl-[3.25rem] pr-l text-400";
    const icon = size === "lg" ? "text-500 left-l" : "text-500 left-l";
    return (
        <div className="relative">
            <span
                aria-hidden
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground ${icon}`}
            >
                🔍
            </span>
            <input
                ref={ref}
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
                placeholder={placeholder ?? "Search measures, dimensions, tables — e.g. \u201ctotal sales\u201d"}
                role="combobox"
                aria-label={label ?? appConfig.searchLabel}
                aria-expanded={expanded ?? false}
                aria-controls="typeahead-listbox"
                aria-activedescendant={expanded ? activeDescendant : undefined}
                aria-autocomplete="list"
                className={`w-full rounded-full border border-input bg-card text-foreground shadow-sm outline-none transition-[color,border-color,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-ring)_55%,transparent),0_14px_38px_-10px_color-mix(in_oklab,var(--energy)_50%,transparent)] ${pad}`}
            />
            {value && typeof resultCount === "number" ? (
                <span className="pointer-events-none absolute right-l top-1/2 -translate-y-1/2 text-200 text-muted-foreground">
                    {resultCount} result{resultCount === 1 ? "" : "s"}
                </span>
            ) : null}
        </div>
    );
});
