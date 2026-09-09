import { describe, it, expect } from "vitest";
import {
  cagr,
  ruleOf40,
  operatingLeverage,
  npv,
  irr,
  paybackPeriod,
  breakEvenUnits,
  contributionMarginRatio,
  dupontRoe,
  annualize,
} from "../lib/finance-math";

describe("finance-math", () => {
  it("cagr doubles over 3 years ≈ 25.99%", () => {
    expect(cagr(100, 200, 3)!).toBeCloseTo(0.2599, 3);
    expect(cagr(0, 100, 3)).toBeNull();
    expect(cagr(100, 200, 0)).toBeNull();
  });

  it("ruleOf40 sums growth and margin", () => {
    expect(ruleOf40(0.3, 0.15)).toBeCloseTo(0.45, 6);
  });

  it("operatingLeverage amplifies, guards zero revenue growth", () => {
    expect(operatingLeverage(0.2, 0.1)!).toBeCloseTo(2, 6);
    expect(operatingLeverage(0.2, 0)).toBeNull();
  });

  it("npv discounts future flows", () => {
    // -100 now, +110 next period at 10% → 0
    expect(npv(0.1, [-100, 110])).toBeCloseTo(0, 6);
  });

  it("irr solves the discount rate that zeroes npv", () => {
    const rate = irr([-100, 110])!;
    expect(rate).toBeCloseTo(0.1, 4);
    // classic project
    const r2 = irr([-1000, 300, 400, 500, 200])!;
    expect(npv(r2, [-1000, 300, 400, 500, 200])).toBeCloseTo(0, 4);
    expect(irr([100, 200, 300])).toBeNull(); // no sign change
  });

  it("paybackPeriod finds fractional crossover", () => {
    expect(paybackPeriod([-100, 50, 50, 50])!).toBeCloseTo(2, 6);
    expect(paybackPeriod([-100, 40, 40])).toBeNull();
    expect(paybackPeriod([-100, 200])!).toBeCloseTo(0.5, 6);
  });

  it("breakEvenUnits and contribution margin", () => {
    expect(breakEvenUnits(1000, 25, 15)!).toBeCloseTo(100, 6);
    expect(breakEvenUnits(1000, 10, 12)).toBeNull();
    expect(contributionMarginRatio(25, 15)!).toBeCloseTo(0.4, 6);
  });

  it("dupontRoe reconstructs ROE from its three drivers", () => {
    const d = dupontRoe(120, 1000, 800, 400);
    expect(d.netMargin).toBeCloseTo(0.12, 6);
    expect(d.assetTurnover).toBeCloseTo(1.25, 6);
    expect(d.equityMultiplier).toBeCloseTo(2, 6);
    expect(d.roe).toBeCloseTo(0.3, 6);
  });

  it("annualize scales a partial-year figure", () => {
    expect(annualize(500, 5)!).toBeCloseTo(1200, 6);
    expect(annualize(500, 0)).toBeNull();
  });
});
