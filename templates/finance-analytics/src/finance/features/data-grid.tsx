import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Search, X, Rows3, Rows4, ChevronLeft, ChevronRight, SlidersHorizontal, Check } from "lucide-react";
import type { CellValue, Column, DataTable } from "../lib/types";
import { formatNumber } from "../lib/format";
import { formatCell } from "../lib/format-string";
import { Tooltip, Select } from "../primitives";
import { useRowWindow } from "../hooks/use-row-window";
import type { InteractionEvent } from "../data/fabric-interop";

export interface DataGridProps {
  table: DataTable;
  /** Page size options offered in the footer. Default [25, 50, 100]. */
  pageSizes?: number[];
  /** Initial rows per page. Default 25. */
  initialPageSize?: number;
  /** Fired when a row is activated (click / Enter). */
  onRowSelect?: (row: Record<string, CellValue>) => void;
  /** Grid engine. "custom" (default) = built-in dependency-free grid; "fabric" =
   *  the official @microsoft/fabric-datagrid (lazy-loaded) with native cell-range
   *  Ctrl+C Excel copy and row virtualization. Requires the optional peer dep. */
  engine?: "custom" | "fabric";
  /** Official interaction stream (fabric engine only), forwarded to the host. */
  onInteraction?: (events: InteractionEvent[]) => void;
}

type Density = "comfortable" | "compact";

const LazyFabricDataGrid = lazy(() => import("./fabric-data-grid"));

/** Placeholder shown while the official grid chunk streams in (fabric engine). */
function GridLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-40 items-center justify-center rounded-xl border border-border text-sm text-muted-foreground"
    >
      Loading grid…
    </div>
  );
}

/**
 * Standardized data grid. Routes to one of two engines:
 *  - "custom" (default): the built-in, dependency-free grid.
 *  - "fabric": the official @microsoft/fabric-datagrid, lazy-loaded so its deps
 *    stay off the initial-load budget. The custom engine remains the safe default
 *    until a Fabric host validates the fabric engine end-to-end.
 */
export function DataGrid(props: DataGridProps) {
  if (props.engine === "fabric") {
    return (
      <Suspense fallback={<GridLoading />}>
        <LazyFabricDataGrid
          table={props.table}
          initialPageSize={props.initialPageSize}
          onRowSelect={props.onRowSelect}
          onInteraction={props.onInteraction}
        />
      </Suspense>
    );
  }
  return <CustomDataGrid {...props} />;
}

/** Standardized production data grid: search, sort, pagination, sticky header,
 *  density, column visibility, keyboard nav. Pure client-side, zero deps. */
