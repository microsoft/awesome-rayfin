import { useMemo } from "react";
import { Target } from "lucide-react";
import { VisualFrame } from "./visual-frame";
import { TableActions } from "./table-actions";
import { Sparkline } from "./sparkline";
import {
  computeScorecard,
  scorecardToDataTable,
  type ScorecardInput,
  type ScorecardStatus,
} from "../lib/finance-tables";
import { formatCompact } from "../lib/format";
import { cn } from "../lib/cn";

export interface KpiScorecardTableProps {
  title?: string;
  hint?: string;
  rows: ScorecardInput[];
  metricLabel?: string;
  valuePrefix?: string;
  /** Attainment band (ratio) below 100% still counted "at risk". Default 0.05. */
  nearBand?: number;
  showTrend?: boolean;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  frame?: boolean;
}

const th = "sticky top-0 z-10 bg-secondary px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-3 py-2 text-left text-xs font-semibold text-muted-foreground";

const statusMeta: Record<ScorecardStatus, { label: string; dot: string; text: string }> = {
  "on-track": { label: "On track", dot: "bg-[var(--color-positive,#16a34a)]", text: "text-[var(--color-positive,#16a34a)]" },
  "at-risk": { label: "At risk", dot: "bg-[var(--color-warning,#d97706)]", text: "text-[var(--color-warning,#d97706)]" },
  "off-track": { label: "Off track", dot: "bg-[var(--color-negative,#dc2626)]", text: "text-[var(--color-negative,#dc2626)]" },
};

/**
 * KPI scorecard: actual vs target with attainment %, a RAG status pill and an
 * optional trend sparkline. Honours `lowerIsBetter` cost KPIs. Exportable +
 * copyable to Excel.
 */
export function KpiScorecardTable({
  title = "KPI scorecard",
  hint = "Actual vs target with attainment & status",
  rows,
  metricLabel = "KPI",
  valuePrefix = "$",
  nearBand = 0.05,
  showTrend = true,
  classification,
  onExport,
  frame = true,
}: KpiScorecardTableProps) {
  const computed = useMemo(() => computeScorecard(rows, nearBand), [rows, nearBand]);
  const getTable = () => scorecardToDataTable(computed, { metricLabel });

  const table = (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
      <table className="w-full border-collapse whitespace-nowrap text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className={thLeft}>{metricLabel}</th>
            <th className={th}>Actual</th>
            <th className={th}>Target</th>
            <th className={th}>Attainment</th>
            <th className={cn(th, "text-left")}>Status</th>
            {showTrend ? <th className={cn(th, "text-center")}>Trend</th> : null}
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => {
            const meta = statusMeta[r.status];
            const prefix = r.unitPrefix ?? valuePrefix;
            return (
              <tr key={r.label} className="border-t border-border/60 hover:bg-secondary/40">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-medium text-foreground">{r.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatCompact(r.actual, prefix)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatCompact(r.target, prefix)}</td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums font-semibold", meta.text)}>{(r.attainment * 100).toFixed(0)}%</td>
                <td className="px-3 py-1.5 text-left">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden="true" />
                    <span className={meta.text}>{meta.label}</span>
                  </span>
                </td>
                {showTrend ? (
                  <td className="px-3 py-1.5 text-center">
                    {r.trend && r.trend.length > 1 ? (
                      <span className={cn("inline-block align-middle", meta.text)}>
                        <Sparkline data={r.trend} width={72} height={22} />
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!frame) return table;
  return (
    <VisualFrame
      title={title}
      hint={hint}
      icon={Target}
      actions={<TableActions title={title} getTable={getTable} classification={classification} onExport={onExport} />}
    >
      {table}
    </VisualFrame>
  );
}
