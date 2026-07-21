import { useMemo, useState } from "react";
import {
  TrendingUpDown, LineChart as LineIcon, BarChart3, GitCommitVertical, Workflow, Grid3x3, MousePointerClick,
  Target, Activity, Wind,
} from "lucide-react";
import type { DataTable, CellValue } from "../lib/types";
import { numericColumns, categoryColumns } from "../lib/types";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "../lib/format";
import { forecastAccuracy, confidenceBand } from "../lib/forecast";
import { VisualFrame } from "./visual-frame";
import { useVisualSelection } from "../lib/visual-selection";
import type { ExplainInput } from "../lib/insights-kernel";
import type { Insight } from "./intelligence-rail";
import { VarianceBar, type VarianceDatum } from "./variance-bar";
import { MultiLineChart, type LineSeries } from "./multi-line-chart";
import { StackedBar, type StackSeries } from "./stacked-bar";
import { WaterfallChart, type WaterfallStep } from "./waterfall-chart";
import { SankeyChart, type SankeyNode, type SankeyLink } from "./sankey-chart";
import { HeatmapChart } from "./heatmap-chart";
import { BulletChart, type BulletDatum } from "./bullet-chart";
import { ComboChart } from "./combo-chart";
import { TornadoChart, type TornadoDatum } from "./tornado-chart";
import { WhatIfPanel, type WhatIfDriver } from "./whatif-panel";

export interface VisualsGalleryProps {
  table: DataTable;
  valuePrefix?: string;
}

const num = (v: CellValue) => Number(v ?? 0) || 0;
const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

/** Deterministic ratio in ~[-0.18, 0.18] from a label, so demo variances are stable. */
function seedRatio(label: string, spread = 0.18): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0x7fffffff;
  return ((h % 1000) / 1000 - 0.5) * 2 * spread;
}

function detect(table: DataTable) {
  const cats = categoryColumns(table).map((c) => c.key);
  const nums = numericColumns(table).map((c) => c.key);
  const measure = nums.find((k) => /rev|amount|sales|value/i.test(k)) ?? nums[0];
  const catA = cats.find((k) => k === "segment") ?? cats[0];
  const catB = cats.find((k) => k === "region") ?? cats.find((k) => k !== catA);
  const catC = cats.find((k) => k === "channel") ?? cats.find((k) => k !== catA && k !== catB);
  return { measure, catA, catB, catC };
}

function sumBy(rows: DataTable["rows"], key: string, measure: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + num(r[measure]));
  return m;
}

