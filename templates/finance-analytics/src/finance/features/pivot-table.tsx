import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, X, Copy, Download, Maximize2, Minimize2, Rows3, Columns3, Sigma } from "lucide-react";
import type { DataTable } from "../lib/types";
import { numericColumns, categoryColumns } from "../lib/types";
import { buildPivot, measureLabel, type Aggregation, type PivotMeasure } from "../lib/pivot";
import { formatCompact } from "../lib/format";
import { exportCsv, exportExcel } from "../lib/export";
import { Select } from "../primitives";
import { useRowWindow } from "../hooks/use-row-window";
import { cn } from "../lib/cn";

export interface PivotTableProps {
  table: DataTable;
}

const AGGS: Aggregation[] = ["sum", "avg", "count", "max", "min"];

/** A drop-zone builder card (ROWS / COLUMNS / VALUES). */
function ZoneCard({
  icon,
  title,
  count,
  max,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  max?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-border bg-card/70 p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="ml-auto rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground tabular-nums">
          {count}
          {max ? `/${max}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A removable pill chip inside a zone card. */
function Chip({ label, onRemove, children }: { label: string; onRemove: () => void; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-medium text-primary">
      {label}
      {children}
      <button
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded p-0.5 text-primary/70 transition-colors hover:bg-primary/20 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

/** "+ Add" field-picker built on the accessible Select primitive (resets after each pick). */
function AddMenu({ options, onAdd, label }: { options: { key: string; label: string }[]; onAdd: (key: string) => void; label: string }) {
  if (!options.length) return null;
  return (
    <Select
      aria-label={label}
      value=""
      onChange={(v) => v && onAdd(v)}
      placeholder="+ Add"
      options={options.map((o) => ({ value: o.key, label: o.label }))}
      className="min-w-[4.5rem]"
    />
  );
}

/** Config-free, interactive pivot builder: compose ROWS / COLUMNS / VALUES, then
 *  read a hierarchical, expandable matrix with subtotals, a grand total and exports. */
export function PivotTable({ table }: PivotTableProps) {
  const cats = categoryColumns(table);
  const nums = numericColumns(table);
  const labelOf = (key: string) => table.columns.find((c) => c.key === key)?.label ?? key;

  const [rowDims, setRowDims] = useState<string[]>(() => cats.slice(0, 2).map((c) => c.key));
  const [colDim, setColDim] = useState<string>("");
  const [measures, setMeasures] = useState<PivotMeasure[]>(() => (nums[0] ? [{ column: nums[0].key, agg: "sum" }] : []));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => buildPivot(table, { rowDims, colDim: colDim || undefined, measures }), [table, rowDims, colDim, measures]);

  const availableRows = cats.filter((c) => !rowDims.includes(c.key) && c.key !== colDim);
  const availableCols = cats.filter((c) => !rowDims.includes(c.key) && c.key !== colDim);
  const availableMeasures = nums.filter((n) => !measures.some((m) => m.column === n.key));

  const expandableIds = useMemo(() => result.nodes.filter((n) => n.hasChildren).map((n) => n.id), [result]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));
  const expandAll = () => setExpanded(new Set(expandableIds));
  const collapseAll = () => setExpanded(new Set());

  const isVisible = (n: (typeof result.nodes)[number]) => {
    for (let k = 1; k <= n.depth; k++) {
      if (!expanded.has(n.path.slice(0, k).join(" / "))) return false;
    }
    return true;
  };
  const visibleNodes = result.nodes.filter(isVisible);

  const measureCols = result.measures;
  const nCols = result.colGroups.length * measureCols.length;

  // Row windowing — pivot rows share a uniform height (py-1.5 + text-sm ≈ 33px),
  // so a fully expanded, deep hierarchy stays cheap. Inert until the row count is large.
  const scrollRef = useRef<HTMLDivElement>(null);
  const win = useRowWindow(scrollRef, { rowCount: visibleNodes.length, rowHeight: 33 });
  const windowNodes = win.active ? visibleNodes.slice(win.start, win.end) : visibleNodes;

  // Flatten the current view into a DataTable for CSV / Excel export.
  const toDataTable = (): DataTable => {
    const columns = [
      { key: "__row", label: rowDims.map(labelOf).join(" / ") || "Rows" },
      ...result.colGroups.flatMap((g) =>
        measureCols.map((m, mi) => ({
          key: `${g}__${mi}`,
          label: result.hasColDim ? `${g} · ${measureLabel(m, table)}` : measureLabel(m, table),
          numeric: true,
        })),
      ),
    ];
    const rows = result.nodes.map((n) => {
      const rec: Record<string, string | number> = { __row: `${"  ".repeat(n.depth)}${n.label}` };
      n.cells.forEach((v, i) => {
        const g = result.colGroups[Math.floor(i / measureCols.length)];
        rec[`${g}__${i % measureCols.length}`] = v;
      });
      return rec;
    });
    const totalRec: Record<string, string | number> = { __row: "Grand Total" };
    result.grandTotals.forEach((v, i) => {
      const g = result.colGroups[Math.floor(i / measureCols.length)];
      totalRec[`${g}__${i % measureCols.length}`] = v;
    });
    rows.push(totalRec);
    return { columns, rows };
  };

  const copyView = async () => {
    const dt = toDataTable();
    const header = dt.columns.map((c) => c.label).join("\t");
    const body = dt.rows.map((r) => dt.columns.map((c) => r[c.key] ?? "").join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  const canExport = rowDims.length > 0 && measures.length > 0 && result.nodes.length > 0;
  const toolBtn =
    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const builder = (
    <div className="flex flex-col gap-4">
      {/* Build-your-view zones */}
      <div className="flex flex-col gap-3 lg:flex-row">
        <ZoneCard icon={<Rows3 size={14} />} title="Rows" count={rowDims.length}>
          {rowDims.map((k) => (
            <Chip key={k} label={labelOf(k)} onRemove={() => setRowDims((p) => p.filter((x) => x !== k))} />
          ))}
          <AddMenu label="Add row field" options={availableRows} onAdd={(k) => setRowDims((p) => [...p, k])} />
          {rowDims.length === 0 ? <span className="text-xs text-muted-foreground">Add a field to group by</span> : null}
        </ZoneCard>

        <ZoneCard icon={<Columns3 size={14} />} title="Columns" count={colDim ? 1 : 0} max={1}>
          {colDim ? (
            <Chip label={labelOf(colDim)} onRemove={() => setColDim("")} />
          ) : (
            <AddMenu label="Add column field" options={availableCols} onAdd={(k) => setColDim(k)} />
          )}
        </ZoneCard>

        <ZoneCard icon={<Sigma size={14} />} title="Values" count={measures.length}>
          {measures.map((m, i) => (
            <Chip
              key={m.column}
              label={labelOf(m.column)}
              onRemove={() => setMeasures((p) => p.filter((_, idx) => idx !== i))}
            >
              <span className="mx-0.5 h-3 w-px bg-primary/30" aria-hidden="true" />
              <Select
                aria-label={`Aggregation for ${labelOf(m.column)}`}
                value={m.agg ?? "sum"}
                onChange={(v) => setMeasures((p) => p.map((x, idx) => (idx === i ? { ...x, agg: v as Aggregation } : x)))}
                options={AGGS.map((a) => ({ value: a, label: a }))}
              />
            </Chip>
          ))}
          <AddMenu label="Add value field" options={availableMeasures} onAdd={(k) => setMeasures((p) => [...p, { column: k, agg: "sum" }])} />
          {measures.length === 0 ? <span className="text-xs text-muted-foreground">Add a measure to summarize</span> : null}
        </ZoneCard>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={allExpanded ? collapseAll : expandAll} disabled={expandableIds.length === 0} className={toolBtn}>
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {result.leafCount.toLocaleString()} {result.leafCount === 1 ? "group" : "groups"} · {visibleNodes.length.toLocaleString()} rows shown
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={copyView} disabled={!canExport} className={toolBtn}>
            <Copy size={13} aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={() => exportCsv(toDataTable(), "pivot.csv")} disabled={!canExport} className={toolBtn}>
            <Download size={13} aria-hidden="true" />
            CSV
          </button>
          <button onClick={() => exportExcel(toDataTable(), "pivot.xlsx")} disabled={!canExport} className={toolBtn}>
            <Download size={13} aria-hidden="true" />
            Excel
          </button>
          <button onClick={() => setFullscreen((v) => !v)} aria-label={fullscreen ? "Exit full screen" : "Full screen"} className={toolBtn}>
            {fullscreen ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
            {fullscreen ? "Exit" : "Full screen"}
          </button>
        </div>
      </div>

      {/* Matrix */}
      <div ref={scrollRef} onScroll={win.onScroll} className={cn("overflow-auto rounded-xl border border-border", fullscreen ? "max-h-[calc(100vh-14rem)]" : "max-h-[60vh]")}>
        <table className="w-full text-sm" aria-rowcount={canExport ? visibleNodes.length + 1 : undefined}>
          <thead className="sticky top-0 z-[3] bg-secondary text-secondary-foreground shadow-[0_1px_0_0_var(--color-border)]">
            {result.hasColDim ? (
              <tr>
                <th rowSpan={2} className="sticky left-0 z-[4] bg-secondary px-4 py-1.5 text-left font-medium">
                  {rowDims.map(labelOf).join(" / ")}
                </th>
                {result.colGroups.map((g) => (
                  <th key={g} colSpan={measureCols.length} className={cn("px-4 py-1.5 text-center font-semibold", g === "Total" && "bg-secondary/80")}>
                    {g}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              {!result.hasColDim ? (
                <th className="sticky left-0 z-[4] bg-secondary px-4 py-1.5 text-left font-medium">
                  {rowDims.map(labelOf).join(" / ") || "Rows"}
                </th>
              ) : null}
              {result.colGroups.flatMap((g) =>
                measureCols.map((m, mi) => (
                  <th key={`${g}-${mi}`} className="whitespace-nowrap px-4 py-1.5 text-right font-medium">
                    {measureLabel(m, table)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {!canExport ? (
              <tr>
                <td colSpan={nCols + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Add at least one <strong>Row</strong> field and one <strong>Value</strong> to build your view.
                </td>
              </tr>
            ) : (
              <>
                {win.topPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={nCols + 1} style={{ height: win.topPad, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
                {windowNodes.map((n, wi) => {
                const isGroup = n.depth === 0;
                const rowIndex = (win.active ? win.start : 0) + wi + 2;
                return (
                  <tr key={n.id} aria-rowindex={rowIndex} className={cn("border-t border-border hover:bg-accent/50", isGroup && "bg-secondary/25")}>
                    <td className={cn("sticky left-0 z-[1] px-4 py-1.5", isGroup ? "bg-secondary/60 font-semibold" : "bg-background font-medium")}>
                      <span className="flex items-center gap-1" style={{ paddingLeft: `${n.depth * 16}px` }}>
                        {n.hasChildren ? (
                          <button
                            onClick={() => toggle(n.id)}
                            aria-expanded={expanded.has(n.id)}
                            aria-label={expanded.has(n.id) ? `Collapse ${n.label}` : `Expand ${n.label}`}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight size={14} className={cn("transition-transform", expanded.has(n.id) && "rotate-90")} aria-hidden="true" />
                          </button>
                        ) : (
                          <span className="inline-block w-[18px]" aria-hidden="true" />
                        )}
                        {n.label}
                        <span className="text-[10px] font-normal text-muted-foreground tabular-nums">({n.count})</span>
                      </span>
                    </td>
                    {n.cells.map((v, i) => (
                      <td
                        key={i}
                        className={cn(
                          "whitespace-nowrap px-4 py-1.5 text-right tabular-nums",
                          Math.floor(i / measureCols.length) === result.colGroups.length - 1 && result.hasColDim && "bg-secondary/20 font-medium",
                        )}
                      >
                        {formatCompact(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
                {win.bottomPad > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={nCols + 1} style={{ height: win.bottomPad, padding: 0, border: 0 }} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
          {canExport ? (
            <tfoot className="sticky bottom-0">
              <tr className="border-t-2 border-border bg-secondary/60 font-semibold">
                <td className="sticky left-0 z-[1] bg-secondary/70 px-4 py-1.5">Grand Total</td>
                {result.grandTotals.map((v, i) => (
                  <td key={i} className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">
                    {formatCompact(v)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );

  if (fullscreen) {
    return createPortal(<div className="fixed inset-0 z-[var(--z-modal)] overflow-auto bg-background p-6">{builder}</div>, document.body);
  }
  return builder;
}

