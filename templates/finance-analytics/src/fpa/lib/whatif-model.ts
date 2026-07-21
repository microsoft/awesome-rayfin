/**
 * Driver-based scenario (what-if) model for the FP&A planner.
 *
 * Base case = the current full-year OUTLOOK: actuals booked through AS_OF plus the
 * Forecast (FC) for the remaining months of the fiscal year — an honest "where we
 * land" starting point rather than a stale budget.
 *
 * The model is deliberately LINEAR and SEPARABLE so it stays transparent and so the
 * shared <WhatIfPanel> (which adds independent per-driver deltas) reconciles exactly
 * with the page-side mini-P&L recompute. Each driver has a realistic full-swing bound
 * baked into its coefficient; only public statement subtotals are used (no reliance
 * on private fixture internals like the fixed/variable cost split):
 *
 *   • Volume ±12%   — scales revenue AND cost of revenue together (holds gross margin),
 *                     so its EBIT effect is ±12% of gross profit.
 *   • Price ±5%     — pure realisation; drops straight to EBIT (±5% of revenue).
 *   • Gross margin ±2pp — moves cost of revenue; ±2% of revenue to EBIT.
 *   • OpEx efficiency ±8% — moves operating expenses; a favourable (right) setting
 *                     REDUCES opex, adding ±8% of opex to EBIT.
 */

import { PERIODS } from "../data/statementFacts";
import { actualOf, monthlySeries } from "./statement-model";
import { buildCashflow } from "./cashflow";
import { resolveWindow } from "./time-aggregation";

export interface PlanBase {
  revenue: number;
  /** Cost of revenue magnitude (positive). */
  cogs: number;
  grossProfit: number;
  /** Operating-expense magnitude (positive). */
  opex: number;
  /** Depreciation & amortization magnitude (positive). */
  da: number;
  ebit: number;
  /** Free-cash-flow conversion (YTD FCF ÷ YTD EBIT) used for the scenario FCF proxy. */
  fcfConversion: number;
}

const FY_WINDOW = resolveWindow("fy");
const periodPos = new Map<string, number>();
PERIODS.forEach((p, i) => periodPos.set(p, i));

/** Full-year outlook for a row: booked actuals where present, else forecast. */
function outlook(id: string): number {
  const ac = monthlySeries(id, "AC");
  const fc = monthlySeries(id, "FC");
  let sum = 0;
  for (const p of FY_WINDOW) {
    const i = periodPos.get(p);
    if (i == null) continue;
    const a = ac[i];
    sum += a != null ? a : fc[i] ?? 0;
  }
  return sum;
}

export function planBase(): PlanBase {
  const revenue = outlook("revenue");
  const cogs = Math.abs(outlook("cogs"));
  const grossProfit = outlook("gross_profit");
  const opex = Math.abs(outlook("opex"));
  const da = Math.abs(outlook("da"));
  const ebit = outlook("ebit");

  const ytdEbit = actualOf("ebit", "ytd") ?? 0;
  const ytdFcf = buildCashflow("ytd").find((l) => l.id === "fcf")?.value ?? 0;
  const fcfConversion = ytdEbit > 0 ? ytdFcf / ytdEbit : 0;

  return { revenue, cogs, grossProfit, opex, da, ebit, fcfConversion };
}

export interface PlanDriver {
  id: string;
  label: string;
  hint: string;
  /** Full-swing bound, e.g. 0.12 for ±12%. */
  swing: number;
}

/** Driver definitions, in slider order. `swing` is the ± bound at the slider ends. */
export const PLAN_DRIVERS: PlanDriver[] = [
  { id: "volume", label: "Volume", hint: "Units sold move up/down; cost of revenue scales with them, holding gross margin. ±12%.", swing: 0.12 },
  { id: "price", label: "Price / realisation", hint: "Average selling price only — drops straight to the bottom line. ±5%.", swing: 0.05 },
  { id: "grossMargin", label: "Gross margin", hint: "Cost of revenue efficiency, expressed as ± percentage points of margin. ±2pp.", swing: 0.02 },
  { id: "opex", label: "OpEx efficiency", hint: "Operating-expense discipline — a favourable setting reduces opex. ±8%.", swing: 0.08 },
];

/** Dollar EBIT effect of each driver at full upside (index-aligned to PLAN_DRIVERS). */
export function driverFullEffects(base: PlanBase): number[] {
  return [
    0.12 * base.grossProfit, // volume → incremental gross profit
    0.05 * base.revenue, // price → straight to EBIT
    0.02 * base.revenue, // +2pp margin on revenue
    0.08 * base.opex, // opex efficiency reduces cost
  ];
}

/** Convert to the shared WhatIfPanel driver shape (fractions of base EBIT). */
export function whatIfDrivers(base: PlanBase): { label: string; up: number; down: number }[] {
  const effects = driverFullEffects(base);
  return PLAN_DRIVERS.map((d, i) => {
    const frac = base.ebit !== 0 ? effects[i] / base.ebit : 0;
    return { label: d.label, up: frac, down: -frac };
  });
}

export interface PlanResult {
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  opex: number;
  ebit: number;
  ebitMarginPct: number;
  fcf: number;
  /** Signed EBIT effect contributed by each driver at the current positions. */
  effects: number[];
}

/**
 * Recompute the scenario P&L from slider positions t ∈ [-1,1]. Uses the SAME linear
 * coefficients as `whatIfDrivers`, so the mini-statement, the waterfall and the
 * WhatIfPanel headline always agree.
 */
export function planFromPositions(base: PlanBase, positions: number[]): PlanResult {
  const tVol = positions[0] ?? 0;
  const tPrice = positions[1] ?? 0;
  const tGm = positions[2] ?? 0;
  const tOpex = positions[3] ?? 0;

  const revenue = base.revenue * (1 + 0.12 * tVol + 0.05 * tPrice);
  const cogs = base.cogs * (1 + 0.12 * tVol) - 0.02 * base.revenue * tGm;
  const opex = base.opex * (1 - 0.08 * tOpex);
  const grossProfit = revenue - cogs;
  const ebit = grossProfit - opex - base.da;
  const effects = driverFullEffects(base).map((e, i) => e * (positions[i] ?? 0));

  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginPct: revenue !== 0 ? grossProfit / revenue : 0,
    opex,
    ebit,
    ebitMarginPct: revenue !== 0 ? ebit / revenue : 0,
    fcf: ebit * base.fcfConversion,
    effects,
  };
}
