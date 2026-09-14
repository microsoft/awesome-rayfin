/**
 * Pure statement model: rolls the leaf facts up into a signed, reconciling P&L
 * for any period window, and computes favorability-aware variances.
 *
 * Sign convention: every value is returned in SIGNED space (revenue positive,
 * costs negative, subtotals netted). In signed space "higher is always better",
 * so favorability is uniform: favorable when Actual exceeds the comparison,
 * unfavorable when below — no per-line `lowerIsBetter` bookkeeping required.
 */

import {
  LEAF_SIGN,
  PERIODS,
  PNL_ROWS,
  pnlFacts,
  type PnlFact,
  type PnlLeafId,
  type PnlRow,
  type Scenario,
} from "../data/statementFacts";
import { priorYearWindow, resolveWindow, type StatementPreset } from "./time-aggregation";

export type CompareKey = "BU" | "FC" | "PY";

export type Favorability = "favorable" | "unfavorable" | "neutral";

export interface VarianceDelta {
  /** Signed absolute delta (Actual − comparison), in signed space. */
  abs: number;
  /** Delta as a ratio of the comparison magnitude (null when comparison is 0). */
  pct: number | null;
  favorability: Favorability;
}

export interface StatementLine {
  id: string;
  label: string;
  kind: PnlRow["kind"];
  level: number;
  emphasis: boolean;
  /** Signed actual for the window (null when no actuals exist in-window). */
  actual: number | null;
  /** Signed comparison values, keyed by scenario/PY. */
  compare: Record<CompareKey, number | null>;
  /** Variance vs each comparison (null when either operand is missing). */
  variance: Record<CompareKey, VarianceDelta | null>;
  /** Signed actual per period in the window, for a row sparkline. */
  trend: number[];
}

// Index facts once for O(1) lookup: key = `${period}|${scenario}|${line}`.
const factIndex = new Map<string, number>();
for (const f of pnlFacts) factIndex.set(`${f.period}|${f.scenario}|${f.line}`, f.value);

/** Signed value of a single leaf in one period/scenario (0 when absent). */
function leafSigned(period: string, scenario: Scenario, leaf: PnlLeafId): number {
  const mag = factIndex.get(`${period}|${scenario}|${leaf}`);
  if (mag == null) return 0;
  return mag * LEAF_SIGN[leaf];
}

/** True when any actual fact exists for the leaf in the period. */
function hasActual(period: string, leaf: PnlLeafId): boolean {
  return factIndex.has(`${period}|AC|${leaf}`);
}

/** Signed value of a row (sum of its component leaves) for one period/scenario. */
function rowSigned(period: string, scenario: Scenario, row: PnlRow): number {
  return row.components.reduce((s, leaf) => s + leafSigned(period, scenario, leaf), 0);
}

/** Aggregate a row over a window; returns null when the scenario has no data. */
function rowOverWindow(window: string[], scenario: Scenario, row: PnlRow): number | null {
  let total = 0;
  let seen = false;
  for (const period of window) {
    const anyFact = row.components.some((leaf) => factIndex.has(`${period}|${scenario}|${leaf}`));
    if (anyFact) {
      seen = true;
      total += rowSigned(period, scenario, row);
    }
  }
  return seen ? total : null;
}

function delta(actual: number | null, compare: number | null): VarianceDelta | null {
  if (actual == null || compare == null) return null;
  const abs = actual - compare;
  const pct = compare === 0 ? null : abs / Math.abs(compare);
  const favorability: Favorability = abs > 0.5 ? "favorable" : abs < -0.5 ? "unfavorable" : "neutral";
  return { abs, pct, favorability };
}

export interface StatementOptions {
  preset: StatementPreset;
  /** Comparison columns to compute, in display order. */
  compares?: CompareKey[];
  /** Multiply every value (e.g. FX translation factor is applied upstream). */
  scale?: number;
}

/**
 * Build the full statement for a preset window. Actuals aggregate over the
 * window; PY aggregates the same window shifted back one fiscal year; BU/FC
 * aggregate their own scenario over the window.
 */
export function buildStatement(opts: StatementOptions): StatementLine[] {
  const compares = opts.compares ?? ["BU", "FC", "PY"];
  const scale = opts.scale ?? 1;
  const window = resolveWindow(opts.preset);
  const pyWindow = priorYearWindow(window);

  return PNL_ROWS.map((row) => {
    const actualRaw = rowOverWindow(window, "AC", row);
    const compare: Record<CompareKey, number | null> = {
      BU: compares.includes("BU") ? rowOverWindow(window, "BU", row) : null,
      FC: compares.includes("FC") ? rowOverWindow(window, "FC", row) : null,
      PY: compares.includes("PY") ? rowOverWindow(pyWindow, "AC", row) : null,
    };
    const actual = actualRaw == null ? null : actualRaw * scale;
    const scaled = (v: number | null) => (v == null ? null : v * scale);
    const compareScaled: Record<CompareKey, number | null> = {
      BU: scaled(compare.BU),
      FC: scaled(compare.FC),
      PY: scaled(compare.PY),
    };
    const trend = window.map((period) => (hasAnyActual(period, row) ? rowSigned(period, "AC", row) * scale : NaN));

    return {
      id: row.id,
      label: row.label,
      kind: row.kind,
      level: row.level,
      emphasis: Boolean(row.emphasis),
      actual,
      compare: compareScaled,
      variance: {
        BU: delta(actual, compareScaled.BU),
        FC: delta(actual, compareScaled.FC),
        PY: delta(actual, compareScaled.PY),
      },
      trend,
    };
  });
}

function hasAnyActual(period: string, row: PnlRow): boolean {
  return row.components.some((leaf) => hasActual(period, leaf));
}

/** Convenience: the signed actual of a single row id over a preset window. */
export function actualOf(id: string, preset: StatementPreset, scale = 1): number | null {
  const row = PNL_ROWS.find((r) => r.id === id);
  if (!row) return null;
  const v = rowOverWindow(resolveWindow(preset), "AC", row);
  return v == null ? null : v * scale;
}

/**
 * Per-period signed values for a row across the whole dataset span (one entry per
 * period in `PERIODS`). Missing scenario data yields `null` (e.g. AC after AS_OF),
 * which the line chart renders as a gap. Powers the rolling-forecast timeline.
 */
export function monthlySeries(id: string, scenario: Scenario, scale = 1): (number | null)[] {
  const row = PNL_ROWS.find((r) => r.id === id);
  if (!row) return [];
  return PERIODS.map((period) => {
    const anyFact = row.components.some((leaf) => factIndex.has(`${period}|${scenario}|${leaf}`));
    return anyFact ? rowSigned(period, scenario, row) * scale : null;
  });
}

export type { PnlFact };
