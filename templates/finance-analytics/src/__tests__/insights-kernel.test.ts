import { describe, it, expect } from "vitest";
import {
  robustAnomaly,
  scorecard,
  resolveDirection,
  explain,
  type ExplainInput,
} from "@/finance";

const fmt = (n: number) => n.toFixed(0);

describe("robustAnomaly — degenerate + scale exposure", () => {
  it("returns null below 4 points", () => {
    expect(robustAnomaly([1, 2, 3])).toBeNull();
  });

  it("flags a true outlier as the last point", () => {
    const r = robustAnomaly([10, 11, 9, 10, 40])!;
    expect(r.flagged).toBe(true);
    expect(Math.abs(r.z)).toBeGreaterThanOrEqual(3.5);
    expect(r.degenerate).toBe(false);
    expect(r.scale).toBeGreaterThan(0);
  });

  it("never flags when all values are equal (MAD=0, degenerate)", () => {
    const r = robustAnomaly([5, 5, 5, 5, 5])!;
    expect(r.degenerate).toBe(true);
    expect(r.flagged).toBe(false);
    expect(r.rawMad).toBe(0);
  });

  it("stays finite and unflagged when only one distinct value differs slightly", () => {
    const r = robustAnomaly([5, 5, 5, 5, 6])!;
    expect(Number.isFinite(r.z)).toBe(true);
  });
});

describe("resolveDirection", () => {
  it("prefers explicit directionality", () => {
    expect(resolveDirection({ directionality: "neutral", invert: true })).toBe("neutral");
  });
  it("falls back to invert → lower-better", () => {
    expect(resolveDirection({ invert: true })).toBe("lower-better");
  });
  it("defaults to higher-better", () => {
    expect(resolveDirection({})).toBe("higher-better");
  });
});

describe("scorecard — honest header signals", () => {
  it("shows budget attainment only for higher-better positive budgets", () => {
    const sc = scorecard({ label: "Revenue", value: 110, budget: 100, directionality: "higher-better" });
    expect(sc.metric.kind).toBe("budget-attainment");
    if (sc.metric.kind === "budget-attainment") expect(sc.metric.pct).toBeCloseTo(110);
    expect(sc.status).toBe("Ahead of plan");
    expect(sc.statusTone).toBe("positive");
  });

  it("marks behind plan when below budget", () => {
    const sc = scorecard({ label: "Revenue", value: 90, budget: 100, directionality: "higher-better" });
    expect(sc.status).toBe("Behind plan");
  });

  it("does not show a percentile/attainment dial for a neutral balance-sheet metric", () => {
    const sc = scorecard({ label: "Total assets", value: 500, budget: 480, directionality: "neutral" });
    expect(sc.metric.kind).toBe("none");
    // neutral + no anomaly/plan basis → limited context, never 'ahead/behind'
    expect(["Limited context", "Rising", "Falling"]).toContain(sc.status);
  });

  it("does not rank an aggregate against its own finer series (pointInSeries false)", () => {
    const sc = scorecard({
      label: "YTD revenue",
      value: 1200,
      series: { labels: ["a", "b", "c", "d", "e", "f"], values: [90, 100, 110, 95, 105, 120] },
      pointInSeries: false,
    });
    expect(sc.metric.kind).toBe("none");
  });

  it("ranks a like-for-like point against prior periods", () => {
    const sc = scorecard({
      label: "Aug",
      value: 130,
      series: { labels: ["a", "b", "c", "d", "e", "f"], values: [90, 100, 110, 95, 105, 130] },
      pointInSeries: true,
    });
    expect(sc.metric.kind).toBe("history-rank");
    if (sc.metric.kind === "history-rank") expect(sc.metric.pct).toBeGreaterThan(50);
  });

  it("is resilient to non-finite values in the series", () => {
    const sc = scorecard({
      label: "X",
      value: 10,
      series: { labels: ["a", "b", "c"], values: [null, 5, 10] as (number | null)[] },
      pointInSeries: true,
    });
    expect(sc).toBeTruthy();
  });
});

describe("explain — percentile/anomaly gated on pointInSeries", () => {
  const series = { labels: Array.from({ length: 8 }, (_, i) => `m${i}`), values: [10, 12, 11, 13, 12, 14, 13, 15] };

  it("omits percentile for aggregate rows (pointInSeries not set)", () => {
    const input: ExplainInput = { label: "YTD", value: 100, series };
    const sections = explain(input, fmt);
    const snap = sections.find((s) => s.id === "snapshot")!;
    expect(snap.summary).not.toMatch(/percentile/i);
    expect(sections.find((s) => s.id === "anomalies")).toBeUndefined();
  });

  it("includes percentile for a like-for-like point", () => {
    const input: ExplainInput = { label: "m7", value: 15, series, pointInSeries: true };
    const sections = explain(input, fmt);
    const snap = sections.find((s) => s.id === "snapshot")!;
    expect(snap.summary).toMatch(/percentile/i);
  });
});

describe("explain — neutral directionality never frames favorable/unfavorable", () => {
  const series = { labels: ["a", "b", "c", "d"], values: [100, 110, 120, 130] };

  it("keeps a neutral balance-sheet metric's vs-plan + trend tones neutral", () => {
    const input: ExplainInput = { label: "Total liabilities", value: 130, budget: 120, priorYear: 90, series, directionality: "neutral" };
    const sections = explain(input, fmt);
    const vsPlan = sections.find((s) => s.id === "vs-plan")!;
    expect(vsPlan.summary).not.toMatch(/favorable|unfavorable/i);
    for (const f of vsPlan.facts) expect(f.tone).toBe("neutral");
    const trend = sections.find((s) => s.id === "trend");
    if (trend) for (const f of trend.facts) expect(["neutral"]).toContain(f.tone);
  });

  it("still frames a higher-better metric as favorable when ahead of budget", () => {
    const input: ExplainInput = { label: "Revenue", value: 130, budget: 120, series, directionality: "higher-better" };
    const sections = explain(input, fmt);
    const vsPlan = sections.find((s) => s.id === "vs-plan")!;
    expect(vsPlan.summary).toMatch(/favorable/i);
  });
});

describe("scorecard — outlier status requires enough history", () => {
  it("does not claim Outlier with fewer than 6 points even if the last point is extreme", () => {
    const sc = scorecard({
      label: "m4",
      value: 500,
      series: { labels: ["a", "b", "c", "d", "e"], values: [10, 11, 9, 10, 500] },
      pointInSeries: true,
    });
    expect(sc.status).not.toBe("Outlier");
  });
});
