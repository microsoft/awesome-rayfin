import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ExplainPanel from "@/finance/features/explain-panel";
import { IntelligenceRail, type Insight } from "@/finance/features/intelligence-rail";
import type { ExplainInput } from "@/finance/lib/insights-kernel";

// Presentational regression tests for the density + rail redesign. These lock in
// the *honesty* rules the drill panel must never regress on (no fabricated score
// ring, true attainment %, neutral rows never colored, zero-comparator guarded)
// plus the flat-rail heading-dedup contract used by the shell.

function base(over: Partial<ExplainInput>): ExplainInput {
  return { label: "Test", value: 100, valuePrefix: "$", pointInSeries: false, ...over };
}

describe("ExplainPanel — honest scorecard dial", () => {
  it("shows NO dial for a neutral metric with no like-for-like reading", () => {
    // A balance-sheet-style line: neutral directionality, no budget/series.
    render(<ExplainPanel input={base({ directionality: "neutral" })} />);
    expect(screen.queryByText(/of budget/i)).toBeNull();
    expect(screen.queryByText(/percentile/i)).toBeNull();
  });

  it("prints the TRUE attainment % in the dial center when over 100%", () => {
    render(
      <ExplainPanel
        input={base({ value: 112, budget: 100, directionality: "higher-better" })}
      />,
    );
    // The dial center must read the real 112%, not a clamped 100%.
    expect(screen.getByText("112%")).toBeInTheDocument();
    expect(screen.getByText(/of budget/i)).toBeInTheDocument();
  });
});

describe("ExplainPanel — figures table honesty", () => {
  it("renders an em-dash for a zero comparator instead of a divide-by-zero %", () => {
    const { container } = render(
      <ExplainPanel input={base({ value: 50, budget: 0, directionality: "higher-better" })} />,
    );
    expect(container.querySelector("caption")?.textContent).toContain("Figures");
    // vs Budget row exists and its variance % collapses to "—".
    expect(screen.getByText("vs Budget")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("colors a favorable variance for a directional metric", () => {
    const { container } = render(
      <ExplainPanel input={base({ value: 120, budget: 100, directionality: "higher-better" })} />,
    );
    // Beating budget on a higher-better line is favorable → success color present.
    expect(container.querySelector(".text-success")).not.toBeNull();
  });

  it("never colors variance for a neutral (balance-sheet) metric", () => {
    const { container } = render(
      <ExplainPanel input={base({ value: 120, budget: 100, directionality: "neutral" })} />,
    );
    // Neutral balances are never framed favorable/unfavorable anywhere in the panel.
    expect(container.querySelector(".text-success")).toBeNull();
    expect(container.querySelector(".text-destructive")).toBeNull();
  });
});

describe("IntelligenceRail — flat list + heading dedup", () => {
  const insights: Insight[] = [
    { title: "Revenue ahead of plan", body: "Up 6% vs budget.", tone: "positive", metric: "+$2.6B", source: "P&L", confidence: 0.82 },
    { title: "OpEx creeping", body: "Watch travel spend.", tone: "watch", metric: "-$0.4B" },
  ];

  it("renders the internal heading by default", () => {
    render(<IntelligenceRail insights={insights} />);
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
  });

  it("suppresses the internal heading when showHeading is false", () => {
    render(<IntelligenceRail insights={insights} showHeading={false} />);
    expect(screen.queryByText("Intelligence")).toBeNull();
    // Content still renders.
    expect(screen.getByText("Revenue ahead of plan")).toBeInTheDocument();
  });

  it("surfaces each insight's title, metric and provenance", () => {
    render(<IntelligenceRail insights={insights} showHeading={false} />);
    expect(screen.getByText("+$2.6B")).toBeInTheDocument();
    expect(screen.getByText("P&L")).toBeInTheDocument();
  });

  it("fires onAction when an insight action is triggered", () => {
    const onAction = vi.fn();
    const withAction: Insight[] = [
      { title: "Jump", body: "Go somewhere.", action: { label: "Open", targetView: "pnl" } },
    ];
    render(<IntelligenceRail insights={withAction} showHeading={false} onAction={onAction} />);
    screen.getByRole("button", { name: /open/i }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
