import { useMemo, lazy, Suspense } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarRange } from "lucide-react";
import { VisualFrame } from "./visual-frame";
import { TableActions } from "./table-actions";
import { Sparkline } from "./sparkline";
import {
  computeTimeSeries,
  timeSeriesToDataTable,
  type TimeSeriesInput,
  type TrailingWindow,
} from "../lib/finance-tables";
import { formatCompact, formatSignedPercent } from "../lib/format";
import { timeSeriesGridColumns } from "./finance-grid-columns";
import { cn } from "../lib/cn";

const FinanceDataGrid = lazy(() => import("./finance-data-grid"));

export interface TimeSeriesTableProps {
  title?: string;
  hint?: string;
  /** Ordered period column labels (oldest → newest), e.g. ["Jan","Feb",…]. */
  periods: string[];
  rows: TimeSeriesInput[];
  metricLabel?: string;
  valuePrefix?: string;
  /** Trailing-window sum columns, e.g. [{label:"T3M",periods:3}]. */
  trailing?: TrailingWindow[];
  /** Show a trend sparkline column. Default `true`. */
  showTrend?: boolean;
  /** Show the Total column. Default `true`. */
  showTotal?: boolean;
  /** Show the period-over-period growth column. Default `true`. */
  showGrowth?: boolean;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  frame?: boolean;
  /**
   * Rendering engine. `"custom"` (default) uses this template's bespoke table;
   * `"fabric"` renders on the official `@microsoft/fabric-datagrid` for native
   * cell-range Ctrl+C Excel copy + virtualization, preserving the trend sparkline
   * + PoP growth presentation. Opt-in until live-portal validation.
   */
  engine?: "custom" | "fabric";
}

const th = "sticky top-0 z-10 bg-secondary px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-3 py-2 text-left text-xs font-semibold text-muted-foreground";

/**
 * Data-over-time table: a metric per row across period columns (days / weeks /
 * months / quarters / years) plus optional trailing-window sums (T3M, trailing
 * 13W…), a total, a period-over-period growth chip and a trend sparkline.
 * Exportable + copyable to Excel with raw numeric cells.
 */
export function TimeSeriesTable({
  title = "Trend over time",
  hint = "Metric by period with trailing windows",
  periods,
  rows,
  metricLabel = "Metric",
  valuePrefix = "$",
  trailing = [],
  showTrend = true,
  showTotal = true,
  showGrowth = true,
  classification,
  onExport,
  frame = true,
  engine = "custom",
}: TimeSeriesTableProps) {
  const computed = useMemo(() => computeTimeSeries(rows, { trailing }), [rows, trailing]);

  const getTable = () =>
    timeSeriesToDataTable(computed, {
      metricLabel,
      periods,
      trailing,
      includeTotal: showTotal,
      includeGrowth: showGrowth,
    });

  const fabricModel = useMemo(
    () =>
      engine === "fabric"
        ? timeSeriesGridColumns(computed, { metricLabel, valuePrefix, periods, trailing, showTotal, showGrowth, showTrend })
        : null,
    [engine, computed, metricLabel, valuePrefix, periods, trailing, showTotal, showGrowth, showTrend],
  );

  const table =
    engine === "fabric" && fabricModel ? (
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl border border-border bg-secondary/40" />}>
        <FinanceDataGrid columns={fabricModel.columns} data={fabricModel.data} />
      </Suspense>
    ) : (
      <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
      <table className="w-full border-collapse whitespace-nowrap text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className={thLeft}>{metricLabel}</th>
            {periods.map((p) => (
              <th key={p} className={th}>{p}</th>
            ))}
            {trailing.map((w) => (
              <th key={w.label} className={cn(th, "text-primary")}>{w.label}</th>
            ))}
            {showTotal ? <th className={th}>Total</th> : null}
            {showGrowth ? <th className={th}>PoP</th> : null}
            {showTrend ? <th className={cn(th, "text-center")}>Trend</th> : null}
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.label} className="border-t border-border/60 hover:bg-secondary/40">
              <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-medium text-foreground">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatCompact(v, valuePrefix)}</td>
              ))}
              {r.trailing.map((t) => (
                <td key={t.label} className="px-3 py-1.5 text-right tabular-nums font-medium text-foreground">{formatCompact(t.value, valuePrefix)}</td>
              ))}
              {showTotal ? <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-foreground">{formatCompact(r.total, valuePrefix)}</td> : null}
              {showGrowth ? (
                <td className="px-3 py-1.5 text-right tabular-nums">
                  <span className={cn("inline-flex items-center gap-0.5 font-medium", r.pop >= 0 ? "text-[var(--color-positive,#16a34a)]" : "text-[var(--color-negative,#dc2626)]")}>
                    {r.pop >= 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
                    {formatSignedPercent(r.pop)}
                  </span>
                </td>
              ) : null}
              {showTrend ? (
                <td className="px-3 py-1.5 text-center">
                  <span className={cn("inline-block align-middle", r.pop >= 0 ? "text-[var(--color-positive,#16a34a)]" : "text-[var(--color-negative,#dc2626)]")}>
                    <Sparkline data={r.values} width={72} height={22} />
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (!frame) return table;
  return (
    <VisualFrame
      title={title}
      hint={hint}
      icon={CalendarRange}
      actions={<TableActions title={title} getTable={getTable} classification={classification} onExport={onExport} />}
    >
      {table}
    </VisualFrame>
  );
}
