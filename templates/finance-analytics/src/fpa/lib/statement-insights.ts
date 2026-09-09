/**
 * Turns a selected statement datum (a P&L line, a scenario column, a PVM step or
 * product, a forecast point) into a rich `VisualSelection` for the shared
 * intelligence rail. Keeping this here means every FP&A visual drills into the
 * SAME rail the rest of the app uses — click a row and the right-hand drawer
 * explains the number, its variance drivers and its trend.
 */

import { formatCompact, formatSignedCompact, formatSignedPercent } from "@/finance";
import type { Insight, ExplainInput } from "@/finance";
import type { CompareKey, StatementLine } from "./statement-model";
import type { PvmResult, ProductDriver } from "./drivers";

export interface VisualSelectionPayload {
  visual: string;
  label: string;
  value?: string;
  insights: Insight[];
  explain?: ExplainInput;
}

const COMPARE_NOUN: Record<CompareKey, string> = { BU: "budget", FC: "forecast", PY: "prior year" };

function toneFor(favorable: boolean, material: boolean): Insight["tone"] {
  if (!material) return "neutral";
  return favorable ? "positive" : "watch";
}

/** Rich drill-down for one P&L line: variance vs each comparison + trend context. */
export function statementLineSelection(
  line: StatementLine,
  opts: { valuePrefix: string; periodLabel: string; compares: CompareKey[]; seriesLabels: string[] },
): VisualSelectionPayload {
  const { valuePrefix, periodLabel, compares, seriesLabels } = opts;
  const actual = line.actual ?? 0;
  const insights: Insight[] = [];

  for (const c of compares) {
    const v = line.variance[c];
    const base = line.compare[c];
    if (!v || base == null) continue;
    const favorable = v.favorability === "favorable";
    const material = v.favorability !== "neutral";
    insights.push({
      title: `${line.label} vs ${COMPARE_NOUN[c]}`,
      metric: formatSignedCompact(v.abs, valuePrefix),
      tone: toneFor(favorable, material),
      source: "Income statement",
      confidence: 0.9,
      body:
        `${line.label} of ${formatCompact(actual, valuePrefix)} came in ` +
        `${v.pct != null ? formatSignedPercent(v.pct) + " " : ""}` +
        `${favorable ? "ahead of" : "behind"} ${COMPARE_NOUN[c]} ` +
        `(${formatCompact(base, valuePrefix)}) for ${periodLabel}.`,
    });
  }

  const finite = line.trend.filter((v) => Number.isFinite(v));
  if (finite.length > 1) {
    const first = finite[0];
    const last = finite[finite.length - 1];
    const growth = first !== 0 ? (last - first) / Math.abs(first) : null;
    const rising = last >= first;
    insights.push({
      title: "In-period trend",
      metric: growth != null ? formatSignedPercent(growth) : `${finite.length} mo`,
      tone: "neutral",
      source: "Monthly actuals",
      confidence: 0.7,
      body:
        `Across ${finite.length} months in ${periodLabel}, ${line.label} ` +
        `${rising ? "climbed" : "eased"} from ${formatCompact(first, valuePrefix)} to ${formatCompact(last, valuePrefix)}.`,
    });
  }

  if (!insights.length) {
    insights.push({
      title: line.label,
      metric: formatCompact(actual, valuePrefix),
      tone: "neutral",
      source: "Income statement",
      confidence: 0.6,
      body: `${line.label} for ${periodLabel}. No comparison is currently selected for this line.`,
    });
  }

  const explain: ExplainInput = {
    label: line.label,
    value: actual,
    valuePrefix,
    budget: line.compare.BU ?? undefined,
    priorYear: line.compare.PY ?? undefined,
    series: { labels: seriesLabels, values: line.trend.map((v) => (Number.isFinite(v) ? v : null)) },
    // P&L lines read higher = better (costs are stored negative, so less-negative
    // is favourable too). The value is a window AGGREGATE over the monthly series,
    // so it is NOT a like-for-like point of that series → no percentile/anomaly.
    directionality: "higher-better",
    pointInSeries: false,
  };

  return {
    visual: "Income statement",
    label: line.label,
    value: formatCompact(actual, valuePrefix),
    insights,
    explain,
  };
}

/** Point-in-time drill-down for a balance-sheet row: neutral YoY movement, no
 * "ahead/behind" framing (raw balances aren't higher=better), sourced to the BS. */
