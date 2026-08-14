import { useMemo, useState } from "react";
import {
  KpiCard,
  VisualFrame,
  WhatIfPanel,
  WaterfallChart,
  TornadoChart,
  Tooltip,
  visualSelectionStore,
  formatCompact,
  formatSignedCompact,
  formatSignedPercent,
} from "@/finance";
import type { Insight } from "@/finance";
import { SlidersHorizontal, TrendingUp, Gauge, Wallet, Info, Percent } from "lucide-react";
import {
  planBase,
  planFromPositions,
  whatIfDrivers,
  driverFullEffects,
  PLAN_DRIVERS,
} from "../lib/whatif-model";
import { VARIANCE_COLOR } from "../lib/ibcs";

const PREFIX = "$";

/**
 * Scenario Planner — a driver-based what-if on the current full-year outlook
 * (actuals to date + forecast for the remainder). Sliders swing volume, price,
 * gross margin and OpEx; the outcome recomputes live through a transparent linear
 * model that ties out to the waterfall and the mini scenario P&L. Every lever and
 * bar explains itself in the intelligence rail. All client-side and memoized.
 */
export function WhatIfPlannerPage() {
  const base = useMemo(() => planBase(), []);
  const drivers = useMemo(() => whatIfDrivers(base), [base]);
  const fullEffects = useMemo(() => driverFullEffects(base), [base]);

  const [positions, setPositions] = useState<number[]>(() => PLAN_DRIVERS.map(() => 0));
  const plan = useMemo(() => planFromPositions(base, positions), [base, positions]);
  const baseFcf = base.ebit * base.fcfConversion;

  const dirty = positions.some((t) => t !== 0);

  const kpis = [
    {
      label: "Scenario revenue",
      value: formatCompact(plan.revenue, PREFIX),
      icon: TrendingUp,
      ratio: base.revenue !== 0 ? (plan.revenue - base.revenue) / base.revenue : null,
      sub: `vs base ${formatCompact(base.revenue, PREFIX)}`,
    },
    {
      label: "Scenario EBIT",
      value: formatCompact(plan.ebit, PREFIX),
      icon: Gauge,
      ratio: base.ebit !== 0 ? (plan.ebit - base.ebit) / base.ebit : null,
      sub: `vs base ${formatCompact(base.ebit, PREFIX)}`,
    },
    {
      label: "EBIT margin",
      value: formatSignedPercent(plan.ebitMarginPct).replace("+", ""),
      icon: Percent,
      ratio: null,
      sub: `${(() => {
        const pp = (plan.ebitMarginPct - base.ebit / base.revenue) * 100;
        return `${pp >= 0 ? "+" : ""}${pp.toFixed(1)} pp vs base`;
      })()}`,
    },
    {
      label: "FCF (at current conversion)",
      value: formatCompact(plan.fcf, PREFIX),
      icon: Wallet,
      ratio: baseFcf !== 0 ? (plan.fcf - baseFcf) / baseFcf : null,
      sub: "EBIT × YTD cash conversion",
    },
  ];

  // Live waterfall: base EBIT → each driver effect → scenario EBIT.
  const waterfallSteps = [
    { label: "Base EBIT", value: base.ebit, kind: "start" as const },
    ...PLAN_DRIVERS.map((d, i) => ({ label: d.label, value: plan.effects[i], kind: "delta" as const })),
    { label: "Scenario EBIT", value: plan.ebit, kind: "total" as const },
  ];

  // Sensitivity around the LIVE scenario: each lever's full swing recentred on the
  // current scenario EBIT so the tornado stays consistent with the waterfall/headline.
  const tornadoDrivers = PLAN_DRIVERS.map((d, i) => ({
    label: d.label,
    low: plan.ebit - fullEffects[i],
    high: plan.ebit + fullEffects[i],
  }));

  const miniRows = [
    { label: "Revenue", value: plan.revenue, base: base.revenue, emphasis: true },
    { label: "Cost of revenue", value: -plan.cogs, base: -base.cogs, emphasis: false },
    { label: "Gross profit", value: plan.grossProfit, base: base.grossProfit, emphasis: true },
    { label: "Operating expenses", value: -plan.opex, base: -base.opex, emphasis: false },
    { label: "Depreciation & amortization", value: -base.da, base: -base.da, emphasis: false },
    { label: "Operating income (EBIT)", value: plan.ebit, base: base.ebit, emphasis: true },
  ];

  return (
    <div className="fpa-board-stack">
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Base case is the <strong>current full-year outlook</strong> — actuals booked to date plus forecast for the
          remaining months. Move the levers to reshape the outcome; the model is linear and reconciles exactly to the
          waterfall and the scenario P&amp;L below. Click any waterfall step or sensitivity bar to explain it.
        </span>
      </div>

      {/* Scenario KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <KpiCard key={k.label} dense label={k.label} value={k.value} icon={k.icon} deltaRatio={k.ratio} deltaSuffix="vs base" priorYearLabel={k.sub} />
        ))}
      </div>

      {/* Sliders + live waterfall */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VisualFrame title="Scenario levers" hint="Drag to reshape the full-year outlook" icon={SlidersHorizontal}>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {PLAN_DRIVERS.map((d) => (
              <Tooltip key={d.id} content={<span className="block max-w-[220px]">{d.hint}</span>}>
                <span className="cursor-help underline decoration-dotted underline-offset-2">{d.label}</span>
              </Tooltip>
            ))}
          </div>
          <WhatIfPanel
            base={base.ebit}
            drivers={drivers}
            valuePrefix={PREFIX}
            onScenarioChange={(_total, next) => setPositions(next)}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Headline is scenario EBIT. Bounds: volume ±12%, price ±5%, gross margin ±2pp, OpEx ±8%.
          </p>
        </VisualFrame>

        <VisualFrame title="EBIT bridge" hint="How each lever moves the bottom line" icon={Gauge}>
          <WaterfallChart
            steps={waterfallSteps}
            height={240}
            valuePrefix={PREFIX}
            onSelect={(s, i) => visualSelectionStore.select(bridgeSelection(s.label, s.value, base.ebit, plan.ebit, i))}
          />
          {dirty ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Scenario EBIT {formatCompact(plan.ebit, PREFIX)} · {formatSignedCompact(plan.ebit - base.ebit, PREFIX)} vs base.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">At base — move a lever to see the bridge fan out.</p>
          )}
        </VisualFrame>
      </div>

      {/* Sensitivity + scenario P&L */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VisualFrame title="Sensitivity" hint="EBIT swing at each lever's full range" icon={SlidersHorizontal}>
          <TornadoChart
            base={plan.ebit}
            drivers={tornadoDrivers}
            valuePrefix={PREFIX}
            onSelect={(d) => visualSelectionStore.select(sensitivitySelection(d.label, d.low, d.high, plan.ebit))}
          />
        </VisualFrame>

        <VisualFrame title="Scenario P&L" hint="Live full-year outlook under the current levers" icon={TrendingUp}>
          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-secondary">
                  <th className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Line</th>
                  <th className="px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Base</th>
                  <th className="px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Scenario</th>
                  <th className="px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Δ</th>
                </tr>
              </thead>
              <tbody>
                {miniRows.map((r) => {
                  const delta = r.value - r.base;
                  return (
                    <tr
                      key={r.label}
                      className={r.emphasis ? "border-t-2 border-border bg-secondary/30 font-semibold" : "border-t border-border/40"}
                    >
                      <td className="px-3 py-1.5 text-left text-foreground">{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{formatSignedCompact(r.base, PREFIX)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatSignedCompact(r.value, PREFIX)}</td>
                      <td
                        className="px-3 py-1.5 text-right tabular-nums"
                        style={{ color: Math.abs(delta) < 1 ? undefined : delta > 0 ? VARIANCE_COLOR.favorable : VARIANCE_COLOR.unfavorable }}
                      >
                        {Math.abs(delta) < 1 ? "—" : formatSignedCompact(delta, PREFIX)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Gross margin {formatSignedPercent(plan.grossMarginPct).replace("+", "")} · EBIT margin{" "}
            {formatSignedPercent(plan.ebitMarginPct).replace("+", "")}.
          </p>
        </VisualFrame>
      </div>
    </div>
  );
}

// ── Rail selection builders ───────────────────────────────────────────────────

function bridgeSelection(label: string, value: number, baseEbit: number, scenarioEbit: number, index: number): {
  visual: string;
  label: string;
  value?: string;
  insights: Insight[];
} {
  const isAnchor = index === 0 || label === "Scenario EBIT";
  const move = scenarioEbit - baseEbit;
  const share = move !== 0 ? value / move : 0;
  const insights: Insight[] = [
    {
      title: isAnchor ? label : `${label} effect`,
      metric: formatSignedCompact(value, PREFIX),
      tone: isAnchor ? "neutral" : value >= 0 ? "positive" : "watch",
      source: "EBIT bridge",
      confidence: 0.9,
      body: isAnchor
        ? `${label} is ${formatCompact(value, PREFIX)}.`
        : `The ${label.toLowerCase()} lever contributes ${formatSignedCompact(value, PREFIX)} to EBIT` +
          `${move !== 0 ? ` (${formatSignedPercent(share)} of the ${formatSignedCompact(move, PREFIX)} total move)` : ""}.`,
    },
  ];
  return { visual: "EBIT bridge", label, value: formatSignedCompact(value, PREFIX), insights };
}

function sensitivitySelection(label: string, low: number, high: number, baseEbit: number): {
  visual: string;
  label: string;
  value?: string;
  insights: Insight[];
} {
  const swing = high - low;
  const insights: Insight[] = [
    {
      title: `${label} sensitivity`,
      metric: formatSignedCompact(swing / 2, PREFIX),
      tone: "neutral",
      source: "Sensitivity",
      confidence: 0.85,
      body:
        `At its full range, ${label.toLowerCase()} swings EBIT between ${formatCompact(low, PREFIX)} and ` +
        `${formatCompact(high, PREFIX)} (± ${formatCompact(swing / 2, PREFIX)} around the ${formatCompact(baseEbit, PREFIX)} scenario centre).`,
    },
  ];
  return { visual: "Sensitivity", label, value: `± ${formatCompact(swing / 2, PREFIX)}`, insights };
}
