import { useMemo } from "react";
import { MousePointerClick } from "lucide-react";
import type { DataTable, CellValue } from "../lib/types";
import { numericColumns, categoryColumns } from "../lib/types";
import { VarianceTable } from "./variance-table";
import { TimeSeriesTable } from "./time-series-table";
import { ContributionTable } from "./contribution-table";
import { KpiScorecardTable } from "./kpi-scorecard-table";
import { AgingTable } from "./aging-table";
import type {
  VarianceInput,
  TimeSeriesInput,
  ContributionInput,
  ScorecardInput,
  AgingInput,
} from "../lib/finance-tables";

export interface FinanceTablesGalleryProps {
  table: DataTable;
  valuePrefix?: string;
  classification?: string;
  onExport?: (evt: { format: "copy" | "csv" | "excel" | "pptx"; rows: number; filename: string }) => void;
}

const num = (v: CellValue) => Number(v ?? 0) || 0;
const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic ratio in ~[-spread, spread] from a label, for stable demo data. */
function seedRatio(label: string, spread = 0.18): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0x7fffffff;
  return ((h % 1000) / 1000 - 0.5) * 2 * spread;
}

function detect(table: DataTable) {
  const cats = categoryColumns(table).map((c) => c.key);
  const nums = numericColumns(table).map((c) => c.key);
  const measure = nums.find((k) => /rev|amount|sales|value/i.test(k)) ?? nums[0];
  const catA = cats.find((k) => k === "segment") ?? cats[0];
  return { measure, catA, nums };
}

function sumBy(rows: DataTable["rows"], key: string, measure: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + num(r[measure]));
  return m;
}

/** Derive the four illustrative finance tables from whatever table is supplied. */
function useFinanceTableData(table: DataTable) {
  return useMemo(() => {
    const { measure, catA, nums } = detect(table);
    if (!measure || !catA) return null;
    const rows = table.rows;

    const totals = [...sumBy(rows, catA, measure).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Variance: actual by category, with synthesized forecast/budget/prior-year.
    const variance: VarianceInput[] = totals.map(([label, actual]) => ({
      label,
      actual,
      forecast: actual / (1 + seedRatio(label + "f", 0.08)),
      budget: actual / (1 + seedRatio(label, 0.12)),
      priorYear: actual / (1 + seedRatio(label + "py", 0.15) + 0.06),
    }));

    // Time-series: monthly actuals per top category.
    const timeSeries: TimeSeriesInput[] = totals.slice(0, 5).map(([label, actual]) => {
      const base = actual / MONTHS.length;
      return { label, values: MONTHS.map((mo, i) => Math.round(base * (0.9 + 0.04 * i) * (1 + seedRatio(label + mo, 0.1)))) };
    });

    // Contribution: category mix.
    const contribution: ContributionInput[] = totals.map(([label, value]) => ({ label, value }));

    // Scorecard: a spread of KPIs incl. a cost line (lower is better).
    const grandTotal = totals.reduce((s, [, v]) => s + v, 0);
    const secondMeasure = nums.find((k) => k !== measure);
    const secondTotal = secondMeasure ? rows.reduce((s, r) => s + num(r[secondMeasure]), 0) : grandTotal * 0.4;
    const trend = (seed: string) => MONTHS.map((mo, i) => 80 + i * 4 + seedRatio(seed + mo, 6) * 10);
    const scorecard: ScorecardInput[] = [
      { label: "Revenue", actual: grandTotal, target: grandTotal / 1.03, trend: trend("rev"), unitPrefix: "$" },
      { label: "Units", actual: secondTotal, target: secondTotal / 0.98, trend: trend("units"), unitPrefix: "" },
      { label: "Gross margin", actual: grandTotal * 0.62, target: grandTotal * 0.65, trend: trend("gm"), unitPrefix: "$" },
      { label: "Operating cost", actual: grandTotal * 0.28, target: grandTotal * 0.26, lowerIsBetter: true, trend: trend("cost"), unitPrefix: "$" },
    ];

    // Aging schedule: outstanding AR per top account across days-past-due buckets.
    const aging: AgingInput[] = totals.map(([label, value]) => {
      const ar = value * 0.15; // ~15% of revenue outstanding
      const w = [
        0.62 + seedRatio(label + "c", 0.1),
        0.2 + seedRatio(label + "1", 0.06),
        0.1 + seedRatio(label + "2", 0.05),
        0.05 + seedRatio(label + "3", 0.03),
        0.03 + seedRatio(label + "4", 0.02),
      ].map((x) => Math.max(0, x));
      const sum = w.reduce((a, b) => a + b, 0) || 1;
      return { label, buckets: w.map((x) => Math.round((ar * x) / sum)) };
    });

    return { variance, timeSeries, contribution, scorecard, aging };
  }, [table]);
}

/**
 * A gallery of the condensed finance table types every FP&A app reaches for —
 * variance (Act vs Forecast/Budget/Prior-Year), data-over-time with trailing
 * windows, contribution/Pareto and a KPI scorecard. Every table can be copied
 * straight into Excel or exported to CSV / Excel / PowerPoint from its toolbar.
 */
export function FinanceTablesGallery({ table, valuePrefix = "$", classification, onExport }: FinanceTablesGalleryProps) {
  const d = useFinanceTableData(table);

  if (!d) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Add at least one category and one numeric column to preview the finance tables.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <MousePointerClick size={13} className="shrink-0 text-primary" aria-hidden="true" />
        Hover any table for its toolbar — one-click Copy pastes into Excel with live numbers, or export to CSV / Excel / PowerPoint.
      </p>

      <VarianceTable
        rows={d.variance}
        metricLabel="Segment"
        valuePrefix={valuePrefix}
        classification={classification}
        onExport={onExport}
      />

      <TimeSeriesTable
        periods={MONTHS}
        rows={d.timeSeries}
        metricLabel="Segment"
        valuePrefix={valuePrefix}
        trailing={[{ label: "T3M", periods: 3 }]}
        classification={classification}
        onExport={onExport}
      />

      <AgingTable
        rows={d.aging}
        metricLabel="Account"
        valuePrefix={valuePrefix}
        classification={classification}
        onExport={onExport}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ContributionTable
          rows={d.contribution}
          metricLabel="Segment"
          valueLabel="Revenue"
          valuePrefix={valuePrefix}
          classification={classification}
          onExport={onExport}
        />
        <KpiScorecardTable
          rows={d.scorecard}
          valuePrefix={valuePrefix}
          classification={classification}
          onExport={onExport}
        />
      </div>
    </div>
  );
}
