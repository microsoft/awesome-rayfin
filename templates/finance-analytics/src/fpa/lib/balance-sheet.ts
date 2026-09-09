/**
 * Articulated balance sheet + liquidity, DERIVED from the existing P&L / cash-flow
 * facts (no new random data). The three statements tie out by construction:
 *
 *   • Retained earnings roll forward by monthly net income (EBIT proxy).
 *   • PP&E rolls forward by capex less D&A.
 *   • AR / Inventory / AP are the reconciled working-capital closing balances.
 *   • Cash rolls forward by the indirect cash-flow identity
 *       Δcash = NI + D&A − ΔAR − ΔInv + ΔAP − capex   (no financing modelled),
 *     i.e. cash = opening cash + cumulative free cash flow.
 *   • Debt and paid-in capital are held flat; opening cash is the plug that makes
 *     the opening balance sheet balance, so Assets = Liabilities + Equity EXACTLY
 *     for every actualised month (proven by unit test).
 *
 * Reported in USD only. Closing-rate translation + CTA are intentionally out of
 * scope for the template (the P&L currency toggle is an average-rate convention
 * that must NOT be applied to a balance sheet), so this page stays honest.
 */

import {
  AS_OF,
  PERIODS,
  isActualPeriod,
  periodEndDate,
  wcFacts,
} from "../data/statementFacts";
import { monthlySeries } from "./statement-model";
import type {
  CompareKey,
  Favorability,
  StatementLine,
  VarianceDelta,
} from "./statement-model";
import { actualOf } from "./statement-model";
import { resolveWindow, shiftPeriod, type StatementPreset } from "./time-aggregation";

// ── Opening balance sheet (fiscal-start constants, USD) ──────────────────────
// Held flat except where a roll-forward applies. Opening cash is a PLUG so the
// opening sheet balances; see reconciliation note above.
const PPE_0 = 12_000_000;
const CURRENT_DEBT_0 = 4_000_000; // current portion of borrowings
const LT_DEBT_0 = 16_000_000; // long-term borrowings
const PAID_IN_0 = 15_000_000;
const RETAINED_0 = 0;

const actualPeriods = PERIODS.filter(isActualPeriod);

const wcIndex = new Map<string, (typeof wcFacts)[number]>();
for (const w of wcFacts) wcIndex.set(w.period, w);

// Monthly signed AC series aligned to PERIODS (null after AS_OF).
const ebitSeries = monthlySeries("ebit", "AC");
const daSeries = monthlySeries("da", "AC");
const periodPos = new Map<string, number>();
PERIODS.forEach((p, i) => periodPos.set(p, i));

export interface BalanceSnapshot {
  period: string;
  cash: number;
  ar: number;
  inventory: number;
  ppe: number;
  currentAssets: number;
  nonCurrentAssets: number;
  totalAssets: number;
  ap: number;
  currentDebt: number;
  ltDebt: number;
  currentLiabilities: number;
  nonCurrentLiabilities: number;
  totalLiabilities: number;
  paidIn: number;
  retained: number;
  totalEquity: number;
}

/** Opening working-capital balances (month before the first actual period). */
function openingWc(): { ar: number; inventory: number; ap: number } {
  const first = wcIndex.get(actualPeriods[0]);
  // Approximate the pre-history opening as 92% of the first observed close so the
  // first month shows a genuine (non-zero) working-capital movement.
  return {
    ar: Math.round((first?.ar ?? 0) * 0.92),
    inventory: Math.round((first?.inventory ?? 0) * 0.92),
    ap: Math.round((first?.ap ?? 0) * 0.92),
  };
}

