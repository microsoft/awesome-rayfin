import { useMemo } from "react";
import { PieChart } from "lucide-react";
import { VisualFrame } from "./visual-frame";
import { TableActions } from "./table-actions";
import {
  computeContribution,
  contributionToDataTable,
  type ContributionInput,
} from "../lib/finance-tables";
import { formatCompact } from "../lib/format";
import { cn } from "../lib/cn";

export interface ContributionTableProps {
  title?: string;
  hint?: string;
  rows: ContributionInput[];
  metricLabel?: string;
  valueLabel?: string;
  valuePrefix?: string;
  /** Keep the top-N rows and roll the rest into an "Others" line. */
  topN?: number;
  othersLabel?: string;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  frame?: boolean;
}

const th = "sticky top-0 z-10 bg-secondary px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-3 py-2 text-left text-xs font-semibold text-muted-foreground";

/**
 * Contribution / mix table (Pareto): categories ranked by value with share of
 * total and running cumulative %. An inline bar visualises each share, and the
 * cumulative cell shades once it crosses 80% so the "vital few" pop. Exportable
 * + copyable to Excel.
 */
export function ContributionTable({
  title = "Contribution & mix",
  hint = "Share of total with cumulative Pareto",
  rows,
  metricLabel = "Category",
  valueLabel = "Value",
  valuePrefix = "$",
  topN,
  othersLabel = "Others",
  classification,
  onExport,
  frame = true,
}: ContributionTableProps) {
  const computed = useMemo(() => computeContribution(rows, { topN, othersLabel }), [rows, topN, othersLabel]);
  const getTable = () => contributionToDataTable(computed, { metricLabel, valueLabel });

  const table = (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
      <table className="w-full border-collapse whitespace-nowrap text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className={cn(thLeft, "w-8 text-center")}>#</th>
            <th className={cn(thLeft, "left-8")}>{metricLabel}</th>
            <th className={th}>{valueLabel}</th>
            <th className={th}>% of Total</th>
            <th className={th}>Cumulative %</th>
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.label} className="border-t border-border/60 hover:bg-secondary/40">
              <td className="w-8 px-2 py-1.5 text-center tabular-nums text-muted-foreground">{r.rank}</td>
              <td className="px-3 py-1.5 text-left font-medium text-foreground">{r.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatCompact(r.value, valuePrefix)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                <div className="flex items-center justify-end gap-2">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(r.share * 100)}%` }} />
                  </span>
                  <span className="w-12 text-right text-muted-foreground">{(r.share * 100).toFixed(1)}%</span>
                </div>
              </td>
              <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium", r.cumulative <= 0.8 ? "text-foreground" : "text-muted-foreground")}>
                {(r.cumulative * 100).toFixed(1)}%
              </td>
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
      icon={PieChart}
      actions={<TableActions title={title} getTable={getTable} classification={classification} onExport={onExport} />}
    >
      {table}
    </VisualFrame>
  );
}
