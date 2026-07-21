import { lazy, Suspense } from "react";
import { TrendingUp, Package, GitCompare, Table2, ListTree, LayoutGrid, PieChart, BarChart3, LineChart, Sheet, Landmark, Scale, SlidersHorizontal } from "lucide-react";
import { createFabricStandardApp, staticDataSource, formatCompact, overviewInsights } from "@/finance";
import { sampleData, scaleForPerf } from "@/data/sampleFinance";

// The Financial Statements workspace is a self-contained page with its own bundled
// multi-scenario fixture and LOCAL controls. Lazy-loaded from its module (not the
// `@/fpa` barrel) so the whole FP&A suite stays out of the initial chunk.
const LazyStatements = lazy(() =>
  import("@/fpa/features/statements-page").then((m) => ({ default: m.StatementsPage })),
);
const LazyBalanceSheet = lazy(() =>
  import("@/fpa/features/balance-sheet-page").then((m) => ({ default: m.BalanceSheetPage })),
);
const LazyWhatIfPlanner = lazy(() =>
  import("@/fpa/features/whatif-planner-page").then((m) => ({ default: m.WhatIfPlannerPage })),
);

// The demo uses the static adapter with simulated latency so the standardized
// loading / skeleton / error / empty states are visible. To point at a REAL
// semantic model inside a Fabric data app, swap this for the live bridge:
//
//   dataSource: fabricDataSource({ client, connection: "financeModel", columns })
//
// where `client` is the Rayfin SDK client (the host brokers auth — no tokens /
// MSAL) and `connection` is an alias from `fabric.yaml`. See README → "Connect a
// real semantic model". `scaleForPerf` is a no-op unless loaded with `?rows=N`.
const data = scaleForPerf(sampleData);
const dataSource = staticDataSource(data, { label: "Sample · FinanceModel", latencyMs: 700 });

const sum = (rows: typeof sampleData.rows, key: string) =>
  rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