export function balanceLineSelection(
  line: StatementLine,
  opts: { valuePrefix: string; asOfLabel: string; seriesLabels: string[] },
): VisualSelectionPayload {
  const { valuePrefix, asOfLabel, seriesLabels } = opts;
  const actual = line.actual ?? 0;
  const insights: Insight[] = [];

  const v = line.variance.PY;
  const base = line.compare.PY;
  if (v && base != null) {
    const rose = v.abs >= 0;
    insights.push({
      title: `${line.label} vs prior year`,
      metric: formatSignedCompact(v.abs, valuePrefix),
      tone: "neutral",
      source: "Balance sheet",
      confidence: 0.9,
      body:
        `${line.label} stands at ${formatCompact(actual, valuePrefix)} as of ${asOfLabel}, ` +
        `${rose ? "up" : "down"} ${formatSignedCompact(v.abs, valuePrefix)} ` +
        `${v.pct != null ? "(" + formatSignedPercent(v.pct) + ") " : ""}` +
        `from ${formatCompact(base, valuePrefix)} a year earlier.`,
    });
  }

  const finite = line.trend.filter((x) => Number.isFinite(x));
  if (finite.length > 1) {
    const first = finite[0];
    const last = finite[finite.length - 1];
    const rising = last >= first;
    insights.push({
      title: "Balance trend",
      metric: `${finite.length} mo`,
      tone: "neutral",
      source: "Balance sheet",
      confidence: 0.7,
      body:
        `Over ${finite.length} months the ${line.label.toLowerCase()} balance ` +
        `${rising ? "built" : "drew down"} from ${formatCompact(first, valuePrefix)} to ${formatCompact(last, valuePrefix)}.`,
    });
  }

  if (!insights.length) {
    insights.push({
      title: line.label,
      metric: formatCompact(actual, valuePrefix),
      tone: "neutral",
      source: "Balance sheet",
      confidence: 0.6,
      body: `${line.label} balance of ${formatCompact(actual, valuePrefix)} as of ${asOfLabel}.`,
    });
  }

  const explain: ExplainInput = {
    label: line.label,
    value: actual,
    valuePrefix,
    priorYear: line.compare.PY ?? undefined,
    series: { labels: seriesLabels, values: line.trend.map((x) => (Number.isFinite(x) ? x : null)) },
    // Raw balances aren't "higher = better"; keep the read-out neutral and never
    // frame a point-in-time balance as ahead/behind a plan.
    directionality: "neutral",
    pointInSeries: false,
  };

  return { visual: "Balance sheet", label: line.label, value: formatCompact(actual, valuePrefix), insights, explain };
}

/** Drill-down for a scenario column group (Actual vs Budget/Forecast/Prior year). */
export function scenarioGroupSelection(
  group: { label: string; values: Partial<Record<"AC" | "BU" | "FC" | "PY", number>> },
  valuePrefix: string,
): VisualSelectionPayload {
  const ac = group.values.AC ?? 0;
  const insights: Insight[] = [];
  (["BU", "FC", "PY"] as const).forEach((s) => {
    const cmp = group.values[s];
    if (cmp == null) return;
    const diff = ac - cmp;
    const pct = cmp !== 0 ? diff / Math.abs(cmp) : null;
    const favorable = diff >= 0;
    insights.push({
      title: `Actual vs ${COMPARE_NOUN[s]}`,
      metric: formatSignedCompact(diff, valuePrefix),
      tone: toneFor(favorable, Math.abs(diff) > 0.5),
      source: "Scenario comparison",
      confidence: 0.85,
      body:
        `${group.label} actual ${formatCompact(ac, valuePrefix)} is ` +
        `${pct != null ? formatSignedPercent(pct) + " " : ""}${favorable ? "above" : "below"} ` +
        `${COMPARE_NOUN[s]} (${formatCompact(cmp, valuePrefix)}).`,
    });
  });

  const explain: ExplainInput = {
    label: group.label,
    value: ac,
    valuePrefix,
    budget: group.values.BU,
    priorYear: group.values.PY,
    target: group.values.FC,
  };

  return { visual: "Scenario comparison", label: group.label, value: formatCompact(ac, valuePrefix), insights, explain };
}

/** Drill-down for a PVM waterfall step. */
export function pvmStepSelection(
  label: string,
  value: number,
  result: PvmResult,
  valuePrefix: string,
  baseLabel: string,
): VisualSelectionPayload {
  const delta = result.actual - result.base;
  const share = delta !== 0 ? value / delta : 0;
  const isEffect = label !== baseLabel && label !== "Actual";
  const favorable = value >= 0;
  const insights: Insight[] = [
    {
      title: isEffect ? `${label} effect` : label,
      metric: formatSignedCompact(value, valuePrefix),
      tone: isEffect ? toneFor(favorable, Math.abs(value) > 0.5) : "neutral",
      source: "Revenue bridge",
      confidence: 0.9,
      body: isEffect
        ? `The ${label.toLowerCase()} effect contributes ${formatSignedCompact(value, valuePrefix)} ` +
          `(${formatSignedPercent(share)} of the ${formatSignedCompact(delta, valuePrefix)} move vs ${baseLabel}).`
        : `${label} revenue is ${formatCompact(value, valuePrefix)}.`,
    },
  ];
  if (isEffect) {
    insights.push({
      title: "Bridge reconciliation",
      metric: formatSignedCompact(delta, valuePrefix),
      tone: "neutral",
      source: "Revenue bridge",
      confidence: 0.8,
      body:
        `Volume ${formatSignedCompact(result.volume, valuePrefix)} + Mix ${formatSignedCompact(result.mix, valuePrefix)} ` +
        `+ Price ${formatSignedCompact(result.price, valuePrefix)} reconciles exactly to the ${formatSignedCompact(delta, valuePrefix)} ` +
        `change from ${baseLabel} (${formatCompact(result.base, valuePrefix)}).`,
    });
  }
  return { visual: "Revenue bridge", label, value: formatSignedCompact(value, valuePrefix), insights };
}