/** Build the full monthly balance-sheet roll-forward once (deterministic). */
function buildSnapshots(): BalanceSnapshot[] {
  const open = openingWc();
  const openTotalDebt = CURRENT_DEBT_0 + LT_DEBT_0;
  // Opening cash is the plug that makes the opening balance sheet reconcile.
  const cash0 =
    open.ap + openTotalDebt + PAID_IN_0 + RETAINED_0 - open.ar - open.inventory - PPE_0;

  let cash = cash0;
  let ppe = PPE_0;
  let retained = RETAINED_0;
  let prevAr = open.ar;
  let prevInv = open.inventory;
  let prevAp = open.ap;

  const out: BalanceSnapshot[] = [];
  for (const period of actualPeriods) {
    const i = periodPos.get(period)!;
    const ni = ebitSeries[i] ?? 0; // signed; positive in normal operation
    const daMag = Math.abs(daSeries[i] ?? 0); // D&A add-back magnitude
    const wc = wcIndex.get(period)!;
    const dAr = wc.ar - prevAr;
    const dInv = wc.inventory - prevInv;
    const dAp = wc.ap - prevAp;

    cash += ni + daMag - dAr - dInv + dAp - wc.capex;
    ppe += wc.capex - daMag;
    retained += ni;

    const currentAssets = cash + wc.ar + wc.inventory;
    const nonCurrentAssets = ppe;
    const currentLiabilities = wc.ap + CURRENT_DEBT_0;
    const nonCurrentLiabilities = LT_DEBT_0;
    const totalEquity = PAID_IN_0 + retained;

    out.push({
      period,
      cash,
      ar: wc.ar,
      inventory: wc.inventory,
      ppe,
      currentAssets,
      nonCurrentAssets,
      totalAssets: currentAssets + nonCurrentAssets,
      ap: wc.ap,
      currentDebt: CURRENT_DEBT_0,
      ltDebt: LT_DEBT_0,
      currentLiabilities,
      nonCurrentLiabilities,
      totalLiabilities: currentLiabilities + nonCurrentLiabilities,
      paidIn: PAID_IN_0,
      retained,
      totalEquity,
    });

    prevAr = wc.ar;
    prevInv = wc.inventory;
    prevAp = wc.ap;
  }
  return out;
}

export const balanceSnapshots: BalanceSnapshot[] = buildSnapshots();

const snapshotByPeriod = new Map<string, BalanceSnapshot>();
for (const s of balanceSnapshots) snapshotByPeriod.set(s.period, s);

/** The last actualised period within a preset window (balance sheets are point-in-time). */
export function asOfPeriod(preset: StatementPreset): string {
  const window = resolveWindow(preset).filter(isActualPeriod);
  return window.length ? window[window.length - 1] : AS_OF;
}

// ── Statement rows (mapped into the shared StatementLine shape) ──────────────
// Raw balances are NOT "higher = better", so favorability is always neutral —
// the balance-sheet table suppresses the P&L heat bar and shows a plain YoY move.

interface BsRowDef {
  id: string;
  label: string;
  level: number;
  emphasis: boolean;
  pick: (s: BalanceSnapshot) => number;
}

const BS_ROWS: BsRowDef[] = [
  { id: "current_assets", label: "Current assets", level: 0, emphasis: false, pick: (s) => s.currentAssets },
  { id: "cash", label: "Cash & equivalents", level: 1, emphasis: false, pick: (s) => s.cash },
  { id: "ar", label: "Accounts receivable", level: 1, emphasis: false, pick: (s) => s.ar },
  { id: "inventory", label: "Inventory", level: 1, emphasis: false, pick: (s) => s.inventory },
  { id: "noncurrent_assets", label: "Non-current assets", level: 0, emphasis: false, pick: (s) => s.nonCurrentAssets },
  { id: "ppe", label: "Property, plant & equipment", level: 1, emphasis: false, pick: (s) => s.ppe },
  { id: "total_assets", label: "Total assets", level: 0, emphasis: true, pick: (s) => s.totalAssets },
  { id: "current_liabilities", label: "Current liabilities", level: 0, emphasis: false, pick: (s) => s.currentLiabilities },
  { id: "ap", label: "Accounts payable", level: 1, emphasis: false, pick: (s) => s.ap },
  { id: "current_debt", label: "Current portion of debt", level: 1, emphasis: false, pick: (s) => s.currentDebt },
  { id: "noncurrent_liabilities", label: "Non-current liabilities", level: 0, emphasis: false, pick: (s) => s.nonCurrentLiabilities },
  { id: "lt_debt", label: "Long-term debt", level: 1, emphasis: false, pick: (s) => s.ltDebt },
  { id: "total_liabilities", label: "Total liabilities", level: 0, emphasis: true, pick: (s) => s.totalLiabilities },
  { id: "equity", label: "Shareholders' equity", level: 0, emphasis: false, pick: (s) => s.totalEquity },
  { id: "paid_in", label: "Paid-in capital", level: 1, emphasis: false, pick: (s) => s.paidIn },
  { id: "retained", label: "Retained earnings", level: 1, emphasis: false, pick: (s) => s.retained },
  { id: "total_leq", label: "Total liabilities & equity", level: 0, emphasis: true, pick: (s) => s.totalLiabilities + s.totalEquity },
];

function neutralDelta(actual: number, compare: number | null): VarianceDelta | null {
  if (compare == null) return null;
  const abs = actual - compare;
  const pct = compare === 0 ? null : abs / Math.abs(compare);
  const favorability: Favorability = "neutral";
  return { abs, pct, favorability };
}

