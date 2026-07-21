/**
 * Fabric-backed data grid — the Phase 2A adoption of the official
 * `@microsoft/fabric-datagrid`. It keeps this template's grid chrome (global
 * search, density toggle, column show/hide) and delegates the table body to the
 * SDK's `DataGrid`, so consumers gain the official grid's native capabilities —
 * cell-range selection with Ctrl+C Excel copy and row virtualization — without
 * losing the standardized toolbar.
 *
 * This module is loaded ONLY behind a lazy boundary (see `data-grid.tsx`,
 * `engine="fabric"`), so `@microsoft/fabric-datagrid` and its transitive deps
 * (`@griffel/react`, `@fluentui/react-icons`, `@tanstack/react-virtual`) land in
 * their own async chunk and never touch the initial-load budget. The SDK is an
 * OPTIONAL peer dependency: importing this file requires it to be installed,
 * which every Fabric Apps Analytics host already provides.
 */
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Search, X, Rows3, Rows4, SlidersHorizontal, Check } from "lucide-react";
import { DataGrid as FabricGrid, type Row } from "@microsoft/fabric-datagrid";
import type { CellValue, DataTable } from "../lib/types";
import { Tooltip } from "../primitives";
import { applySelections } from "../lib/interaction";
import type { InteractionEvent } from "../data/fabric-interop";
import { toGridColumns, collectSelections } from "./fabric-data-grid.helpers";
import { useVisualTheme } from "../lib/visual-theme";

export interface FabricDataGridProps {
  table: DataTable;
  /** Initial rows-per-viewport height driver. Kept for API parity with the custom grid. */
  initialPageSize?: number;
  /** Fired when a single row is resolved from an official selection event. */
  onRowSelect?: (row: Record<string, CellValue>) => void;
  /** Raw official interaction stream, forwarded to the host for cross-filtering. */
  onInteraction?: (events: InteractionEvent[]) => void;
}

type Density = "comfortable" | "compact";

export default function FabricDataGrid({ table, initialPageSize = 25, onRowSelect, onInteraction }: FabricDataGridProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [density, setDensity] = useState<Density>("compact");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef<HTMLDivElement>(null);
  // The app's own palette (light / "Intent Telescope" dark / high-contrast), handed
  // to the official grid so it renders in OUR theme, never the SDK's stale default.
  const theme = useVisualTheme();

  const visibleColumns = useMemo(
    () => table.columns.filter((c) => !hidden.has(c.key)),
    [table.columns, hidden],
  );

  const filteredRows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter((r) =>
      table.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)),
    );
  }, [table.rows, table.columns, deferredQuery]);

  const gridColumns = useMemo(() => toGridColumns(visibleColumns), [visibleColumns]);
  // Our object rows satisfy the official `Row` index signature 1:1 (keys = column ids).
  const gridRows = filteredRows as unknown as Row[];

  const rowHeight = density === "compact" ? 33 : 41;

  const handleInteraction = (events: InteractionEvent[]) => {
    onInteraction?.(events);
    if (onRowSelect) {
      const selections = collectSelections(events);
      if (selections.length) {
        const matched = applySelections(table, selections);
        if (matched.rows.length === 1) onRowSelect(matched.rows[0]);
      }
    }
  };

  const onColMenuBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (colMenuRef.current && !colMenuRef.current.contains(e.relatedTarget as Node)) setColMenuOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar — standardized chrome retained on top of the official grid body. */}
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

        <div ref={colMenuRef} onBlur={onColMenuBlur} className="relative">
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

      {/* Official grid body: native cell selection + Ctrl+C Excel copy + virtualization. */}
      <div className="overflow-hidden rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
        <FabricGrid
          columns={gridColumns}
          data={gridRows}
          theme={theme}
          rowHeight={rowHeight}
          pageSize={initialPageSize}
          onInteraction={handleInteraction}
          capabilities={{ virtualization: rowHeight, disableSelection: false }}
        />
      </div>
    </div>
  );
}
