/**
 * Lightweight, dependency-free finance algorithms. Every function is a pure,
 * testable primitive — no matrices, no solver libraries — so the template can
 * showcase real FP&A math (returns, growth, efficiency, unit economics) without
 * adding weight. All rates are decimals (0.12 = 12%).
 */

/** Compound annual growth rate from a begin/end value over `years` periods. */
export function cagr(begin: number, end: number, years: number): number | null {
  if (begin <= 0 || years <= 0) return null;
  return Math.pow(end / begin, 1 / years) - 1;
}

/** Rule of 40: growth rate + profit (or FCF) margin. ≥ 0.40 is "healthy". */
export function ruleOf40(growthRate: number, profitMargin: number): number {
  return growthRate + profitMargin;
}

/**
 * Operating leverage: how amplified earnings growth is versus revenue growth.
 * Returns null when revenue growth is ~0 (undefined leverage).
 */
export function operatingLeverage(earningsGrowth: number, revenueGrowth: number): number | null {
  if (Math.abs(revenueGrowth) < 1e-9) return null;
  return earningsGrowth / revenueGrowth;
}

/** Net present value of a cashflow series (index 0 = t0, undiscounted). */
export function npv(rate: number, cashflows: number[]): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Internal rate of return via bisection over [-0.9999, 10]. Requires at least one
 * sign change; returns null when NPV never crosses zero in range.
 */
export function irr(cashflows: number[]): number | null {
  const f = (r: number) => npv(r, cashflows);
  let lo = -0.9999;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);
  if (Number.isNaN(flo) || Number.isNaN(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Payback period (in periods) for a project: t0 outflow (negative) followed by
 * inflows. Returns the fractional period the cumulative flow turns non-negative,
 * or null if it never does.
 */
export function paybackPeriod(cashflows: number[]): number | null {
  let cum = 0;
  for (let t = 0; t < cashflows.length; t++) {
    const prev = cum;
    cum += cashflows[t];
    if (cum >= 0) {
      if (t === 0) return 0;
      const need = -prev;
      const flow = cashflows[t];
      return flow !== 0 ? t - 1 + need / flow : t;
    }
  }
  return null;
}

/** Break-even unit volume: fixedCost / (price − variableCost). Null if margin ≤ 0. */
export function breakEvenUnits(fixedCost: number, price: number, variableCost: number): number | null {
  const contribution = price - variableCost;
  if (contribution <= 0) return null;
  return fixedCost / contribution;
}

/** Contribution margin ratio: (price − variableCost) / price. */
export function contributionMarginRatio(price: number, variableCost: number): number | null {
  if (price === 0) return null;
  return (price - variableCost) / price;
}

/**
 * DuPont 3-step ROE decomposition: net margin × asset turnover × equity multiplier.
 * Returns the components plus their product so a view can show the identity.
 */
export function dupontRoe(netIncome: number, revenue: number, assets: number, equity: number) {
  const netMargin = revenue !== 0 ? netIncome / revenue : 0;
  const assetTurnover = assets !== 0 ? revenue / assets : 0;
  const equityMultiplier = equity !== 0 ? assets / equity : 0;
  return { netMargin, assetTurnover, equityMultiplier, roe: netMargin * assetTurnover * equityMultiplier };
}

/** Annualize a within-year (e.g. YTD) figure given how many periods have elapsed. */
export function annualize(partial: number, periodsElapsed: number, periodsPerYear = 12): number | null {
  if (periodsElapsed <= 0) return null;
  return (partial / periodsElapsed) * periodsPerYear;
}