/**
 * Build the point-in-time balance sheet as of the last actual period in the window,
 * with a prior-year comparison (same month one year earlier) and a per-line trend
 * across the window's actual months. Mapped to StatementLine so the shared
 * <FinancialStatement> renders it (compares must be ["PY"]).
 */
export function buildBalanceSheet(preset: StatementPreset): {
  asOf: string;
  lines: StatementLine[];
  balanced: boolean;
} {
  const asOf = asOfPeriod(preset);
  const snap = snapshotByPeriod.get(asOf) ?? null;
  const pySnap = snapshotByPeriod.get(shiftPeriod(asOf, -12)) ?? null;

  const windowActuals = resolveWindow(preset).filter(isActualPeriod);

  const lines: StatementLine[] = BS_ROWS.map((row) => {
    const actual = snap ? row.pick(snap) : null;
    const py = pySnap ? row.pick(pySnap) : null;
    const compare: Record<CompareKey, number | null> = { BU: null, FC: null, PY: py };
    const variance: Record<CompareKey, VarianceDelta | null> = {
      BU: null,
      FC: null,
      PY: actual != null ? neutralDelta(actual, py) : null,
    };
    const trend = windowActuals.map((p) => {
      const s = snapshotByPeriod.get(p);
      return s ? row.pick(s) : NaN;
    });
    return {
      id: row.id,
      label: row.label,
      kind: row.emphasis || row.level === 0 ? "subtotal" : "leaf",
      level: row.level,
      emphasis: row.emphasis,
      actual,
      compare,
      variance,
      trend,
    };
  });

  const balanced = snap ? Math.abs(snap.totalAssets - (snap.totalLiabilities + snap.totalEquity)) < 1 : true;
  return { asOf, lines, balanced };
}

// ── Liquidity & working-capital analytics ────────────────────────────────────

/** Number of calendar days spanned by the window's actual months. */
function windowDays(preset: StatementPreset): number {
  const actuals = resolveWindow(preset).filter(isActualPeriod);
  if (!actuals.length) return 30;
  return actuals.reduce((sum, p) => {
    const [y, m] = p.split("-").map(Number);
    return sum + new Date(y, m, 0).getDate();
  }, 0);
}

export interface LiquidityRatios {
  asOf: string;
  currentRatio: number | null;
  quickRatio: number | null;
  /** Net working capital = current assets − current liabilities (USD). */
  nwc: number | null;
  /** Days sales outstanding (AR ÷ window revenue × days). */
  dso: number | null;
  /** Days inventory outstanding (Inventory ÷ window COGS × days). */
  dio: number | null;
  /** Days payables outstanding (AP ÷ window COGS × days — COGS is a purchases proxy). */
  dpo: number | null;
  /** Cash conversion cycle = DSO + DIO − DPO (days). */
  ccc: number | null;
}

export function liquidityRatios(preset: StatementPreset): LiquidityRatios {
  const asOf = asOfPeriod(preset);
  const s = snapshotByPeriod.get(asOf) ?? null;
  const days = windowDays(preset);
  const revenue = actualOf("revenue", preset) ?? null;
  const cogs = actualOf("cogs", preset);
  const cogsMag = cogs != null ? Math.abs(cogs) : null;

  if (!s) {
    return { asOf, currentRatio: null, quickRatio: null, nwc: null, dso: null, dio: null, dpo: null, ccc: null };
  }

  const currentRatio = s.currentLiabilities ? s.currentAssets / s.currentLiabilities : null;
  const quickRatio = s.currentLiabilities ? (s.currentAssets - s.inventory) / s.currentLiabilities : null;
  const nwc = s.currentAssets - s.currentLiabilities;
  const dso = revenue ? (s.ar / revenue) * days : null;
  const dio = cogsMag ? (s.inventory / cogsMag) * days : null;
  const dpo = cogsMag ? (s.ap / cogsMag) * days : null;
  const ccc = dso != null && dio != null && dpo != null ? dso + dio - dpo : null;

  return { asOf, currentRatio, quickRatio, nwc, dso, dio, dpo, ccc };
}

/** Working-capital closing balances across the window's actual months, for a trend chart. */
export function workingCapitalTrend(preset: StatementPreset): {
  labels: string[];
  ar: number[];
  inventory: number[];
  ap: number[];
} {
  const actuals = resolveWindow(preset).filter(isActualPeriod);
  const labels = actuals.map((p) => {
    const [y, m] = p.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
  });
  const pick = (f: (s: BalanceSnapshot) => number) =>
    actuals.map((p) => {
      const s = snapshotByPeriod.get(p);
      return s ? f(s) : 0;
    });
  return { labels, ar: pick((s) => s.ar), inventory: pick((s) => s.inventory), ap: pick((s) => s.ap) };
}

export { periodEndDate };