function CustomDataGrid({ table, pageSizes = [25, 50, 100], initialPageSize = 25, onRowSelect }: DataGridProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number | "all">(initialPageSize);
  const [density, setDensity] = useState<Density>("compact");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(0);

  const visibleColumns = useMemo(
    () => table.columns.filter((c) => !hidden.has(c.key)),
    [table.columns, hidden],
  );

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter((r) =>
      table.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)),
    );
  }, [table.rows, table.columns, deferredQuery]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""));
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, dir]);

  const showAll = pageSize === "all";
  const effSize = showAll ? Math.max(1, sorted.length) : pageSize;
  const pageCount = showAll ? 1 : Math.max(1, Math.ceil(sorted.length / effSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * effSize;
  const rows = showAll ? sorted : sorted.slice(start, start + effSize);

  // Uniform row height (fixed padding per density) → fixed-height windowing.
  const estRowH = density === "compact" ? 33 : 41;
  const win = useRowWindow(scrollRef, { rowCount: rows.length, rowHeight: rowH || estRowH });
  const measureRow = (el: HTMLTableRowElement | null) => {
    if (el && el.offsetHeight && el.offsetHeight !== rowH) setRowH(el.offsetHeight);
  };

  // Reset to first page whenever the result set changes size.
  useEffect(() => { setPage(0); }, [query, pageSize, sortKey, dir]);
  // Re-measure row height when density changes.
  useEffect(() => { setRowH(0); }, [density]);

  useEffect(() => {
    if (!colMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colMenuOpen]);

  const cell = (c: Column, v: CellValue) =>
    c.numeric && typeof v === "number"
      ? formatCell(v, c.format)
      : c.format
        ? formatCell(v, c.format)
        : String(v ?? "");

  const rowPad = density === "compact" ? "py-1" : "py-2";
  const headPad = density === "compact" ? "py-1.5" : "py-2.5";

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rows…"
            aria-label="Search rows"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Tooltip content="Comfortable rows">
            <button
              onClick={() => setDensity("comfortable")}
              aria-label="Comfortable density"
              aria-pressed={density === "comfortable"}
              className={"flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (density === "comfortable" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Rows3 size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Compact rows">
            <button
              onClick={() => setDensity("compact")}
              aria-label="Compact density"
              aria-pressed={density === "compact"}
              className={"flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (density === "compact" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <Rows4 size={15} />
            </button>
          </Tooltip>
        </div>

        <div ref={colMenuRef} className="relative">
          <Tooltip content="Show / hide columns">
            <button
              onClick={() => setColMenuOpen((o) => !o)}
              aria-label="Choose columns"
              aria-expanded={colMenuOpen}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SlidersHorizontal size={15} />
              <span className="hidden sm:inline">Columns</span>
            </button>
          </Tooltip>
          {colMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-[var(--z-popover)] mt-1 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-e3"
            >
              {table.columns.map((c) => {
                const visible = !hidden.has(c.key);
                const lastVisible = visible && visibleColumns.length === 1;
                return (
                  <button
                    key={c.key}
                    role="menuitemcheckbox"
                    aria-checked={visible}
                    disabled={lastVisible}
                    onClick={() =>
                      setHidden((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key);
                        else next.add(c.key);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded border border-border">
                      {visible ? <Check size={12} className="text-primary" /> : null}
                    </span>
                    {c.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* Table */}
      <div ref={scrollRef} onScroll={win.onScroll} className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
        <table className="w-full text-sm" aria-rowcount={sorted.length + 1}>
          <thead className="sticky top-0 z-[1] bg-secondary text-secondary-foreground shadow-[0_1px_0_0_var(--color-border)]">
            <tr aria-rowindex={1}>
              {visibleColumns.map((c) => {
                const isSorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={isSorted ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={"px-0 py-0 font-medium " + (c.numeric ? "text-right" : "text-left")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (sortKey === c.key) setDir((d) => (d === "asc" ? "desc" : "asc"));
                        else { setSortKey(c.key); setDir("desc"); }
                      }}
                      aria-label={`Sort by ${c.label}`}
                      className={
                        "flex w-full cursor-pointer select-none items-center gap-1 px-4 " + headPad + " transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
                        (c.numeric ? "justify-end" : "justify-start")
                      }
                    >
                      {c.label}
                      {isSorted ? (dir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />) : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {query ? (
                    <>No rows match &ldquo;<span className="font-medium text-foreground">{query}</span>&rdquo;.</>
                  ) : (
                    "No rows to display."
                  )}
                </td>
              </tr>
            ) : (
              <>
                {win.topPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={visibleColumns.length} style={{ height: win.topPad, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {rows.slice(win.start, win.end).map((r, idx) => {
                  const i = win.start + idx;
                  return (
                    <tr
                      key={start + i}
                      ref={idx === 0 ? measureRow : undefined}
                      aria-rowindex={i + 2}
                      tabIndex={onRowSelect ? 0 : undefined}
                      onClick={onRowSelect ? () => onRowSelect(r) : undefined}
                      onKeyDown={
                        onRowSelect
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onRowSelect(r);
                              }
                            }
                          : undefined
                      }
                      className={
                        "border-t border-border transition-colors hover:bg-accent/50 " +
                        (onRowSelect ? "cursor-pointer focus-visible:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" : "")
                      }
                    >
                      {visibleColumns.map((c) => (
                        <td key={c.key} className={"px-4 " + rowPad + (c.numeric ? " text-right tabular-nums" : "")}>
                          {cell(c, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {win.bottomPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={visibleColumns.length} style={{ height: win.bottomPad, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer / pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span aria-live="polite">
          {sorted.length === 0
            ? "0 rows"
            : `${start + 1}–${Math.min(start + effSize, sorted.length)} of ${formatNumber(sorted.length)}`}
          {query && sorted.length !== table.rows.length ? ` (filtered from ${formatNumber(table.rows.length)})` : ""}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <div className="w-20">
              <Select
                value={showAll ? "all" : String(pageSize)}
                onChange={(v) => setPageSize(v === "all" ? "all" : Number(v))}
                options={[...pageSizes.map((n) => ({ value: String(n), label: String(n) })), { value: "all", label: "All" }]}
                aria-label="Rows per page"
              />
            </div>
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
              aria-label="Previous page"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[80px] text-center tabular-nums">
              Page {clampedPage + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={clampedPage >= pageCount - 1}
              aria-label="Next page"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
