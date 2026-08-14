import { useMemo, lazy, Suspense } from "react";
import { ArrowDown, ArrowUp, Scale } from "lucide-react";
import { VisualFrame } from "./visual-frame";
import { TableActions } from "./table-actions";
import {
  computeVariance,
  varianceToDataTable,
  type Favorability,
  type VarianceDelta,
  type VarianceInput,
} from "../lib/finance-tables";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "../lib/format";
import { varianceGridColumns } from "./finance-grid-columns";
import { cn } from "../lib/cn";

const FinanceDataGrid = lazy(() => import("./finance-data-grid"));

export interface VarianceTableProps {
  title?: string;
  hint?: string;
  rows: VarianceInput[];
  /** Header label for the first (name) column. */
  metricLabel?: string;
  valuePrefix?: string;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  /** Wrap in the standard VisualFrame card. Default `true`. */
  frame?: boolean;
  /**
   * Rendering engine. `"custom"` (default) uses this template's bespoke table;
   * `"fabric"` renders on the official `@microsoft/fabric-datagrid` for native
   * cell-range Ctrl+C Excel copy + virtualization, preserving the one-line
   * units + % variance presentation. Opt-in until live-portal validation.
   */
  engine?: "custom" | "fabric";
}

const favClass: Record<Favorability, string> = {
  favorable: "text-[var(--color-positive,#16a34a)]",
  unfavorable: "text-[var(--color-negative,#dc2626)]",
  neutral: "text-muted-foreground",
};

function DeltaCell({ delta, valuePrefix }: { delta?: VarianceDelta; valuePrefix: string }) {
  if (!delta) return <td className="px-3 py-1.5 text-right text-muted-foreground/50">—</td>;
  const Icon = delta.favorability === "favorable" ? ArrowUp : delta.favorability === "unfavorable" ? ArrowDown : null;
  return (
    <td className={cn("px-3 py-1.5 text-right tabular-nums", favClass[delta.favorability])}>
      <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap font-medium">
        {Icon ? <Icon size={12} aria-hidden="true" /> : null}
        <span>{formatSignedCompact(delta.abs, valuePrefix)}</span>
        <span className="text-[11px] opacity-70">{formatSignedPercent(delta.pct)}</span>
      </span>
    </td>
  );
}

const th = "sticky top-0 z-10 bg-secondary px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-3 py-2 text-left text-xs font-semibold text-muted-foreground";

/**
 * Condensed FP&A variance table: Actuals vs Forecast / Budget / Prior Year with
 * VTF / VTB / VTPY columns. Each variance cell shows the delta in **units and
 * percent**, coloured favourable (green) / unfavourable (red) — respecting
 * `lowerIsBetter` for cost lines. Fully exportable + copyable to Excel.
 */
export function VarianceTable({
  title = "Variance analysis",
  hint = "Actuals vs Forecast, Budget & Prior Year",
  rows,
  metricLabel = "Metric",
  valuePrefix = "$",
  classification,
  onExport,
  frame = true,
  engine = "custom",
}: VarianceTableProps) {
  const computed = useMemo(() => computeVariance(rows), [rows]);
  const hasF = computed.some((r) => r.forecast !== undefined);
  const hasB = computed.some((r) => r.budget !== undefined);
  const hasPY = computed.some((r) => r.priorYear !== undefined);

  const getTable = () => varianceToDataTable(computed, { metricLabel });

  const fabricModel = useMemo(
    () => (engine === "fabric" ? varianceGridColumns(computed, { metricLabel, valuePrefix }) : null),
    [engine, computed, metricLabel, valuePrefix],
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
            <th className={th}>Actuals</th>
            {hasF ? <th className={th}>Forecast</th> : null}
            {hasB ? <th className={th}>Budget</th> : null}
            {hasPY ? <th className={th}>Prior Year</th> : null}
            {hasF ? <th className={th}>VTF</th> : null}
            {hasB ? <th className={th}>VTB</th> : null}
            {hasPY ? <th className={th}>VTPY</th> : null}
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.label} className="border-t border-border/60 hover:bg-secondary/40">
              <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-medium text-foreground">{r.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatCompact(r.actual, valuePrefix)}</td>
              {hasF ? <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.forecast != null ? formatCompact(r.forecast, valuePrefix) : "—"}</td> : null}
              {hasB ? <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.budget != null ? formatCompact(r.budget, valuePrefix) : "—"}</td> : null}
              {hasPY ? <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{r.priorYear != null ? formatCompact(r.priorYear, valuePrefix) : "—"}</td> : null}
              {hasF ? <DeltaCell delta={r.vtf} valuePrefix={valuePrefix} /> : null}
              {hasB ? <DeltaCell delta={r.vtb} valuePrefix={valuePrefix} /> : null}
              {hasPY ? <DeltaCell delta={r.vtpy} valuePrefix={valuePrefix} /> : null}
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
      icon={Scale}
      actions={<TableActions title={title} getTable={getTable} classification={classification} onExport={onExport} />}
    >
      {table}
    </VisualFrame>
  );
}
