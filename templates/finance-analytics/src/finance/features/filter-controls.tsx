import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X, Search, RotateCcw } from "lucide-react";
import { Select } from "../primitives";
import { useFocusTrap } from "../hooks/use-focus-trap";
import { cn } from "../lib/cn";
import type { FilterDef } from "./filter-bar";

export interface FilterControlsProps {
  filters: FilterDef[];
  value: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onClearAll: () => void;
  /** Rows remaining after the current filters (drives the drawer's live result count). */
  resultCount?: number;
  /** Total rows before filtering. */
  totalCount?: number;
  /** Optional global period + granularity control, pinned ahead of the filters. */
  periodControl?: ReactNode;
}

const DEFAULT_GROUP = "Filters";

function toOptions(f: FilterDef) {
  return [{ value: "", label: "All" }, ...f.options.map((o) => ({ value: o, label: o }))];
}

function groupBy(filters: FilterDef[]) {
  const groups = new Map<string, FilterDef[]>();
  for (const f of filters) {
    const key = f.group ?? DEFAULT_GROUP;
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return Array.from(groups.entries());
}

/** A single pinned filter rendered as a compact pill in the top bar. */
function PinnedFilter({
  f,
  value,
  onChange,
}: {
  f: FilterDef;
  value: string;
  onChange: (id: string, value: string) => void;
}) {
  const active = Boolean(value);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1 text-sm transition-colors",
        active ? "border-primary/40 bg-primary/10" : "border-border bg-card/70",
      )}
    >
      <span className={cn("font-medium", active ? "text-primary" : "text-foreground")}>{f.label}</span>
      <Select
        aria-label={f.label}
        value={value ?? ""}
        onChange={(v) => onChange(f.id, v)}
        options={toOptions(f)}
        className="min-w-[5rem]"
      />
    </div>
  );
}

/** Left slide-in drawer exposing every filter, grouped, with search, per-field and
 *  per-group clear, an active-filter summary and a live result count. */
function FilterDrawer({
  filters,
  value,
  onChange,
  onClearAll,
  activeCount,
  resultCount,
  totalCount,
  onClose,
}: FilterControlsProps & { activeCount: number; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showSearch = filters.length > 5;
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? filters.filter((f) => f.label.toLowerCase().includes(q)) : filters),
    [filters, q],
  );
  const groups = groupBy(matches);
  const clearGroup = (list: FilterDef[]) => list.forEach((f) => onChange(f.id, ""));
  const groupActive = (list: FilterDef[]) => list.filter((f) => value[f.id]).length;
  const activeFilters = filters.filter((f) => value[f.id]);
  const hasCount = typeof resultCount === "number";

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)]" role="presentation">
      <button
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="panel-slide-in-left absolute inset-y-0 left-0 flex w-[min(23rem,94vw)] flex-col border-r border-border bg-card shadow-e4"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold">Filters</h2>
            {activeCount ? (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                {activeCount} active
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {activeCount ? (
              <button
                onClick={onClearAll}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw size={12} aria-hidden="true" />
                Reset
              </button>
            ) : null}
            <button
              onClick={onClose}
              aria-label="Close filters"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {showSearch ? (
          <div className="border-b border-border px-4 py-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search filters…"
                aria-label="Search filters"
                className="w-full rounded-md border border-border bg-secondary/40 py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        ) : null}

        {activeFilters.length ? (
          <div className="border-b border-border px-4 py-2.5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Active</div>
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => onChange(f.id, "")}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-muted-foreground">{f.label}:</span>
                  {value[f.id]}
                  <X size={11} aria-hidden="true" />
                  <span className="sr-only">Remove filter</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No filters match “{query}”.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(([name, list]) => {
                const nActive = groupActive(list);
                return (
                  <section key={name} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {name}
                        {nActive ? (
                          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary tabular-nums">{nActive}</span>
                        ) : null}
                      </h3>
                      {nActive ? (
                        <button
                          onClick={() => clearGroup(list)}
                          className="rounded text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    {list.map((f) => {
                      const active = Boolean(value[f.id]);
                      return (
                        <label key={f.id} className="flex flex-col gap-1 text-sm">
                          <span className="flex items-center justify-between">
                            <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>{f.label}</span>
                            {active ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  onChange(f.id, "");
                                }}
                                className="rounded text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                Clear
                              </button>
                            ) : null}
                          </span>
                          <Select
                            aria-label={f.label}
                            value={value[f.id] ?? ""}
                            onChange={(v) => onChange(f.id, v)}
                            options={toOptions(f)}
                            className="w-full"
                          />
                        </label>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {hasCount ? (
              <>
                <span className="font-semibold text-foreground">{resultCount!.toLocaleString()}</span>
                {typeof totalCount === "number" ? ` of ${totalCount.toLocaleString()}` : ""} rows
              </>
            ) : (
              `${activeCount} active`
            )}
          </span>
          <button
            onClick={onClose}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {hasCount ? `Show ${resultCount!.toLocaleString()} results` : "Done"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Configurable filter surface: pinned filters render as always-visible pills in the
 * top bar; the rest live behind a "More filters" button that opens a grouped left
 * drawer. Active selections show as removable chips. Which filters are pinned and how
 * they're grouped is declared per-app via `config.filters[].pinned` / `.group`.
 */
export function FilterControls({ filters, value, onChange, onClearAll, resultCount, totalCount, periodControl }: FilterControlsProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!filters.length && !periodControl) return null;

  const pinned = filters.filter((f) => f.pinned);
  const hasDrawerFilters = filters.some((f) => !f.pinned);
  const drawerActiveCount = filters.filter((f) => !f.pinned && value[f.id]).length;
  const activeCount = filters.filter((f) => value[f.id]).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {periodControl}
        {periodControl && (pinned.length || hasDrawerFilters) ? (
          <span className="mx-0.5 h-6 w-px self-center bg-border" aria-hidden="true" />
        ) : null}
        {pinned.map((f) => (
          <PinnedFilter key={f.id} f={f} value={value[f.id] ?? ""} onChange={onChange} />
        ))}
        {hasDrawerFilters ? (
          <button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SlidersHorizontal size={14} className="text-muted-foreground" aria-hidden="true" />
            More filters
            {drawerActiveCount ? (
              <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
                {drawerActiveCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {activeCount ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {activeCount} filter{activeCount === 1 ? "" : "s"} active
          </span>
          {filters.map((f) =>
            value[f.id] ? (
              <button
                key={f.id}
                onClick={() => onChange(f.id, "")}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-muted-foreground">{f.label}:</span>
                {value[f.id]}
                <X size={11} aria-hidden="true" />
                <span className="sr-only">Remove filter</span>
              </button>
            ) : null,
          )}
          <button
            onClick={onClearAll}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {drawerOpen ? (
        <FilterDrawer
          filters={filters}
          value={value}
          onChange={onChange}
          onClearAll={onClearAll}
          activeCount={activeCount}
          resultCount={resultCount}
          totalCount={totalCount}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </div>
  );
}