// The entire app — chrome, nav, command palette, filters + cross-filter, exports,
// intelligence rail, data-state handling and per-feature code-splitting — from ONE
// declarative config.
const App = createFabricStandardApp({
  appName: "Finance Analytics",
  subtitle: "One declarative config → a complete, standardized Fabric finance app",
  version: "0.1.0",
  footerLabel: "Finance Analytics · Fabric App Standard",
  dataSource,
  query: {
    id: "main",
    // Illustrative query. It projects every column the pages consume (dimensions +
    // measures) so it doubles as a template for live wiring. The offline
    // `staticDataSource` ignores this string and returns the bundled table; when you
    // swap in `fabricDataSource`, pass a `columns` map remapping the DAX result names
    // (e.g. "Segment[Segment]" -> "segment", "[Revenue]" -> "revenue") to these keys.
    query:
      'EVALUATE SUMMARIZECOLUMNS(Segment[Segment], Region[Region], Channel[Channel], Tier[Tier], "Revenue", [Revenue], "Units", [Units], "Margin", [Margin])',
  },
  features: ["theming", "kpi-cards", "charts", "exports", "data-grid", "pivot", "finance-tables", "intelligence", "command-palette", "notifications", "governance"],
  // Schema-specific intelligence for this FinanceModel: revenue concentration by
  // segment, revenue-weighted margin leaders/laggards, and geographic revenue mix —
  // each honest (raw HHI shown against its equal-share baseline; margin weighted by
  // revenue; composition drills whose parts sum to the portfolio total). Omit this
  // to fall back to the generic `generateInsights` (tuned via `insightOptions`).
  insights: overviewInsights,
  insightOptions: { category: "segment", measure: "revenue", valuePrefix: "$" },
  brand: { primary: "#4cc9ff", accent: "#7c8cff", logoText: "FA" },
  governance: {
    classification: "Public — Sample Data",
    onExport: (e) => console.info("[audit] export", e),
  },
  pages: [
    {
      id: "overview",
      label: "Overview",
      description: "Headline performance, share and regional mix from your semantic model.",
      icon: TrendingUp,
      kind: "overview",
      metrics: (t) => {
        const revenue = sum(t.rows, "revenue");
        const units = sum(t.rows, "units");
        // Revenue-weighted gross margin, derived from the data so it can never
        // contradict the underlying rows and moves when a live model is wired.
        const weightedMargin =
          revenue > 0
            ? t.rows.reduce((a, r) => a + Number(r.margin) * Number(r.revenue), 0) / revenue
            : 0;
        const segTotals = [...new Map(
          t.rows.reduce((m, r) => m.set(String(r.segment), (m.get(String(r.segment)) ?? 0) + Number(r.revenue)), new Map<string, number>()),
        ).values()];
        const unitTrend = [...new Map(
          t.rows.reduce((m, r) => m.set(String(r.region), (m.get(String(r.region)) ?? 0) + Number(r.units)), new Map<string, number>()),
        ).values()];
        // NOTE: the prior-year (YoY) figures below are illustrative placeholders —
        // the bundled sample has no time dimension. Replace `deltaRatio` /
        // `priorYearLabel` / the margin `delta` with real prior-period measures when
        // you connect a live semantic model.
        const priorYear = (total: number, ratio: number) => total / (1 + ratio);
        const revRatio = 0.062;
        const unitRatio = 0.031;
        const marginDeltaPts = -1.4;
        const revPY = priorYear(revenue, revRatio);
        const unitPY = priorYear(units, unitRatio);
        return [
          {
            label: "Total Revenue",
            value: formatCompact(revenue, "$"),
            fullValue: `$${revenue.toLocaleString()}`,
            periodTag: "FYTD",
            deltaRatio: revRatio,
            priorYearLabel: `vs PY ${formatCompact(revPY, "$")}`,
            absoluteDelta: `+${formatCompact(revenue - revPY, "$")}`,
            estimated: true,
            spark: segTotals,
            emphasis: true,
            dense: true,
            icon: TrendingUp,
          },
          {
            label: "Units Shipped",
            value: formatCompact(units),
            fullValue: units.toLocaleString(),
            periodTag: "FYTD",
            deltaRatio: unitRatio,
            priorYearLabel: `vs PY ${formatCompact(unitPY)}`,
            absoluteDelta: `+${formatCompact(units - unitPY)}`,
            estimated: true,
            spark: unitTrend,
            dense: true,
            icon: Package,
          },
          {
            label: "Gross Margin",
            value: `${weightedMargin.toFixed(1)}%`,
            periodTag: "FYTD",
            // Margin moves in percentage POINTS, not a relative %, so use the legacy
            // pre-formatted `delta` string (points) instead of `deltaRatio` to avoid
            // a false "-1.4%" vs "-1.4 pts" equivalence.
            delta: `${marginDeltaPts} pts`,
            priorYearLabel: `vs PY ${(weightedMargin - marginDeltaPts).toFixed(1)}%`,
            estimated: true,
            dense: true,
            icon: GitCompare,
          },
        ];
      },
      charts: (t) => {
        const bySegment = new Map<string, number>();
        const byRegion = new Map<string, number>();
        for (const r of t.rows) {
          bySegment.set(String(r.segment), (bySegment.get(String(r.segment)) ?? 0) + Number(r.revenue));
          byRegion.set(String(r.region), (byRegion.get(String(r.region)) ?? 0) + Number(r.revenue));
        }
        return [
          {
            type: "donut",
            title: "Revenue share by segment",
            hint: "Derived from the live query result",
            icon: PieChart,
            valuePrefix: "$",
            filterColumn: "segment",
            data: [...bySegment.entries()].map(([label, value]) => ({ label, value })),
          },
          {
            type: "bar",
            title: "Revenue by region",
            hint: "Top regions, current scope",
            icon: BarChart3,
            valuePrefix: "$",
            filterColumn: "region",
            data: [...byRegion.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
          },
        ];
      },
    },
    {
      id: "statements",
      label: "P&L & Cash Flow",
      icon: Landmark,
      group: "Financials",
      kind: "custom",
      description: "Board-ready P&L, cash flow, revenue bridge and rolling forecast — with local comparison, currency and one-click board-pack PDF.",
      scope: {
        dimensions: "none",
        period: "global",
        showRowCount: false,
        standardRefresh: false,
        baseInsights: "off",
        note: "Global filters paused · this board reads its own reconciled FP&A dataset.",
      },
      render: (ctx) => (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border bg-secondary/40" />}>
          <LazyStatements globalPeriod={ctx.period} />
        </Suspense>
      ),
    },
    {
      id: "balance-sheet",
      label: "Balance Sheet",
      icon: Scale,
      group: "Financials",
      kind: "custom",
      description: "Articulated balance sheet + liquidity — Assets = Liabilities + Equity by construction, drilling into the intelligence rail.",
      scope: {
        dimensions: "none",
        period: "global",
        showRowCount: false,
        standardRefresh: false,
        baseInsights: "off",
        note: "Global filters paused · balances read the reconciled FP&A dataset.",
      },
      render: (ctx) => (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border bg-secondary/40" />}>
          <LazyBalanceSheet globalPeriod={ctx.period} />
        </Suspense>
      ),
    },
    {
      id: "scenario-planner",
      label: "Scenario Planner",
      icon: SlidersHorizontal,
      group: "Financials",
      kind: "custom",
      description: "Driver-based what-if on the full-year outlook — swing volume, price, margin and OpEx to reshape EBIT live.",
      scope: {
        dimensions: "none",
        period: "none",
        showRowCount: false,
        standardRefresh: false,
        baseInsights: "off",
        note: "Global filters don't drive the planner — it's a full-year driver-based what-if.",
      },
      render: () => (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border border-border bg-secondary/40" />}>
          <LazyWhatIfPlanner />
        </Suspense>
      ),
    },
    { id: "detail", label: "Detail Grid", icon: Table2, kind: "grid", gridEngine: "fabric", group: "Explore", description: "Row-level detail on the official Fabric DataGrid — cell-range select, Ctrl+C into Excel, virtualized rows." },
    { id: "pivot", label: "Pivot", icon: ListTree, kind: "pivot", group: "Explore", description: "Drag dimensions and measures to cross-tabulate." },
    { id: "tables", label: "Finance Tables", icon: Sheet, kind: "tables", group: "Explore", description: "Condensed FP&A tables — variance, trend-over-time, aging, contribution & scorecard. Copy any into Excel or export from its toolbar." },
    { id: "visuals", label: "Visuals", icon: LineChart, kind: "gallery", group: "Explore", description: "A gallery of finance-ready visuals — click any point to drill into the intelligence rail." },
    { id: "features", label: "Feature Catalog", icon: LayoutGrid, group: "Explore", kind: "catalog", description: "Everything this template gives you out of the box.", scope: { dimensions: "none", period: "none", showRowCount: false, note: "Reference view — global filters don't apply here." } },
  ],
  filters: [
    { column: "segment", label: "Segment", pinned: true, group: "Product" },
    { column: "region", label: "Region", pinned: true, group: "Geography" },
    { column: "channel", label: "Channel", group: "Sales" },
    { column: "tier", label: "Customer Tier", group: "Segment" },
  ],
  // Global time scope, pinned into the filter bar. This demo's SUMMARIZECOLUMNS
  // result has no date column, so the preset is scope-only for the grid (it drives
  // the FP&A pages) and the D/W/M/Q grain toggle is hidden (a single grain). Add
  // `column: "<your date column>"` + more `granularities` to make both filter live.
  period: { defaultPreset: "ytd", defaultGranularity: "month", granularities: ["month"] },
});

export default App;
