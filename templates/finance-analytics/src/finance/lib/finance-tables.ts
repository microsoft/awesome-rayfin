import type { DataTable, CellValue, Column } from "./types";

/**
 * Pure, dependency-free builders for the condensed finance table types every FP&A
 * app reaches for. Each `compute*` function turns raw inputs into a display model
 * (deltas, shares, attainment, favourability) and each `*ToDataTable` flattens that
 * model into a spreadsheet-friendly {@link DataTable} — raw numeric cells, expanded
 * delta/percent columns — ready for CSV / Excel / PowerPoint export and native copy.
 */

export type Favorability = "favorable" | "unfavorable" | "neutral";

const round = (n: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Favourability of a delta, honouring cost/expense metrics where lower is better. */
function favorabilityOf(abs: number, lowerIsBetter: boolean): Favorability {
  if (abs === 0) return "neutral";
  if (lowerIsBetter) return abs < 0 ? "favorable" : "unfavorable";
  return abs > 0 ? "favorable" : "unfavorable";
}

// ─────────────────────────────────────────────────────────────────────────────
// Variance table — Actuals vs Forecast / Budget / Prior Year with VTF/VTB/VTPY
// ─────────────────────────────────────────────────────────────────────────────

export interface VarianceInput {
  label: string;
  actual: number;
  forecast?: number;
  budget?: number;
  priorYear?: number;
  /** Cost/expense metric: a lower actual is favourable. Default `false`. */
  lowerIsBetter?: boolean;
}

export interface VarianceDelta {
  /** Absolute delta in units (actual − basis). */
  abs: number;
  /** Ratio delta (abs / |basis|); `0` when the basis is `0`. */
  pct: number;
  favorability: Favorability;
}

export interface VarianceRow {
  label: string;
  actual: number;
  forecast?: number;
  budget?: number;
  priorYear?: number;
  /** Variance to forecast. */
  vtf?: VarianceDelta;
  /** Variance to budget. */
  vtb?: VarianceDelta;
  /** Variance to prior year. */
  vtpy?: VarianceDelta;
  lowerIsBetter: boolean;
}

function computeDelta(actual: number, basis: number | undefined, lowerIsBetter: boolean): VarianceDelta | undefined {
  if (basis === undefined || basis === null) return undefined;
  const abs = actual - basis;
  const pct = basis === 0 ? 0 : abs / Math.abs(basis);
  return { abs, pct, favorability: favorabilityOf(abs, lowerIsBetter) };
}

export function computeVariance(rows: VarianceInput[]): VarianceRow[] {
  return rows.map((r) => {
    const lowerIsBetter = r.lowerIsBetter ?? false;
    return {
      label: r.label,
      actual: r.actual,
      forecast: r.forecast,
      budget: r.budget,
      priorYear: r.priorYear,
      vtf: computeDelta(r.actual, r.forecast, lowerIsBetter),
      vtb: computeDelta(r.actual, r.budget, lowerIsBetter),
      vtpy: computeDelta(r.actual, r.priorYear, lowerIsBetter),
      lowerIsBetter,
    };
  });
}

export interface VarianceTableOptions {
  metricLabel?: string;
}

/** Flatten variance rows: base measures + a *separate* Δ and Δ% column per basis. */
export function varianceToDataTable(rows: VarianceRow[], opts: VarianceTableOptions = {}): DataTable {
  const has = (k: "forecast" | "budget" | "priorYear") => rows.some((r) => r[k] !== undefined && r[k] !== null);
  const hasF = has("forecast");
  const hasB = has("budget");
  const hasPY = has("priorYear");

  const columns: Column[] = [{ key: "label", label: opts.metricLabel ?? "Metric" }];
  columns.push({ key: "actual", label: "Actuals", numeric: true });
  if (hasF) columns.push({ key: "forecast", label: "Forecast", numeric: true });
  if (hasB) columns.push({ key: "budget", label: "Budget", numeric: true });
  if (hasPY) columns.push({ key: "priorYear", label: "Prior Year", numeric: true });
  if (hasF) columns.push({ key: "vtf", label: "VTF", numeric: true }, { key: "vtf_pct", label: "VTF %", numeric: true });
  if (hasB) columns.push({ key: "vtb", label: "VTB", numeric: true }, { key: "vtb_pct", label: "VTB %", numeric: true });
  if (hasPY) columns.push({ key: "vtpy", label: "VTPY", numeric: true }, { key: "vtpy_pct", label: "VTPY %", numeric: true });

  const out = rows.map((r) => {
    const rec: Record<string, CellValue> = { label: r.label, actual: round(r.actual) };
    if (hasF) rec.forecast = r.forecast ?? null;
    if (hasB) rec.budget = r.budget ?? null;
    if (hasPY) rec.priorYear = r.priorYear ?? null;
    if (hasF) {
      rec.vtf = r.vtf ? round(r.vtf.abs) : null;
      rec.vtf_pct = r.vtf ? round(r.vtf.pct * 100) : null;
    }
    if (hasB) {
      rec.vtb = r.vtb ? round(r.vtb.abs) : null;
      rec.vtb_pct = r.vtb ? round(r.vtb.pct * 100) : null;
    }
    if (hasPY) {
      rec.vtpy = r.vtpy ? round(r.vtpy.abs) : null;
      rec.vtpy_pct = r.vtpy ? round(r.vtpy.pct * 100) : null;
    }
    return rec;
  });

  return { columns, rows: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-series table — metric × time buckets, trailing windows, totals & growth
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeSeriesInput {
  label: string;
  /** One value per period, oldest → newest, aligned to `periods`. */
  values: number[];
}

export interface TrailingWindow {
  /** Column label, e.g. "T3M" or "Trailing 13W". */
  label: string;
  /** Number of most-recent periods to sum. */
  periods: number;
}

export interface TimeSeriesRow {
  label: string;
  values: number[];
  total: number;
  /** Period-over-period ratio: (last − prev) / |prev|. */
  pop: number;
  /** Trailing-window sums, aligned to the requested windows. */
  trailing: { label: string; value: number }[];
}

export interface TimeSeriesOptions {
  trailing?: TrailingWindow[];
}

function trailingSum(values: number[], periods: number): number {
  const slice = values.slice(Math.max(0, values.length - periods));
  return slice.reduce((s, v) => s + v, 0);
}

export function computeTimeSeries(rows: TimeSeriesInput[], opts: TimeSeriesOptions = {}): TimeSeriesRow[] {
  const windows = opts.trailing ?? [];
  return rows.map((r) => {
    const total = r.values.reduce((s, v) => s + v, 0);
    const last = r.values[r.values.length - 1] ?? 0;
    const prev = r.values[r.values.length - 2];
    const pop = prev === undefined || prev === 0 ? 0 : (last - prev) / Math.abs(prev);
    return {
      label: r.label,
      values: r.values,
      total,
      pop,
      trailing: windows.map((w) => ({ label: w.label, value: trailingSum(r.values, w.periods) })),
    };
  });
}

export interface TimeSeriesTableOptions {
  metricLabel?: string;
  periods: string[];
  trailing?: TrailingWindow[];
  includeTotal?: boolean;
  includeGrowth?: boolean;
}

export function timeSeriesToDataTable(rows: TimeSeriesRow[], opts: TimeSeriesTableOptions): DataTable {
  const columns: Column[] = [{ key: "label", label: opts.metricLabel ?? "Metric" }];
  opts.periods.forEach((p, i) => columns.push({ key: `p${i}`, label: p, numeric: true }));
  (opts.trailing ?? []).forEach((w, i) => columns.push({ key: `t${i}`, label: w.label, numeric: true }));
  if (opts.includeTotal !== false) columns.push({ key: "total", label: "Total", numeric: true });
  if (opts.includeGrowth !== false) columns.push({ key: "pop", label: "PoP %", numeric: true });

  const out = rows.map((r) => {
    const rec: Record<string, CellValue> = { label: r.label };
    opts.periods.forEach((_, i) => (rec[`p${i}`] = r.values[i] ?? null));
    r.trailing.forEach((t, i) => (rec[`t${i}`] = round(t.value)));
    if (opts.includeTotal !== false) rec.total = round(r.total);
    if (opts.includeGrowth !== false) rec.pop = round(r.pop * 100);
    return rec;
  });

  return { columns, rows: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contribution / mix (Pareto) — value, % of total, cumulative %
// ─────────────────────────────────────────────────────────────────────────────

export interface ContributionInput {
  label: string;
  value: number;
}

export interface ContributionRow {
  label: string;
  value: number;
  /** Share of the total (ratio 0–1). */
  share: number;
  /** Running cumulative share (ratio 0–1) in descending value order. */
  cumulative: number;
  rank: number;
}

export interface ContributionOptions {
  /** Keep the top-N rows and roll the remainder into an "Others" line. */
  topN?: number;
  othersLabel?: string;
}

export function computeContribution(rows: ContributionInput[], opts: ContributionOptions = {}): ContributionRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value);

  let working = sorted;
  if (opts.topN !== undefined && sorted.length > opts.topN) {
    const top = sorted.slice(0, opts.topN);
    const rest = sorted.slice(opts.topN);
    const othersValue = rest.reduce((s, r) => s + r.value, 0);
    working = [...top, { label: opts.othersLabel ?? "Others", value: othersValue }];
  }

  const total = working.reduce((s, r) => s + r.value, 0);
  let cumulative = 0;
  return working.map((r, i) => {
    const share = total === 0 ? 0 : r.value / total;
    cumulative += share;
    return { label: r.label, value: r.value, share, cumulative, rank: i + 1 };
  });
}

export interface ContributionTableOptions {
  metricLabel?: string;
  valueLabel?: string;
}

export function contributionToDataTable(rows: ContributionRow[], opts: ContributionTableOptions = {}): DataTable {
  const columns: Column[] = [
    { key: "rank", label: "#", numeric: true },
    { key: "label", label: opts.metricLabel ?? "Category" },
    { key: "value", label: opts.valueLabel ?? "Value", numeric: true },
    { key: "share", label: "% of Total", numeric: true },
    { key: "cumulative", label: "Cumulative %", numeric: true },
  ];
  const out = rows.map((r) => ({
    rank: r.rank,
    label: r.label,
    value: round(r.value),
    share: round(r.share * 100),
    cumulative: round(r.cumulative * 100),
  }));
  return { columns, rows: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI scorecard — actual vs target, attainment %, RAG status, trend
// ─────────────────────────────────────────────────────────────────────────────

export type ScorecardStatus = "on-track" | "at-risk" | "off-track";

export interface ScorecardInput {
  label: string;
  actual: number;
  target: number;
  /** Optional trend series (oldest → newest) for a sparkline column. */
  trend?: number[];
  /** Cost/expense metric: a lower actual vs target is favourable. Default `false`. */
  lowerIsBetter?: boolean;
  /** Per-row value prefix (e.g. "$", "" for counts, or a "%"-style suffix handled by the view). */
  unitPrefix?: string;
}

export interface ScorecardRow {
  label: string;
  actual: number;
  target: number;
  /** actual / target (ratio). For `lowerIsBetter`, attainment is target / actual. */
  attainment: number;
  status: ScorecardStatus;
  trend?: number[];
  unitPrefix?: string;
}

/** Attainment ≥ 100% → on-track, within `nearBand` (default 5%) → at-risk, else off-track. */
export function computeScorecard(rows: ScorecardInput[], nearBand = 0.05): ScorecardRow[] {
  return rows.map((r) => {
    const lowerIsBetter = r.lowerIsBetter ?? false;
    const attainment = lowerIsBetter
      ? r.actual === 0
        ? 0
        : r.target / r.actual
      : r.target === 0
        ? 0
        : r.actual / r.target;
    let status: ScorecardStatus;
    if (attainment >= 1) status = "on-track";
    else if (attainment >= 1 - nearBand) status = "at-risk";
    else status = "off-track";
    return {
      label: r.label,
      actual: r.actual,
      target: r.target,
      attainment,
      status,
      trend: r.trend,
      unitPrefix: r.unitPrefix,
    };
  });
}

export interface ScorecardTableOptions {
  metricLabel?: string;
}

export function scorecardToDataTable(rows: ScorecardRow[], opts: ScorecardTableOptions = {}): DataTable {
  const columns: Column[] = [
    { key: "label", label: opts.metricLabel ?? "KPI" },
    { key: "actual", label: "Actual", numeric: true },
    { key: "target", label: "Target", numeric: true },
    { key: "attainment", label: "Attainment %", numeric: true },
    { key: "status", label: "Status" },
  ];
  const statusLabel: Record<ScorecardStatus, string> = {
    "on-track": "On track",
    "at-risk": "At risk",
    "off-track": "Off track",
  };
  const out = rows.map((r) => ({
    label: r.label,
    actual: round(r.actual),
    target: round(r.target),
    attainment: round(r.attainment * 100),
    status: statusLabel[r.status],
  }));
  return { columns, rows: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Aging schedule — AR/AP balances bucketed by days outstanding
// ─────────────────────────────────────────────────────────────────────────────

/** Bucket boundaries in days; the final bucket is open-ended (e.g. "90+"). */
export const DEFAULT_AGING_BUCKETS = [0, 30, 60, 90] as const;

export interface AgingInput {
  label: string;
  /**
   * Balance per aging bucket, aligned to `buckets`. The array length must equal
   * the number of buckets (boundaries + 1 open-ended tail).
   */
  buckets: number[];
}

export interface AgingRow {
  label: string;
  buckets: number[];
  /** Total balance across every bucket. */
  total: number;
  /** Balance in all buckets past the current (first) bucket. */
  overdue: number;
  /** Overdue balance as a ratio of total; `0` when total is `0`. */
  pctOverdue: number;
}

/** Human labels for a set of bucket boundaries, e.g. [0,30,60,90] → Current / 1–30 / 31–60 / 61–90 / 90+. */
export function agingBucketLabels(boundaries: readonly number[] = DEFAULT_AGING_BUCKETS): string[] {
  const labels = ["Current"];
  for (let i = 1; i < boundaries.length; i++) {
    labels.push(`${boundaries[i - 1] + 1}\u2013${boundaries[i]}`);
  }
  labels.push(`${boundaries[boundaries.length - 1]}+`);
  return labels;
}

export function computeAging(rows: AgingInput[]): AgingRow[] {
  return rows.map((r) => {
    const total = r.buckets.reduce((a, b) => a + b, 0);
    const overdue = r.buckets.slice(1).reduce((a, b) => a + b, 0);
    return {
      label: r.label,
      buckets: r.buckets,
      total,
      overdue,
      pctOverdue: total === 0 ? 0 : overdue / total,
    };
  });
}

export interface AgingTableOptions {
  metricLabel?: string;
  /** Bucket boundaries used to label the columns. Default {@link DEFAULT_AGING_BUCKETS}. */
  boundaries?: readonly number[];
  /** Append a totals row summing every account. Default `true`. */
  includeTotalRow?: boolean;
}

/** Flatten an aging schedule: one numeric column per bucket + total, overdue and % overdue. */
export function agingToDataTable(rows: AgingRow[], opts: AgingTableOptions = {}): DataTable {
  const boundaries = opts.boundaries ?? DEFAULT_AGING_BUCKETS;
  const labels = agingBucketLabels(boundaries);
  const columns: Column[] = [{ key: "label", label: opts.metricLabel ?? "Account" }];
  labels.forEach((label, i) => columns.push({ key: `b${i}`, label, numeric: true }));
  columns.push(
    { key: "total", label: "Total", numeric: true },
    { key: "overdue", label: "Overdue", numeric: true },
    { key: "pct_overdue", label: "% overdue", numeric: true },
  );

  const out = rows.map((r) => {
    const rec: Record<string, CellValue> = { label: r.label };
    r.buckets.forEach((v, i) => (rec[`b${i}`] = round(v)));
    rec.total = round(r.total);
    rec.overdue = round(r.overdue);
    rec.pct_overdue = round(r.pctOverdue * 100);
    return rec;
  });

  if ((opts.includeTotalRow ?? true) && rows.length > 0) {
    const n = labels.length;
    const sums = new Array(n).fill(0);
    let total = 0;
    let overdue = 0;
    for (const r of rows) {
      r.buckets.forEach((v, i) => (sums[i] += v));
      total += r.total;
      overdue += r.overdue;
    }
    const rec: Record<string, CellValue> = { label: "Total" };
    sums.forEach((v, i) => (rec[`b${i}`] = round(v)));
    rec.total = round(total);
    rec.overdue = round(overdue);
    rec.pct_overdue = total === 0 ? 0 : round((overdue / total) * 100);
    out.push(rec);
  }

  return { columns, rows: out };
}
