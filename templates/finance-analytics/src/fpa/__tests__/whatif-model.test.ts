import { describe, it, expect } from "vitest";
import {
  planBase,
  planFromPositions,
  driverFullEffects,
  whatIfDrivers,
  PLAN_DRIVERS,
} from "../lib/whatif-model";

describe("what-if planner model", () => {
  const base = planBase();

  it("base outlook is internally consistent (GP = Rev − COGS, EBIT = GP − OpEx − D&A)", () => {
    expect(base.revenue).toBeGreaterThan(0);
    expect(base.grossProfit).toBeCloseTo(base.revenue - base.cogs, 4);
    expect(base.ebit).toBeCloseTo(base.grossProfit - base.opex - base.da, 4);
  });

  it("zero positions reproduce the base case exactly", () => {
    const r = planFromPositions(base, [0, 0, 0, 0]);
    expect(r.revenue).toBeCloseTo(base.revenue, 6);
    expect(r.ebit).toBeCloseTo(base.ebit, 6);
    expect(r.grossProfit).toBeCloseTo(base.grossProfit, 6);
  });

  it("the linear recompute matches the sum of independent driver effects (WhatIfPanel parity)", () => {
    const positions = [0.5, -0.3, 0.8, 0.4];
    const r = planFromPositions(base, positions);
    const effects = driverFullEffects(base);
    const expectedEbit = base.ebit + effects.reduce((s, e, i) => s + e * positions[i], 0);
    expect(r.ebit).toBeCloseTo(expectedEbit, 4);
  });

  it("volume moves revenue and cost of revenue together, holding gross margin roughly", () => {
    const up = planFromPositions(base, [1, 0, 0, 0]);
    // +12% volume → +12% revenue and +12% COGS
    expect(up.revenue).toBeCloseTo(base.revenue * 1.12, 4);
    expect(up.cogs).toBeCloseTo(base.cogs * 1.12, 4);
    expect(up.grossMarginPct).toBeCloseTo(base.grossProfit / base.revenue, 6);
  });

  it("price drops straight to EBIT (no cost change)", () => {
    const up = planFromPositions(base, [0, 1, 0, 0]);
    expect(up.cogs).toBeCloseTo(base.cogs, 6);
    expect(up.ebit - base.ebit).toBeCloseTo(0.05 * base.revenue, 4);
  });

  it("OpEx efficiency upside reduces opex and lifts EBIT", () => {
    const up = planFromPositions(base, [0, 0, 0, 1]);
    expect(up.opex).toBeLessThan(base.opex);
    expect(up.ebit).toBeGreaterThan(base.ebit);
  });

  it("whatIfDrivers emit up>0 / down<0 for the panel", () => {
    const drivers = whatIfDrivers(base);
    expect(drivers.length).toBe(PLAN_DRIVERS.length);
    for (const d of drivers) {
      expect(d.up).toBeGreaterThan(0);
      expect(d.down).toBeLessThan(0);
    }
  });
});
