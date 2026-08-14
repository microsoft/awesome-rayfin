import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ExplainPanel from "@/finance/features/explain-panel";
import { concentration } from "@/finance/lib/concentration";
import { generateInsights } from "@/finance/lib/insights";
import { overviewInsights } from "@/finance/lib/overview-insights";
import type { DataTable } from "@/finance/lib/types";
import { forecastPointSelection } from "@/fpa/lib/statement-insights";
import { visualSelectionStore } from "@/finance/lib/visual-selection";

// Honesty regression tests for the deepened intelligence rail: HHI reported against
// its equal-share baseline, no fabricated confidence, composition drills whose parts
// sum to the total, revenue-weighted margins, gated distribution strip, and the
// actual-vs-forecast point-in-series split.

describe("concentration() — honest HHI", () => {
  it("puts a perfectly even 5-way split at the 1/n floor, not 0", () => {
    const c = concentration([
      { label: "a", value: 20 },
      { label: "b", value: 20 },
      { label: "c", value: 20 },
      { label: "d", value: 20 },
      { label: "e", value: 20 },
    ])!;
    expect(c.hhi).toBeCloseTo(0.2, 6);
    expect(c.evenHhi).toBeCloseTo(0.2, 6);
    expect(c.effectiveN).toBeCloseTo(5, 6);
    expect(c.normalizedHhi).toBeCloseTo(0, 6);
    expect(c.topShare).toBeCloseTo(0.2, 6);
  });

  it("reports the vital few that first reach 80%", () => {
    const c = concentration([
      { label: "big", value: 70 },
      { label: "mid", value: 20 },
      { label: "small", value: 10 },
    ])!;
    expect(c.vitalFew).toBe(2); // 70 + 20 = 90% ≥ 80 on the second group
    expect(c.topShare).toBeCloseTo(0.7, 6);
    expect(c.normalizedHhi).toBeGreaterThan(0.3);
  });

  it("drops non-finite and non-positive values", () => {
    const c = concentration([
      { label: "a", value: 60 },
      { label: "b", value: 40 },
      { label: "z", value: 0 },
      { label: "n", value: Number.NaN },
      { label: "neg", value: -5 },
    ])!;
    expect(c.n).toBe(2);
    expect(c.total).toBe(100);
  });

  it("returns null when there is nothing positive to rank", () => {
    expect(concentration([{ label: "a", value: 0 }, { label: "b", value: -1 }])).toBeNull();
    expect(concentration([])).toBeNull();
  });
});

function table(rows: Record<string, string | number>[]): DataTable {
  return {
    columns: [
      { key: "segment", label: "Segment" },
      { key: "region", label: "Region" },
      { key: "revenue", label: "Revenue", numeric: true },
      { key: "margin", label: "Margin %", numeric: true },
    ],
    rows,
  };
}

// A tiny mutually-exclusive fixture: 2 segments × 2 regions.
const FIXTURE = table([
  { segment: "Cloud", region: "NA", revenue: 60, margin: 40 },
  { segment: "Cloud", region: "EU", revenue: 20, margin: 30 },
  { segment: "Devices", region: "NA", revenue: 15, margin: 20 },
  { segment: "Devices", region: "EU", revenue: 5, margin: 10 },
]);

describe("generateInsights (generic) — evidence, not fabricated confidence", () => {
  it("never emits a confidence field and always carries evidence", () => {
    const out = generateInsights(FIXTURE, { category: "segment", measure: "revenue", valuePrefix: "$" });
    expect(out.length).toBeGreaterThan(0);
    for (const i of out) {
      expect(i.confidence).toBeUndefined();
      expect(i.evidence).toBeTruthy();
    }
  });

  it("does not emit a tautological Total insight", () => {
    const out = generateInsights(FIXTURE, { category: "segment", measure: "revenue" });
    expect(out.some((i) => /^total /i.test(i.title))).toBe(false);
  });

  it("the concentration drill's children sum to the selected total", () => {
    const out = generateInsights(FIXTURE, { category: "segment", measure: "revenue" });
    const lead = out[0];
    expect(lead.visual?.kind).toBe("share-bars");
    // Run the action and read the selection it pushed into the shared store.
    lead.action!.onRun!();
    const captured = visualSelectionStore.getSnapshot().selection?.explain;
    expect(captured).toBeTruthy();
    const childSum = captured!.children!.reduce((s, c) => s + c.value, 0);
    expect(childSum).toBeCloseTo(captured!.value, 6);
    expect(captured!.directionality).toBe("neutral");
    expect(captured!.pointInSeries).toBe(false);
    visualSelectionStore.clear();
  });

  it("returns [] on an empty table", () => {
    expect(generateInsights({ columns: FIXTURE.columns, rows: [] })).toEqual([]);
  });
});

