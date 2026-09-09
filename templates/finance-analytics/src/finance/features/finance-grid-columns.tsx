/**
 * Pure builders that map computed finance rows (variance / time-series) onto the
 * official `@microsoft/fabric-datagrid` column + row model, so the finance tables
 * can render on the official grid (native cell-range **Ctrl+C Excel copy**, row
 * virtualization, and the app theme via `useVisualTheme`) WITHOUT losing their
 * bespoke presentation — the one-line "units + %" variance cell with favourability
 * colour, and the trend sparkline.
 *
 * Design notes:
 *  - Each delta / value column's cell value stays the **raw number**, so the grid's
 *    Ctrl+C copies clean numerics into Excel. The percent + favourability that ride
 *    alongside a variance number are stashed as extra `*_pct` / `*_fav` row fields
 *    the cellRenderer reads (they are not their own columns, so they don't widen the
 *    copy range).
 *  - Values keep `formatCompact` ($K / $M) — NOT raw model format strings — because
 *    the compact one-line form is the tuned finance presentation; a full-precision
 *    format string would re-introduce the wrapping these tables deliberately avoid.
 *  - `GridColumnDef` / `Row` are `import type` only → zero runtime SDK dependency.
 */
import type { ReactNode } from "react";
import { ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { GridColumnDef, Row } from "@microsoft/fabric-datagrid";
import type { VarianceRow, TimeSeriesRow, TrailingWindow, Favorability } from "../lib/finance-tables";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "../lib/format";
import { Sparkline } from "./sparkline";
import { cn } from "../lib/cn";

const favClass: Record<Favorability, string> = {
  favorable: "text-[var(--color-positive,#16a34a)]",
  unfavorable: "text-[var(--color-negative,#dc2626)]",
  neutral: "text-muted-foreground",
};

type Renderer = (value: unknown, row: Record<string, unknown>) => ReactNode;

/** The one-line "units + %" variance cell with a favourability arrow + colour. */
function renderDelta(abs: unknown, pct: unknown, fav: Favorability, prefix: string): ReactNode {
  if (abs == null) return <span className="text-muted-foreground/50">—</span>;
  const Icon = fav === "favorable" ? ArrowUp : fav === "unfavorable" ? ArrowDown : null;
  return (
    <span className={cn("inline-flex items-center justify-end gap-1.5 whitespace-nowrap font-medium tabular-nums", favClass[fav])}>
      {Icon ? <Icon size={12} aria-hidden="true" /> : null}
      <span>{formatSignedCompact(Number(abs), prefix)}</span>
      <span className="text-[11px] opacity-70">{formatSignedPercent(pct == null ? 0 : Number(pct))}</span>
    </span>
  );
}

const compactRenderer = (prefix: string): Renderer => (v) =>
  v == null ? "—" : formatCompact(Number(v), prefix);

export interface FinanceGridModel {
  columns: GridColumnDef[];
  data: Row[];
}

export interface VarianceGridOptions {
  metricLabel?: string;
  valuePrefix?: string;
}

/**
 * Build the official grid columns + rows for a variance table. Delta columns carry
 * the abs number as the (copyable) cell value; the `%` and favourability are stashed
 * on `<id>_pct` / `<id>_fav` row fields for the cellRenderer.
 */
export function varianceGridColumns(rows: VarianceRow[], opts: VarianceGridOptions = {}): FinanceGridModel {
  const prefix = opts.valuePrefix ?? "$";
  const has = (k: "forecast" | "budget" | "priorYear") => rows.some((r) => r[k] !== undefined && r[k] !== null);
  const hasF = has("forecast");
  const hasB = has("budget");
  const hasPY = has("priorYear");

  const deltaCol = (id: string, header: string): GridColumnDef => ({
    id,
    header,
    numeric: true,
    sortable: true,
    cellRenderer: (v, row) => renderDelta(v, (row as Record<string, unknown>)[`${id}_pct`], (row as Record<string, unknown>)[`${id}_fav`] as Favorability, prefix),
  });
  const valueCol = (id: string, header: string): GridColumnDef => ({
    id,
    header,
    numeric: true,
    sortable: true,
    cellRenderer: compactRenderer(prefix),
  });

  const columns: GridColumnDef[] = [{ id: "label", header: opts.metricLabel ?? "Metric", sortable: true }];
  columns.push(valueCol("actual", "Actuals"));
  if (hasF) columns.push(valueCol("forecast", "Forecast"));
  if (hasB) columns.push(valueCol("budget", "Budget"));
  if (hasPY) columns.push(valueCol("priorYear", "Prior Year"));
  if (hasF) columns.push(deltaCol("vtf", "VTF"));
  if (hasB) columns.push(deltaCol("vtb", "VTB"));
  if (hasPY) columns.push(deltaCol("vtpy", "VTPY"));

  const data: Row[] = rows.map((r) => {
    const row: Record<string, unknown> = { _id: r.label, label: r.label, actual: r.actual };
    if (hasF) row.forecast = r.forecast ?? null;
    if (hasB) row.budget = r.budget ?? null;
    if (hasPY) row.priorYear = r.priorYear ?? null;
    const stash = (id: "vtf" | "vtb" | "vtpy") => {
      const d = r[id];
      row[id] = d ? d.abs : null;
      row[`${id}_pct`] = d ? d.pct : null;
      row[`${id}_fav`] = d ? d.favorability : "neutral";
    };
    if (hasF) stash("vtf");
    if (hasB) stash("vtb");
    if (hasPY) stash("vtpy");
    return row as Row;
  });

  return { columns, data };
}

export interface TimeSeriesGridOptions {
  metricLabel?: string;
  valuePrefix?: string;
  periods: string[];
  trailing?: TrailingWindow[];
  showTotal?: boolean;
  showGrowth?: boolean;
  showTrend?: boolean;
}

/** Build the official grid columns + rows for a time-series table (period columns,
 *  trailing windows, total, PoP growth chip, and a trend sparkline column). */
export function timeSeriesGridColumns(rows: TimeSeriesRow[], opts: TimeSeriesGridOptions): FinanceGridModel {
  const prefix = opts.valuePrefix ?? "$";
  const trailing = opts.trailing ?? [];
  const showTotal = opts.showTotal !== false;
  const showGrowth = opts.showGrowth !== false;
  const showTrend = opts.showTrend !== false;
  const value = compactRenderer(prefix);
  // Closure so the sparkline renderer can recover a row's full series by label.
  const seriesByLabel = new Map(rows.map((r) => [r.label, r.values]));

  const columns: GridColumnDef[] = [{ id: "label", header: opts.metricLabel ?? "Metric", sortable: true }];
  opts.periods.forEach((p, i) => columns.push({ id: `p${i}`, header: p, numeric: true, sortable: true, cellRenderer: value }));
  trailing.forEach((w, i) => columns.push({ id: `t${i}`, header: w.label, numeric: true, sortable: true, cellRenderer: value }));
  if (showTotal) columns.push({ id: "total", header: "Total", numeric: true, sortable: true, cellRenderer: value });
  if (showGrowth) {
    columns.push({
      id: "pop",
      header: "PoP",
      numeric: true,
      sortable: true,
      // Cell value is stored as a percent (to match the export DataTable + Ctrl+C copy),
      // so divide by 100 back to a ratio for `formatSignedPercent`.
      cellRenderer: (v) => {
        const up = v == null ? true : Number(v) >= 0;
        const Icon = up ? ArrowUpRight : ArrowDownRight;
        return (
          <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", up ? "text-[var(--color-positive,#16a34a)]" : "text-[var(--color-negative,#dc2626)]")}>
            <Icon size={12} aria-hidden="true" />
            {formatSignedPercent((v == null ? 0 : Number(v)) / 100)}
          </span>
        );
      },
    });
  }
  if (showTrend) {
    columns.push({
      id: "trend",
      header: "Trend",
      sortable: false,
      cellRenderer: (_v, row) => {
        const series = seriesByLabel.get(String((row as Record<string, unknown>).label)) ?? [];
        const up = series.length < 2 || series[series.length - 1] >= series[series.length - 2];
        return (
          <span className={cn("inline-block align-middle", up ? "text-[var(--color-positive,#16a34a)]" : "text-[var(--color-negative,#dc2626)]")}>
            <Sparkline data={series} width={72} height={22} />
          </span>
        );
      },
    });
  }

  const data: Row[] = rows.map((r) => {
    const row: Record<string, unknown> = { _id: r.label, label: r.label };
    opts.periods.forEach((_, i) => (row[`p${i}`] = r.values[i] ?? null));
    r.trailing.forEach((t, i) => (row[`t${i}`] = t.value));
    if (showTotal) row.total = r.total;
    if (showGrowth) row.pop = r.pop * 100;
    return row as Row;
  });

  return { columns, data };
}