/** Derive all six illustrative datasets from whatever table is supplied. */
function useGalleryData(table: DataTable) {
  return useMemo(() => {
    const { measure, catA, catB, catC } = detect(table);
    if (!measure || !catA) return null;
    const rows = table.rows;
    const total = rows.reduce((s, r) => s + num(r[measure]), 0);

    const aTotals = [...sumBy(rows, catA, measure).entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
    const variance: VarianceDatum[] = aTotals.map(([label, actual]) => ({
      label,
      actual,
      budget: actual / (1 + seedRatio(label)),
    }));

    // Actuals / Forecast / Budget — trailing actuals hand off to a forward forecast.
    const base = total / 12;
    const budgetSeries = MONTHS.map((_, i) => Math.round(base * (0.9 + 0.03 * i)));
    const actualsFull = MONTHS.map((mo, i) => Math.round(budgetSeries[i] * (1 + seedRatio(mo + i, 0.1))));
    const cut = 8; // Jul–Feb actual, Feb–Jun forecast (overlap one point at the handoff)
    const actualsSeries: (number | null)[] = actualsFull.map((v, i) => (i < cut ? v : null));
    const forecastSeries: (number | null)[] = MONTHS.map((_, i) =>
      i < cut - 1 ? null : i < cut ? actualsFull[i] : Math.round(budgetSeries[i] * (1.02 + seedRatio("f" + i, 0.03))),
    );
    // Forecast accuracy (backward-looking): how well the plan tracked actuals over
    // the realized months — WAPE/bias. That historical error then *sizes* the
    // forward confidence band around the forecast (further out = wider).
    const actualForAcc = actualsFull.map((v, i) => (i < cut ? v : null));
    const budgetForAcc = budgetSeries.map((v, i) => (i < cut ? v : null));
    const accuracy = forecastAccuracy(actualForAcc, budgetForAcc);
    const band = confidenceBand(forecastSeries, accuracy.wape);
    const lineSeries: LineSeries[] = [
      { name: "Actuals", values: actualsSeries, style: "solid", color: "var(--color-chart-1)", area: true },
      { name: "Forecast", values: forecastSeries, style: "dashed", color: "var(--color-chart-3)", band },
      { name: "Budget", values: budgetSeries, style: "dotted", color: "var(--color-chart-5)" },
    ];

    // Bullet: attainment vs target (reuse variance rows; target = budget).
    const bullet: BulletDatum[] = variance.map((v) => ({ label: v.label, actual: v.actual, target: v.budget }));

    // Combo: revenue bars + margin % line, by month.
    const comboBars = actualsFull;
    const comboLine = MONTHS.map((mo, i) => 0.27 + seedRatio("mgn" + mo + i, 0.05));

    // Tornado: sensitivity of total to swing in each driver, around the base case.
    const drv = (name: string, downPct: number, upPct: number): TornadoDatum => ({
      label: name,
      low: Math.round(total * (1 + downPct)),
      high: Math.round(total * (1 + upPct)),
    });
    const tornado: TornadoDatum[] = [
      drv("Volume", -0.085, 0.12),
      drv("Price / Mix", -0.05, 0.075),
      drv("FX", -0.065, 0.04),
      drv("Churn", -0.055, 0.02),
      drv("Discounts", -0.035, 0.03),
      drv("Cost inflation", -0.045, 0.015),
    ];
    // What-if drivers: the same swings expressed as signed fractions of base, so
    // sliders can live-recompute a scenario total that re-centres the tornado.
    const whatIfDrivers: WhatIfDriver[] = tornado.map((t) => ({
      label: t.label,
      down: (t.low - total) / (total || 1),
      up: (t.high - total) / (total || 1),
    }));

    // Stacked: catB categories × catC series (fallback to a single series).
    let stackedCats: string[] = [];
    let stackedSeries: StackSeries[] = [];
    if (catB && catC) {
      stackedCats = [...sumBy(rows, catB, measure).keys()];
      const cSeries = [...new Set(rows.map((r) => String(r[catC])))];
      stackedSeries = cSeries.map((cv) => ({
        name: cv,
        values: stackedCats.map((bv) => rows.filter((r) => String(r[catB]) === bv && String(r[catC]) === cv).reduce((s, r) => s + num(r[measure]), 0)),
      }));
    } else {
      stackedCats = aTotals.map(([l]) => l);
      stackedSeries = [{ name: measure, values: aTotals.map(([, v]) => v) }];
    }

    // Waterfall: budget → drivers → actual.
    const budgetTotal = total / 1.06;
    const gap = total - budgetTotal;
    const waterfall: WaterfallStep[] = [
      { label: "Budget", value: budgetTotal, kind: "start" },
      { label: "Volume", value: gap * 1.35, kind: "delta" },
      { label: "Price/Mix", value: gap * 0.75, kind: "delta" },
      { label: "FX", value: -gap * 0.6, kind: "delta" },
      { label: "Discounts", value: -gap * 0.5, kind: "delta" },
      { label: "Actual", value: total, kind: "total" },
    ];

    // Sankey: measure → catA → catB.
    const sankeyNodes: SankeyNode[] = [{ id: "__root", label: measure.replace(/^\w/, (c) => c.toUpperCase()), depth: 0 }];
    const sankeyLinks: SankeyLink[] = [];
    const topA = aTotals.map(([l]) => l);
    for (const a of topA) {
      sankeyNodes.push({ id: "a:" + a, label: a, depth: 1 });
      sankeyLinks.push({ source: "__root", target: "a:" + a, value: sumBy(rows, catA, measure).get(a) ?? 0 });
    }
    if (catB) {
      const bVals = [...sumBy(rows, catB, measure).keys()];
      for (const b of bVals) sankeyNodes.push({ id: "b:" + b, label: b, depth: 2 });
      for (const a of topA) {
        for (const b of bVals) {
          const v = rows.filter((r) => String(r[catA]) === a && String(r[catB]) === b).reduce((s, r) => s + num(r[measure]), 0);
          if (v > 0) sankeyLinks.push({ source: "a:" + a, target: "b:" + b, value: v });
        }
      }
    }

    // Heatmap: catA rows × catB cols.
    const hmRows = topA;
    const hmCols = catB ? [...sumBy(rows, catB, measure).keys()] : [measure];
    const hmValues = hmRows.map((a) =>
      hmCols.map((b) => rows.filter((r) => String(r[catA]) === a && (!catB || String(r[catB]) === b)).reduce((s, r) => s + num(r[measure]), 0)),
    );

    return {
      measure, catA, catB, total, variance, months: MONTHS, lineSeries, accuracy,
      bullet, comboBars, comboLine, tornado, whatIfDrivers,
      stackedCats, stackedSeries, waterfall, sankeyNodes, sankeyLinks, hmRows, hmCols, hmValues,
    };
  }, [table]);
}

export function VisualsGallery({ table, valuePrefix = "$" }: VisualsGalleryProps) {
  const d = useGalleryData(table);
  const { select } = useVisualSelection();
  const [scenario, setScenario] = useState<number | null>(null);

  if (!d) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Add at least one category and one numeric column to preview the visuals gallery.
      </div>
    );
  }

  const totalVariance = d.variance.reduce((s, v) => s + (v.actual - v.budget), 0);

  const drill = (visual: string, label: string, value: string, insights: Insight[], explainInput?: ExplainInput) =>
    select({ visual, label, value, insights, explain: explainInput });

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <MousePointerClick size={13} className="shrink-0 text-primary" aria-hidden="true" />
        Click any data point to drill it in the intelligence rail. Every visual is keyboard-navigable and ships as a standalone component.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <VisualFrame title="Variance to budget" hint="Favourable right (green) · unfavourable left (red)" icon={TrendingUpDown} delayMs={0}>
          <VarianceBar
            data={d.variance}
            valuePrefix={valuePrefix}
            rowHeight={38}
            onSelect={(datum) => {
              const v = datum.actual - datum.budget;
              const fav = v >= 0;
              const share = totalVariance ? Math.round((v / totalVariance) * 100) : 0;
              drill("Variance to budget", datum.label, formatSignedCompact(v, valuePrefix), [
                { title: `${datum.label} vs budget`, metric: formatSignedCompact(v, valuePrefix), tone: fav ? "positive" : "watch", source: "Variance to budget", confidence: 0.9,
                  body: `${datum.label} came in ${formatSignedPercent((datum.actual - datum.budget) / Math.abs(datum.budget))} ${fav ? "above" : "below"} plan — actual ${formatCompact(datum.actual, valuePrefix)} vs budget ${formatCompact(datum.budget, valuePrefix)}.` },
                { title: "Contribution to net variance", metric: `${share}%`, tone: "neutral", source: "Variance to budget", confidence: 0.75,
                  body: `This line accounts for ${share}% of the ${formatSignedCompact(totalVariance, valuePrefix)} net variance across the top categories.` },
              ], {
                label: datum.label,
                value: datum.actual,
                valuePrefix,
                budget: datum.budget,
                children: d.variance.map((r) => ({ label: r.label, value: r.actual })),
              });
            }}
          />
        </VisualFrame>

        <VisualFrame title="Revenue bridge" hint="How budget moves to actual" icon={GitCommitVertical} delayMs={80}>
          <WaterfallChart
            steps={d.waterfall}
            valuePrefix={valuePrefix}
            onSelect={(step) => {
              const isDelta = (step.kind ?? "delta") === "delta";
              drill("Revenue bridge", step.label, isDelta ? formatSignedCompact(step.value, valuePrefix) : formatCompact(step.value, valuePrefix), [
                { title: `${step.label} driver`, metric: isDelta ? formatSignedCompact(step.value, valuePrefix) : formatCompact(step.value, valuePrefix),
                  tone: isDelta ? (step.value >= 0 ? "positive" : "watch") : "neutral", source: "Revenue bridge", confidence: 0.8,
                  body: isDelta ? `${step.label} ${step.value >= 0 ? "added" : "removed"} ${formatCompact(Math.abs(step.value), valuePrefix)} on the path from budget to actual.` : `${step.label} anchors the bridge at ${formatCompact(step.value, valuePrefix)}.` },
              ]);
            }}
          />
        </VisualFrame>

        <VisualFrame className="lg:col-span-2" title="Actuals vs Forecast vs Budget" hint="Trailing actuals, forward forecast + confidence band, plan baseline" icon={LineIcon} delayMs={120}
          badge={
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              WAPE {(d.accuracy.wape * 100).toFixed(1)}% · bias {formatSignedPercent(d.accuracy.bias)}
            </span>
          }
        >
          <MultiLineChart
            labels={d.months}
            series={d.lineSeries}
            valuePrefix={valuePrefix}
            onSelect={(label, i) => {
              const a = d.lineSeries[0].values[i];
              const f = d.lineSeries[1].values[i];
              const b = (d.lineSeries[2].values[i] ?? 0) as number;
              const primary = (a ?? f ?? b) as number;
              const primaryName = a != null ? "Actuals" : "Forecast";
              const insights: Insight[] = [
                { title: `${label} vs budget`, metric: formatSignedCompact(primary - b, valuePrefix), tone: primary - b >= 0 ? "positive" : "watch", source: "Actuals vs plan", confidence: 0.85,
                  body: `${primaryName} ${formatCompact(primary, valuePrefix)} landed ${formatSignedPercent((primary - b) / Math.abs(b || 1))} vs budget ${formatCompact(b, valuePrefix)} in ${label}.` },
              ];
              if (f != null) {
                const lo = d.lineSeries[1].band?.lower[i];
                const hi = d.lineSeries[1].band?.upper[i];
                insights.push(
                  { title: `Forecast for ${label}`, metric: formatCompact(f, valuePrefix), tone: "neutral", source: "Actuals vs plan", confidence: Math.max(0.5, 1 - d.accuracy.wape),
                    body: lo != null && hi != null
                      ? `Forecast ${formatCompact(f, valuePrefix)} (${formatSignedPercent((f - b) / Math.abs(b || 1))} vs budget). ~80% confidence band ${formatCompact(lo, valuePrefix)}–${formatCompact(hi, valuePrefix)}, sized by historical WAPE of ${(d.accuracy.wape * 100).toFixed(1)}%.`
                      : `The current forecast for ${label} is ${formatCompact(f, valuePrefix)} (${formatSignedPercent((f - b) / Math.abs(b || 1))} vs budget).` },
                );
              }
              drill("Actuals vs plan", label, formatCompact(primary, valuePrefix), insights, {
                label,
                value: primary,
                valuePrefix,
                series: (() => {
                  const realized = d.lineSeries[0].values
                    .map((val, idx) => ({ val, m: d.months[idx] }))
                    .filter((x) => x.val != null);
                  return { labels: realized.map((x) => x.m), values: realized.map((x) => x.val as number) };
                })(),
                budget: b,
                target: b,
                priorYear: Math.round(primary / 1.06),
                periodsTotal: d.months.length,
              });
            }}
          />
        </VisualFrame>

        <VisualFrame title={`Composition${d.catB ? " by " + d.catB : ""}`} hint="Stacked mix per category" icon={BarChart3} delayMs={160}>
          <StackedBar
            categories={d.stackedCats}
            series={d.stackedSeries}
            valuePrefix={valuePrefix}
            onSelect={(cat, i) => {
              const total = d.stackedSeries.reduce((s, se) => s + (se.values[i] ?? 0), 0);
              const top = [...d.stackedSeries].sort((x, y) => (y.values[i] ?? 0) - (x.values[i] ?? 0))[0];
              drill("Composition", cat, formatCompact(total, valuePrefix), [
                { title: `${cat} total`, metric: formatCompact(total, valuePrefix), tone: "neutral", source: "Composition", confidence: 0.8,
                  body: `${cat} totals ${formatCompact(total, valuePrefix)} across ${d.stackedSeries.length} components.` },
                top ? { title: `Largest component`, metric: top.name, tone: "positive", source: "Composition", confidence: 0.75,
                  body: `${top.name} is the biggest slice of ${cat} at ${formatCompact(top.values[i] ?? 0, valuePrefix)} (${total ? Math.round(((top.values[i] ?? 0) / total) * 100) : 0}%).` } : null,
              ].filter(Boolean) as Insight[]);
            }}
          />
        </VisualFrame>

        <VisualFrame title={`${d.catA} × ${d.catB ?? "measure"} heatmap`} hint="Intensity by cell — spot concentration" icon={Grid3x3} delayMs={200}>
          <HeatmapChart
            rows={d.hmRows}
            cols={d.hmCols}
            values={d.hmValues}
            valuePrefix={valuePrefix}
            showValues
            onSelect={({ row, col, value, rowIndex }) => {
              const rowTotal = d.hmValues[rowIndex].reduce((s, v) => s + v, 0);
              drill("Heatmap", `${row} · ${col}`, formatCompact(value, valuePrefix), [
                { title: `${row} · ${col}`, metric: formatCompact(value, valuePrefix), tone: "neutral", source: "Heatmap", confidence: 0.8,
                  body: `${col} makes up ${rowTotal ? Math.round((value / rowTotal) * 100) : 0}% of ${row}'s ${formatCompact(rowTotal, valuePrefix)} total.` },
              ]);
            }}
          />
        </VisualFrame>

        <VisualFrame className="lg:col-span-2" title={`Flow: ${d.measure} → ${d.catA}${d.catB ? " → " + d.catB : ""}`} hint="Proportional flow across dimensions" icon={Workflow} delayMs={240}>
          <SankeyChart
            nodes={d.sankeyNodes}
            links={d.sankeyLinks}
            valuePrefix={valuePrefix}
            onSelect={(node, throughput) => {
              const share = d.total ? Math.round((throughput / d.total) * 100) : 0;
              drill("Flow", node.label, formatCompact(throughput, valuePrefix), [
                { title: `${node.label} throughput`, metric: formatCompact(throughput, valuePrefix), tone: "neutral", source: "Flow", confidence: 0.8,
                  body: `${node.label} carries ${formatCompact(throughput, valuePrefix)} of flow — about ${share}% of the ${formatCompact(d.total, valuePrefix)} total.` },
              ]);
            }}
          />
        </VisualFrame>

        <VisualFrame title="Attainment vs target" hint="Actual bar · target marker · % of plan" icon={Target} delayMs={280}>
          <BulletChart
            data={d.bullet}
            valuePrefix={valuePrefix}
            onSelect={(datum) => {
              const pct = datum.target ? datum.actual / datum.target : 0;
              const hit = pct >= 1;
              drill("Attainment vs target", datum.label, `${Math.round(pct * 100)}%`, [
                { title: `${datum.label} attainment`, metric: `${Math.round(pct * 100)}%`, tone: hit ? "positive" : pct >= 0.9 ? "neutral" : "watch", source: "Attainment vs target", confidence: 0.9,
                  body: `${datum.label} reached ${formatCompact(datum.actual, valuePrefix)} of a ${formatCompact(datum.target, valuePrefix)} target — ${Math.round(pct * 100)}% (${formatSignedPercent(pct - 1)} vs plan).` },
              ]);
            }}
          />
        </VisualFrame>

        <VisualFrame title="Revenue vs Margin %" hint="Bars (left) revenue · line (right) margin %" icon={Activity} delayMs={320}>
          <ComboChart
            labels={d.months}
            bar={{ name: "Revenue", values: d.comboBars }}
            line={{ name: "Margin %", values: d.comboLine }}
            linePercent
            valuePrefix={valuePrefix}
            onSelect={(label, i) => {
              const rev = d.comboBars[i];
              const mgn = d.comboLine[i];
              drill("Revenue vs Margin %", label, formatCompact(rev, valuePrefix), [
                { title: `${label} revenue`, metric: formatCompact(rev, valuePrefix), tone: "neutral", source: "Revenue vs Margin %", confidence: 0.85,
                  body: `Revenue in ${label} was ${formatCompact(rev, valuePrefix)} at a ${(mgn * 100).toFixed(1)}% margin.` },
                { title: `${label} margin`, metric: `${(mgn * 100).toFixed(1)}%`, tone: mgn >= 0.27 ? "positive" : "watch", source: "Revenue vs Margin %", confidence: 0.75,
                  body: `A ${(mgn * 100).toFixed(1)}% margin ${mgn >= 0.27 ? "is above" : "trails"} the ~27% reference for the period.` },
              ]);
            }}
          />
        </VisualFrame>

        <VisualFrame className="lg:col-span-2" title="Driver sensitivity" hint="Swing in outcome as each driver moves low → high" icon={Wind} delayMs={360}>
          <div className="flex flex-col gap-3">
            <WhatIfPanel
              base={d.total}
              drivers={d.whatIfDrivers}
              valuePrefix={valuePrefix}
              onScenarioChange={(t) => setScenario(t === d.total ? null : t)}
            />
            <TornadoChart
              base={scenario ?? d.total}
              drivers={
                scenario == null
                  ? d.tornado
                  : d.tornado.map((t) => ({ ...t, low: t.low + (scenario - d.total), high: t.high + (scenario - d.total) }))
              }
              valuePrefix={valuePrefix}
              onSelect={(datum) => {
                const base = scenario ?? d.total;
                const down = datum.low - base;
                const up = datum.high - base;
                const sw = Math.abs(datum.high - datum.low);
                drill("Driver sensitivity", datum.label, formatCompact(sw, valuePrefix), [
                  { title: `${datum.label} swing`, metric: formatCompact(sw, valuePrefix), tone: "neutral", source: "Driver sensitivity", confidence: 0.8,
                    body: `Moving ${datum.label} low → high swings the outcome by ${formatCompact(sw, valuePrefix)} — downside ${formatSignedCompact(down, valuePrefix)}, upside ${formatSignedCompact(up, valuePrefix)} vs the ${formatCompact(base, valuePrefix)} ${scenario ? "scenario" : "base"}.` },
                ]);
              }}
            />
          </div>
        </VisualFrame>
      </div>
    </div>
  );
}