/** Drill-down for a single product's contribution in the PVM bridge. */
export function driverSelection(driver: ProductDriver, result: PvmResult, valuePrefix: string): VisualSelectionPayload {
  const delta = result.actual - result.base;
  const share = delta !== 0 ? driver.delta / delta : 0;
  const favorable = driver.delta >= 0;
  return {
    visual: "Top movers",
    label: driver.product,
    value: formatSignedCompact(driver.delta, valuePrefix),
    insights: [
      {
        title: `${driver.product} revenue delta`,
        metric: formatSignedCompact(driver.delta, valuePrefix),
        tone: toneFor(favorable, Math.abs(driver.delta) > 0.5),
        source: "Top movers",
        confidence: 0.85,
        body:
          `${driver.product} moved revenue ${formatSignedCompact(driver.delta, valuePrefix)} ` +
          `(${formatSignedPercent(share)} of the net bridge).`,
      },
      {
        title: "Price / Volume / Mix split",
        metric: formatSignedCompact(driver.price + driver.volume + driver.mix, valuePrefix),
        tone: "neutral",
        source: "Top movers",
        confidence: 0.8,
        body:
          `Volume ${formatSignedCompact(driver.volume, valuePrefix)} · Mix ${formatSignedCompact(driver.mix, valuePrefix)} ` +
          `· Price ${formatSignedCompact(driver.price, valuePrefix)}.`,
      },
    ],
  };
}

/** Drill-down for a point on the rolling-forecast timeline. Clicking an ACTUALISED
 *  month opens the full deterministic panel: because the point genuinely belongs to
 *  the realised monthly series, it can be honestly ranked, trended and distribution-
 *  plotted against its own history (`pointInSeries: true`). Forecast (future) points
 *  can't be ranked against actuals, so they keep the qualitative WAPE/bias read-out. */
export function forecastPointSelection(
  label: string,
  index: number,
  data: { actual: (number | null)[]; forward: (number | null)[]; wape: number; bias: number; labels?: string[] },
  valuePrefix: string,
): VisualSelectionPayload {
  const rawActual = data.actual[index];
  const rawForward = data.forward[index];
  const available = rawActual != null || rawForward != null;

  // Neither actual nor forecast at this index → a genuine gap. Never fabricate a
  // zero (with a point-in-series ranking to match); say there's no data.
  if (!available) {
    return {
      visual: "Rolling forecast",
      label,
      value: "—",
      insights: [
        {
          title: `${label} · no data`,
          metric: "—",
          tone: "neutral",
          source: "Rolling forecast",
          body: `No actual or forecast value is available for ${label}.`,
        },
      ],
    };
  }

  const isForecast = rawActual == null && rawForward != null;
  const value = (isForecast ? rawForward : rawActual) ?? 0;
  const insights: Insight[] = [
    {
      title: isForecast ? `${label} · forecast` : `${label} · actual`,
      metric: formatCompact(value, valuePrefix),
      tone: "neutral",
      source: "Rolling forecast",
      body: isForecast
        ? `Forecast for ${label}. Confidence band width is sized from the forecast's own accuracy (WAPE ${formatSignedPercent(data.wape).replace("+", "")}).`
        : `Actualised value for ${label}.`,
    },
    {
      title: "Forecast quality",
      metric: formatSignedPercent(data.wape).replace("+", ""),
      tone: Math.abs(data.bias) > 0.02 ? "watch" : "positive",
      source: "Rolling forecast",
      body:
        `Weighted error (WAPE) is ${formatSignedPercent(data.wape).replace("+", "")} with ` +
        `${formatSignedPercent(data.bias)} bias (${data.bias >= 0 ? "running high" : "running low"}).`,
    },
  ];

  // A realised month IS the latest point of its own history AS OF that month, so
  // slice the series THROUGH the clicked index: the clicked value becomes the last
  // finite point and is ranked/plotted only against the periods that preceded it
  // (never against later actuals, which weren't known yet). Forecast (future) points
  // can't be ranked against actuals, so they keep the qualitative WAPE/bias read-out.
  const allLabels = data.labels ?? data.actual.map((_, i) => `#${i + 1}`);
  const explain: ExplainInput | undefined = isForecast
    ? undefined
    : {
        label: `${label} · actual`,
        value,
        valuePrefix,
        series: { labels: allLabels.slice(0, index + 1), values: data.actual.slice(0, index + 1) },
        pointInSeries: true,
        directionality: "higher-better",
      };

  return { visual: "Rolling forecast", label, value: formatCompact(value, valuePrefix), insights, explain };
}
