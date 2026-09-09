import { describe, it, expect } from "vitest";
import {
  balanceSnapshots,
  buildBalanceSheet,
  liquidityRatios,
  workingCapitalTrend,
} from "../lib/balance-sheet";
import type { StatementPreset } from "../lib/time-aggregation";

const PRESETS: StatementPreset[] = ["month", "qtd", "ytd", "fy", "last12m"];

describe("balance-sheet articulation", () => {
  it("every monthly snapshot balances: Assets = Liabilities + Equity", () => {
    expect(balanceSnapshots.length).toBeGreaterThan(0);
    for (const s of balanceSnapshots) {
      expect(Math.abs(s.totalAssets - (s.totalLiabilities + s.totalEquity))).toBeLessThan(1);
    }
  });

  it("component subtotals tie to their parents", () => {
    for (const s of balanceSnapshots) {
      expect(s.currentAssets).toBeCloseTo(s.cash + s.ar + s.inventory, 6);
      expect(s.totalAssets).toBeCloseTo(s.currentAssets + s.nonCurrentAssets, 6);
      expect(s.currentLiabilities).toBeCloseTo(s.ap + s.currentDebt, 6);
      expect(s.totalEquity).toBeCloseTo(s.paidIn + s.retained, 6);
    }
  });

  it("retained earnings grow monotonically while the business is profitable", () => {
    const re = balanceSnapshots.map((s) => s.retained);
    expect(re[re.length - 1]).toBeGreaterThan(re[0]);
  });

  it("buildBalanceSheet reports balanced=true and a Total L&E == Total assets", () => {
    for (const preset of PRESETS) {
      const { lines, balanced } = buildBalanceSheet(preset);
      expect(balanced).toBe(true);
      const assets = lines.find((l) => l.id === "total_assets")?.actual ?? 0;
      const leq = lines.find((l) => l.id === "total_leq")?.actual ?? 0;
      expect(Math.abs(assets - leq)).toBeLessThan(1);
    }
  });

  it("balance-sheet lines carry a neutral favorability (no false green/red)", () => {
    const { lines } = buildBalanceSheet("ytd");
    for (const l of lines) {
      if (l.variance.PY) expect(l.variance.PY.favorability).toBe("neutral");
    }
  });
});

describe("liquidity ratios", () => {
  it("current ratio exceeds quick ratio and both are positive", () => {
    const r = liquidityRatios("ytd");
    expect(r.currentRatio!).toBeGreaterThan(0);
    expect(r.quickRatio!).toBeGreaterThan(0);
    expect(r.currentRatio!).toBeGreaterThan(r.quickRatio!);
  });

  it("cash conversion cycle reconciles to DSO + DIO − DPO", () => {
    const r = liquidityRatios("ytd");
    expect(r.ccc!).toBeCloseTo(r.dso! + r.dio! - r.dpo!, 6);
  });

  it("day metrics are in a sane range", () => {
    const r = liquidityRatios("ytd");
    for (const v of [r.dso!, r.dio!, r.dpo!]) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(400);
    }
  });
});

describe("working-capital trend", () => {
  it("returns aligned, non-empty series", () => {
    const t = workingCapitalTrend("ytd");
    expect(t.labels.length).toBeGreaterThan(0);
    expect(t.ar.length).toBe(t.labels.length);
    expect(t.inventory.length).toBe(t.labels.length);
    expect(t.ap.length).toBe(t.labels.length);
  });
});
