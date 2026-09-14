import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { VisualFrame } from "./visual-frame";
import { TableActions } from "./table-actions";
import {
  computeAging,
  agingToDataTable,
  agingBucketLabels,
  DEFAULT_AGING_BUCKETS,
  type AgingInput,
} from "../lib/finance-tables";
import { formatCompact } from "../lib/format";
import { cn } from "../lib/cn";

export interface AgingTableProps {
  title?: string;
  hint?: string;
  rows: AgingInput[];
  /** Header label for the first (account) column. */
  metricLabel?: string;
  valuePrefix?: string;
  /** Bucket boundaries in days. Default `[0, 30, 60, 90]` → Current / 1-30 / … / 90+. */
  boundaries?: readonly number[];
  /** Append a summing totals row. Default `true`. */
  includeTotalRow?: boolean;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
  frame?: boolean;
}

const th = "sticky top-0 z-10 bg-secondary px-3 py-2 text-right text-xs font-semibold text-muted-foreground";
const thLeft = "sticky left-0 top-0 z-20 bg-secondary px-3 py-2 text-left text-xs font-semibold text-muted-foreground";

// Progressively warmer tint for older buckets (index 0 = Current, stays neutral).
function bucketTint(index: number, count: number): string {
  if (index === 0 || count <= 1) return "text-foreground";
  const t = index / (count - 1);
  if (t >= 0.99) return "text-[var(--color-negative,#dc2626)] font-medium";
  if (t >= 0.66) return "text-[color-mix(in_srgb,var(--color-negative,#dc2626)_75%,var(--color-foreground))]";
  return "text-foreground";
}

/**
 * AR/AP aging schedule: balances bucketed by days outstanding (Current / 1-30 /
 * 31-60 / 61-90 / 90+), with a per-account Total, Overdue and **% overdue**.
 * Older buckets tint progressively redder so at-risk balances pop, and an
 * optional totals row rolls up the book. Fully exportable + copyable to Excel.
 */
export function AgingTable({
  title = "Aging schedule",
  hint = "Outstanding balance by days past due",
  rows,
  metricLabel = "Account",
  valuePrefix = "$",
  boundaries = DEFAULT_AGING_BUCKETS,
  includeTotalRow = true,
  classification,
  onExport,
  frame = true,
}: AgingTableProps) {
  const computed = useMemo(() => computeAging(rows), [rows]);
  const labels = useMemo(() => agingBucketLabels(boundaries), [boundaries]);
  const getTable = () => agingToDataTable(computed, { metricLabel, boundaries, includeTotalRow });

  const totals = useMemo(() => {
    const sums = new Array(labels.length).fill(0);
    let total = 0;
    let overdue = 0;
    for (const r of computed) {
      r.buckets.forEach((v, i) => (sums[i] += v));
      total += r.total;
      overdue += r.overdue;
    }
    return { sums, total, overdue, pctOverdue: total === 0 ? 0 : overdue / total };
  }, [computed, labels.length]);

  const table = (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "60vh" }}>
      <table className="w-full border-collapse whitespace-nowrap text-sm [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
        <thead>
          <tr>
            <th className={thLeft}>{metricLabel}</th>
            {labels.map((label) => (
              <th key={label} className={th}>
                {label}
              </th>
            ))}
            <th className={th}>Total</th>
            <th className={th}>% overdue</th>
          </tr>
        </thead>
        <tbody>
          {computed.map((r) => (
            <tr key={r.label} className="border-t border-border/60 hover:bg-secondary/40">
              <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-medium text-foreground">{r.label}</td>
              {r.buckets.map((v, i) => (
                <td key={i} className={cn("px-3 py-1.5 text-right tabular-nums", bucketTint(i, labels.length))}>
                  {v === 0 ? "—" : formatCompact(v, valuePrefix)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-medium text-foreground">
                {formatCompact(r.total, valuePrefix)}
              </td>
              <td
                className={cn(
                  "px-3 py-1.5 text-right tabular-nums font-medium",
                  r.pctOverdue >= 0.5 ? "text-[var(--color-negative,#dc2626)]" : "text-muted-foreground",
                )}
              >
                {(r.pctOverdue * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        {includeTotalRow && computed.length > 0 ? (
          <tfoot>
            <tr className="border-t-2 border-border bg-secondary/30">
              <td className="sticky left-0 z-10 bg-secondary/30 px-3 py-1.5 text-left font-semibold text-foreground">Total</td>
              {totals.sums.map((v, i) => (
                <td key={i} className="px-3 py-1.5 text-right tabular-nums font-semibold text-foreground">
                  {v === 0 ? "—" : formatCompact(v, valuePrefix)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-foreground">
                {formatCompact(totals.total, valuePrefix)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-foreground">
                {(totals.pctOverdue * 100).toFixed(1)}%
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );

  if (!frame) return table;
  return (
    <VisualFrame
      title={title}
      hint={hint}
      icon={CalendarClock}
      actions={<TableActions title={title} getTable={getTable} classification={classification} onExport={onExport} />}
    >
      {table}
    </VisualFrame>
  );
}