describe("overviewInsights — schema-specific honesty", () => {
  it("produces segment concentration, margin, and geo-mix insights", () => {
    const out = overviewInsights(FIXTURE);
    expect(out).toHaveLength(3);
    expect(out[0].source).toBe("Revenue by segment");
    expect(out[1].source).toBe("Revenue-weighted margin by segment");
    expect(out[2].source).toBe("Revenue by region");
  });

  it("weights margin by revenue and centres the diverging bars on the portfolio avg", () => {
    const out = overviewInsights(FIXTURE);
    const margin = out[1];
    // Cloud weighted margin = (60*40 + 20*30)/80 = 37.5; Devices = (15*20 + 5*10)/20 = 17.5
    // Portfolio = (60*40+20*30+15*20+5*10)/100 = (2400+600+300+50)/100 = 33.5
    expect(margin.visual?.kind).toBe("diverging-bars");
    if (margin.visual?.kind === "diverging-bars") {
      expect(margin.visual.center).toBeCloseTo(33.5, 6);
      const cloud = margin.visual.items.find((i) => i.label === "Cloud")!;
      const dev = margin.visual.items.find((i) => i.label === "Devices")!;
      expect(cloud.value).toBeCloseTo(37.5, 6);
      expect(dev.value).toBeCloseTo(17.5, 6);
    }
    // Margin isn't additive → no composition drill.
    expect(margin.action).toBeUndefined();
    expect(margin.evidence).toMatch(/spread/);
  });

  it("gates each insight on the columns actually present", () => {
    const noMargin: DataTable = {
      columns: [
        { key: "segment", label: "Segment" },
        { key: "revenue", label: "Revenue", numeric: true },
      ],
      rows: [
        { segment: "A", revenue: 60 },
        { segment: "B", revenue: 40 },
      ],
    };
    const out = overviewInsights(noMargin);
    expect(out.some((i) => i.source === "Revenue-weighted margin by segment")).toBe(false);
    expect(out.some((i) => i.source === "Revenue by region")).toBe(false);
    expect(out.some((i) => i.source === "Revenue by segment")).toBe(true);
  });

  it("flags a single dominant group as a watch, otherwise neutral", () => {
    const dominant = table([
      { segment: "Mega", region: "NA", revenue: 900, margin: 30 },
      { segment: "Tiny", region: "EU", revenue: 100, margin: 30 },
    ]);
    expect(overviewInsights(dominant)[0].tone).toBe("watch"); // 90% share ≥ 50%

    const balanced = table([
      { segment: "A", region: "NA", revenue: 30, margin: 30 },
      { segment: "B", region: "EU", revenue: 28, margin: 30 },
      { segment: "C", region: "NA", revenue: 22, margin: 30 },
      { segment: "D", region: "EU", revenue: 20, margin: 30 },
    ]);
    expect(overviewInsights(balanced)[0].tone).toBe("neutral"); // top 30% < 50%
  });
});

describe("forecastPointSelection — actual vs forecast series gating", () => {
  const actual = [10, 12, 11, 13, 14, 15, 16, null, null];
  const forward = [null, null, null, null, null, null, 16, 17, 18];
  const labels = actual.map((_, i) => `M${i + 1}`);

  it("hands an ACTUAL point a point-in-series explain payload sliced through the click", () => {
    const sel = forecastPointSelection("M6", 5, { actual, forward, wape: 0.05, bias: 0.0, labels }, "$");
    expect(sel.explain).toBeTruthy();
    expect(sel.explain!.pointInSeries).toBe(true);
    // The clicked month IS the last finite point of its own history AS OF that month:
    // the series is sliced through the click so it's never ranked against later actuals.
    expect(sel.explain!.series!.values).toEqual([10, 12, 11, 13, 14, 15]);
    expect(sel.explain!.series!.labels).toEqual(["M1", "M2", "M3", "M4", "M5", "M6"]);
    expect(sel.explain!.value).toBe(15);
  });

  it("ranks a mid-series actual click only against prior periods, not later ones", () => {
    // Click M4 (index 3): later actuals (15, 16) must NOT be in the ranked series.
    const sel = forecastPointSelection("M4", 3, { actual, forward, wape: 0.05, bias: 0.0, labels }, "$");
    expect(sel.explain!.series!.values).toEqual([10, 12, 11, 13]);
    expect(sel.explain!.value).toBe(13);
  });

  it("does NOT rank a FORECAST point against actuals", () => {
    const sel = forecastPointSelection("M8", 7, { actual, forward, wape: 0.05, bias: 0.0, labels }, "$");
    expect(sel.explain).toBeUndefined();
    expect(sel.insights.some((i) => /forecast quality/i.test(i.title))).toBe(true);
  });

  it("never fabricates a zero for a genuine gap (both actual and forecast null)", () => {
    const gapActual = [10, 12, null, 13];
    const gapForward = [null, null, null, null];
    const sel = forecastPointSelection("M3", 2, { actual: gapActual, forward: gapForward, wape: 0.05, bias: 0.0 }, "$");
    expect(sel.value).toBe("—");
    expect(sel.explain).toBeUndefined();
    expect(sel.insights.some((i) => /no data/i.test(i.title))).toBe(true);
  });
});

describe("ExplainPanel — distribution strip gated on point-in-series", () => {
  const series = { labels: ["a", "b", "c", "d", "e", "f", "g"], values: [10, 12, 11, 13, 14, 15, 16] };

  it("shows a Distribution block for a genuine history-rank point", () => {
    render(<ExplainPanel input={{ label: "M7", value: 16, valuePrefix: "$", series, pointInSeries: true, directionality: "higher-better" }} />);
    expect(screen.getByText(/^Distribution$/)).toBeInTheDocument();
    expect(screen.getByText(/th pct/)).toBeInTheDocument();
  });

  it("omits the Distribution block for an aggregate (pointInSeries false)", () => {
    render(<ExplainPanel input={{ label: "agg", value: 16, valuePrefix: "$", series, pointInSeries: false }} />);
    expect(screen.queryByText(/^Distribution$/)).toBeNull();
  });
});
