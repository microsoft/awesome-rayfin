/**
 * Insights kernel — a small library of cheap, pure, deterministic algorithms that
 * turn a clicked number (plus its series / plan / children) into a structured
 * "explain this number" read-out. Zero dependencies, O(n) or O(n·k), same input →
 * same output (so every fact is testable and citable). The rail renders the facts;
 * these functions never touch the DOM.
 *
 * Kept out of the eager bundle (imported only by the lazily-loaded ExplainPanel) so
 * it never counts against the initial-JS budget.
 */

export type FactTone = "positive" | "watch" | "neutral";

/** How to read "good" for this metric. Drives favorable/status coloring honestly. */
export type Directionality = "higher-better" | "lower-better" | "neutral";

export interface ExplainFact {
  label: string;
  value: string;
  tone?: FactTone;
  /** Optional secondary detail shown under the fact. */
  hint?: string;
}

export interface ExplainSection {
  id: string;
  title: string;
  /** One-sentence plain-language summary (also used as the SR description). */
  summary: string;
  facts: ExplainFact[];
  defaultOpen?: boolean;
}

export interface ExplainInput {
  /** Human label of the clicked datum, e.g. "March" or "EMEA". */
  label: string;
  /** The clicked number itself. */
  value: number;
  valuePrefix?: string;
  /** Historical series ending at (and including) the clicked point, for trend/anomaly. */
  series?: { labels: string[]; values: (number | null)[] };
  /** Plan / budget comparable for the clicked point. */
  budget?: number;
  /** Prior-year comparable for the clicked point. */
  priorYear?: number;
  /** Goal for pace-to-goal (defaults to `budget`). */
  target?: number;
  /** Cost-style account where a decrease is favorable. @deprecated prefer `directionality`. */
  invert?: boolean;
  /** How to read "good" for this metric. If omitted, derived from `invert` (else neutral). */
  directionality?: Directionality;
  /**
   * True only when `value` IS the latest point of `series` (like-for-like), so
   * percentile-vs-history and the anomaly gauge are meaningful. Aggregates whose
   * `series` is a finer grain (e.g. a YTD total over monthly points) must leave
   * this false so we never rank an aggregate against its own components.
   */
  pointInSeries?: boolean;
  /** Parts that sum to this number, for composition + concentration. */
  children?: { label: string; value: number }[];
  /** Total periods in the plan horizon, for run-rate (e.g. 12 for a fiscal year). */
  periodsTotal?: number;
}

/** Resolve the effective directionality. Explicit wins; then `invert` (→ lower-better);
 *  otherwise defaults to higher-better (the common revenue/profit case). Pass
 *  `directionality: "neutral"` for balances that aren't inherently good or bad. */
export function resolveDirection(input: { directionality?: Directionality; invert?: boolean }): Directionality {
  if (input.directionality) return input.directionality;
  if (input.invert) return "lower-better";
  return "higher-better";
}

// ---- numeric helpers -------------------------------------------------------

const clean = (vals: (number | null | undefined)[]): number[] =>
  vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- algorithms ------------------------------------------------------------

/** Period-over-period and (if ≥13 points) year-over-year absolute + relative change. */
export function growthDeltas(values: number[]) {
  const n = values.length;
  if (n < 2) return null;
  const last = values[n - 1];
  const prev = values[n - 2];
  const pop = { abs: last - prev, pct: prev !== 0 ? (last - prev) / Math.abs(prev) : 0 };
  const yoy =
    n >= 13
      ? { abs: last - values[n - 13], pct: values[n - 13] !== 0 ? (last - values[n - 13]) / Math.abs(values[n - 13]) : 0 }
      : null;
  return { pop, yoy };
}

/** Least-squares slope + R² over the index; direction word describes the fit. */
export function trendStrength(values: number[]) {
  const n = values.length;
  if (n < 3) return null;
  const xs = values.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = values[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  const dir = slope > 0 ? "rising" : slope < 0 ? "falling" : "flat";
  const strength = r2 >= 0.7 ? "steady" : r2 >= 0.35 ? "choppy" : "noisy";
  return { slope, r2, dir, strength };
}

/** Current consecutive up/down streak (by sign of successive deltas) + record flags. */
export function streaks(values: number[]) {
  const n = values.length;
  if (n < 2) return null;
  const lastDelta = Math.sign(values[n - 1] - values[n - 2]);
  let run = 0;
  if (lastDelta !== 0) {
    for (let i = n - 1; i > 0; i--) {
      if (Math.sign(values[i] - values[i - 1]) === lastDelta) run++;
      else break;
    }
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const last = values[n - 1];
  return {
    run,
    direction: lastDelta > 0 ? "up" : lastDelta < 0 ? "down" : "flat",
    isHigh: last === max,
    isLow: last === min,
    window: n,
  };
}

/** Robust z-score of the last point using median + MAD (outlier-resistant). */
export function robustAnomaly(values: number[]) {
  const n = values.length;
  if (n < 4) return null;
  const m = median(values);
  const rawMad = median(values.map((v) => Math.abs(v - m)));
  const degenerate = rawMad === 0;
  const scale = rawMad * 1.4826 || 1e-9; // robust σ-equivalent; guarded for MAD=0
  const last = values[n - 1];
  const z = (last - m) / scale;
  return { z, flagged: !degenerate && Math.abs(z) >= 3.5, median: m, scale, rawMad, degenerate };
}

/** CUSUM level-shift detector — returns the index (and side) of the largest mean shift. */
export function levelShift(values: number[]) {
  const n = values.length;
  if (n < 6) return null;
  const mu = mean(values);
  const sd = Math.sqrt(mean(values.map((v) => (v - mu) ** 2))) || 1e-9;
  let cum = 0;
  let maxAbs = 0;
  let at = -1;
  for (let i = 0; i < n; i++) {
    cum += (values[i] - mu) / sd;
    if (Math.abs(cum) > maxAbs) {
      maxAbs = Math.abs(cum);
      at = i;
    }
  }
  // Only report a shift with meaningful sustained deviation.
  if (maxAbs < 3 || at < 1 || at >= n - 1) return null;
  const before = mean(values.slice(0, at + 1));
  const after = mean(values.slice(at + 1));
  return { index: at, before, after, rose: after > before };
}

/** Fraction of the series at or below `value` (0..1). */
export function percentileRank(values: number[], value: number) {
  if (!values.length) return 0;
  return values.filter((v) => v <= value).length / values.length;
}

/** Honest "rank vs its own history" for a point that IS the latest of a series.
 *  Ranks `value` against the PRIOR points only (mid-rank tie handling), gated to a
 *  minimum prior sample so a couple of points can't manufacture a percentile. Returns
 *  the percentile (0..100), the prior sample size, and the prior values so the header
 *  dial, the snapshot text, and the distribution strip all read from ONE computation
 *  and can never disagree. */
export function historyRank(
  hist: number[],
  value: number,
  minPrior = 5,
): { pct: number; sample: number; prior: number[] } | null {
  const prior = hist.slice(0, -1);
  if (prior.length < minPrior) return null;
  const less = prior.filter((v) => v < value).length;
  const equal = prior.filter((v) => v === value).length;
  return { pct: ((less + 0.5 * equal) / prior.length) * 100, sample: prior.length, prior };
}

/** Rank parts by share of the whole; flag the "vital few" that reach 80% (Pareto). */
export function contribution(children: { label: string; value: number }[]) {
  const total = sum(children.map((c) => c.value));
  if (total <= 0) return null;
  const ranked = [...children].sort((a, b) => b.value - a.value).map((c) => ({ ...c, share: c.value / total }));
  let cum = 0;
  let vitalFew = 0;
  for (const c of ranked) {
    cum += c.share;
    vitalFew++;
    if (cum >= 0.8) break;
  }
  // Herfindahl concentration (0..1): higher = more concentrated.
  const hhi = ranked.reduce((s, c) => s + c.share * c.share, 0);
  return { ranked, total, vitalFew, concentration: hhi };
}

/** Sign-aware variance vs a plan; favorable/unfavorable respects cost inversion. */
export function variance(actual: number, plan: number, invert = false) {
  const abs = actual - plan;
  const pct = plan !== 0 ? abs / Math.abs(plan) : 0;
  const favorable = invert ? abs < 0 : abs > 0;
  return { abs, pct, favorable };
}

/** Linear pace-to-goal: extrapolate the elapsed run-rate to the full horizon. */
export function paceToGoal(elapsedTotal: number, periodsElapsed: number, periodsTotal: number, goal: number) {
  if (periodsElapsed <= 0 || periodsTotal <= 0) return null;
  const projected = (elapsedTotal / periodsElapsed) * periodsTotal;
  const attainment = goal !== 0 ? projected / goal : 0;
  const gap = goal - projected;
  const remaining = periodsTotal - periodsElapsed;
  const perPeriodToClose = remaining > 0 ? gap / remaining : 0;
  return { projected, attainment, gap, perPeriodToClose, remaining };
}

// ---- orchestration ---------------------------------------------------------

const pctStr = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/**
 * Compose the available algorithms into rail-ready sections for the clicked datum.
 * Only sections with enough input are emitted, so a bare KPI and a rich time series
 * both produce sensible output.
 */
export function explain(input: ExplainInput, fmt: (v: number) => string): ExplainSection[] {
  const sections: ExplainSection[] = [];
  const series = input.series ? clean(input.series.values) : [];
  const hist = series.length >= 3 ? series : [];
  const signed = (v: number) => `${v >= 0 ? "+" : "-"}${fmt(Math.abs(v)).replace(/^-/, "")}`;

  // Directionality drives whether a move reads as good/bad. Neutral metrics (e.g.
  // raw balance-sheet balances) never get favorable/unfavorable colouring.
  const dir = resolveDirection(input);
  const neutral = dir === "neutral";
  const invert = dir === "lower-better";
  const moveTone = (delta: number): FactTone => (neutral ? "neutral" : (invert ? delta < 0 : delta >= 0) ? "positive" : "watch");

  // Snapshot -----------------------------------------------------------------
  // ONE percentile source (historyRank) shared with the scorecard dial + panel
  // distribution, so the three can never disagree. Prior-only, mid-rank, ≥6 pts.
  const hr = input.pointInSeries ? historyRank(hist, input.value) : null;
  const snap: ExplainFact[] = [{ label: input.label, value: fmt(input.value), tone: "neutral" }];
  if (hr) {
    snap.push({
      label: "Percentile vs history",
      value: `${Math.round(hr.pct)}th`,
      tone: hr.pct >= 80 ? "positive" : hr.pct <= 20 ? "watch" : "neutral",
      hint: `Across the ${hr.sample} prior periods`,
    });
  }
  sections.push({
    id: "snapshot",
    title: "Snapshot",
    summary: hr
      ? `${input.label} is ${fmt(input.value)}, in the ${Math.round(hr.pct)}th percentile of its ${hr.sample} prior periods.`
      : `${input.label} is ${fmt(input.value)}.`,
    facts: snap,
    defaultOpen: true,
  });

  // Trend --------------------------------------------------------------------
  if (hist.length >= 2) {
    const g = growthDeltas(hist);
    const t = trendStrength(hist);
    const s = streaks(hist);
    const facts: ExplainFact[] = [];
    if (g) {
      facts.push({ label: "Period over period", value: `${signed(g.pop.abs)} (${pctStr(g.pop.pct)})`, tone: moveTone(g.pop.abs) });
      if (g.yoy) facts.push({ label: "Year over year", value: `${signed(g.yoy.abs)} (${pctStr(g.yoy.pct)})`, tone: moveTone(g.yoy.abs) });
    }
    if (t) facts.push({ label: "Trend", value: `${t.dir} · ${t.strength}`, tone: "neutral", hint: `R² ${t.r2.toFixed(2)}` });
    if (s && s.run >= 2) facts.push({ label: "Streak", value: `${s.run} ${s.direction} in a row`, tone: moveTone(s.direction === "up" ? 1 : -1) });
    if (s && (s.isHigh || s.isLow)) facts.push({ label: s.isHigh ? "Record high" : "Record low", value: `${s.window}-period ${s.isHigh ? "high" : "low"}`, tone: moveTone(s.isHigh ? 1 : -1) });
    const t2 = trendStrength(hist);
    sections.push({
      id: "trend",
      title: "Trend",
      summary: g
        ? `Moved ${pctStr(g.pop.pct)} on the prior period${t2 ? `, ${t2.dir} and ${t2.strength} overall` : ""}.`
        : "Not enough history to trend.",
      facts,
      defaultOpen: true,
    });
  }

  // Vs plan ------------------------------------------------------------------
  const vsFacts: ExplainFact[] = [];
  if (typeof input.budget === "number") {
    const v = variance(input.value, input.budget, invert);
    vsFacts.push({
      label: "vs Budget",
      value: `${signed(v.abs)} (${pctStr(v.pct)})`,
      tone: neutral ? "neutral" : v.favorable ? "positive" : "watch",
      hint: neutral ? undefined : v.favorable ? "Favorable" : "Unfavorable",
    });
    if (!neutral) vsFacts.push({ label: "Attainment", value: `${Math.round((input.value / (input.budget || 1)) * 100)}%`, tone: input.value >= input.budget ? "positive" : "watch" });
  }
  if (typeof input.priorYear === "number") {
    const v = variance(input.value, input.priorYear, invert);
    vsFacts.push({ label: "vs Prior year", value: `${signed(v.abs)} (${pctStr(v.pct)})`, tone: neutral ? "neutral" : v.favorable ? "positive" : "watch" });
  }
  if (input.series && typeof (input.target ?? input.budget) === "number" && input.periodsTotal) {
    const elapsed = series;
    const pace = paceToGoal(sum(elapsed), elapsed.length, input.periodsTotal, (input.target ?? input.budget)! * input.periodsTotal);
    if (pace) {
      vsFacts.push({
        label: "Pace to goal",
        value: `${Math.round(pace.attainment * 100)}% of plan`,
        tone: neutral ? "neutral" : pace.attainment >= 1 ? "positive" : "watch",
        hint: pace.gap > 0 ? `Need ${fmt(pace.perPeriodToClose)}/period to close the gap` : "On pace to beat plan",
      });
    }
  }
  if (vsFacts.length) {
    const b = input.budget;
    sections.push({
      id: "vs-plan",
      title: "Vs plan",
      summary:
        typeof b === "number" && !neutral
          ? `${variance(input.value, b, invert).favorable ? "Favorable" : "Unfavorable"} to budget by ${pctStr(variance(input.value, b, invert).pct)}.`
          : "Compared against available baselines.",
      facts: vsFacts,
      defaultOpen: true,
    });
  }

  // Anomalies ----------------------------------------------------------------
  if (hist.length >= 6 && input.pointInSeries) {
    const a = robustAnomaly(hist);
    const shift = levelShift(hist);
    const facts: ExplainFact[] = [];
    if (a) facts.push({ label: "Robust z-score", value: a.z.toFixed(1), tone: a.flagged ? "watch" : "positive", hint: a.flagged ? "Outlier vs history (median + MAD)" : "Within normal range" });
    if (shift) facts.push({ label: "Level shift", value: `${shift.rose ? "step up" : "step down"} @ ${input.series!.labels[shift.index] ?? `#${shift.index + 1}`}`, tone: "watch", hint: `Mean ${fmt(shift.before)} → ${fmt(shift.after)}` });
    if (!facts.length) facts.push({ label: "Status", value: "No anomalies", tone: "positive" });
    sections.push({
      id: "anomalies",
      title: "Anomalies",
      summary: a?.flagged ? "This point reads as an outlier versus its own history." : shift ? "A sustained level shift was detected earlier in the series." : "Nothing unusual detected.",
      facts,
    });
  }

  // Composition --------------------------------------------------------------
  if (input.children && input.children.length > 1) {
    const c = contribution(input.children);
    if (c) {
      const top: ExplainFact[] = c.ranked.slice(0, 3).map((r) => ({ label: r.label, value: `${fmt(r.value)} · ${Math.round(r.share * 100)}%`, tone: "neutral" as FactTone }));
      // Honest concentration: the effective number of equally-sized parts (1/HHI)
      // shown against the even-split baseline — never a bare "High/Moderate" adjective
      // that would mislabel a near-even mix (even 2-way HHI is already 0.50).
      const effN = c.concentration > 0 ? 1 / c.concentration : c.ranked.length;
      top.push({
        label: "Effective parts",
        value: `~${effN.toFixed(1)} of ${c.ranked.length}`,
        tone: c.ranked[0].share >= 0.5 ? "watch" : "neutral",
        hint: `Even split ≈ ${c.ranked.length}`,
      });
      sections.push({
        id: "composition",
        title: "Composition",
        summary: `${c.vitalFew} of ${c.ranked.length} parts drive 80% of the total; ${c.ranked[0].label} leads at ${Math.round(c.ranked[0].share * 100)}%.`,
        facts: top,
      });
    }
  }

  return sections;
}

/** Deterministic one-paragraph narrative stitched from the computed sections. */
export function narrate(sections: ExplainSection[]): string {
  return sections.map((s) => s.summary).filter(Boolean).join(" ");
}

/** A compact, honest header signal for the drill panel. */
export interface Scorecard {
  /** A dial metric — present ONLY when a like-for-like reading exists. */
  metric:
    | { kind: "budget-attainment"; pct: number; label: string }
    | { kind: "history-rank"; pct: number; label: string; sample: number }
    | { kind: "none" };
  status: string;
  statusTone: FactTone;
  /** e.g. "rising · strong (R² 0.82)" — null when there isn't enough series. */
  trendLabel: string | null;
  direction: Directionality;
}

/**
 * Reduce an ExplainInput to a small set of honest header signals: one optional
 * dial metric, a conservative status chip, and a trend label. Never invents a
 * plan; never ranks an aggregate against its own components (gated on
 * `pointInSeries`); stays neutral for balance-sheet style metrics.
 */
export function scorecard(input: ExplainInput): Scorecard {
  const dir = resolveDirection(input);
  const series = input.series ? input.series.values.filter((v): v is number => v != null && Number.isFinite(v)) : [];
  const hist = series.length >= 3 ? series : [];
  const t = hist.length >= 3 ? trendStrength(hist) : null;
  const anomaly = input.pointInSeries && hist.length >= 6 ? robustAnomaly(hist) : null;

  const hasBudget = typeof input.budget === "number" && Number.isFinite(input.budget) && input.budget !== 0;

  // Dial metric — only when the reading is genuinely like-for-like.
  let metric: Scorecard["metric"] = { kind: "none" };
  if (hasBudget && dir === "higher-better" && (input.budget as number) > 0) {
    const pct = (input.value / (input.budget as number)) * 100;
    if (Number.isFinite(pct)) metric = { kind: "budget-attainment", pct, label: "Attainment vs budget" };
  } else if (input.pointInSeries && hist.length >= 6) {
    const hr = historyRank(hist, input.value);
    if (hr) metric = { kind: "history-rank", pct: hr.pct, label: `Rank vs ${hr.sample} prior periods`, sample: hr.sample };
  }

  // Status — conservative, evidence-gated, directionality-aware.
  const favorableVsBudget =
    hasBudget && dir !== "neutral" ? variance(input.value, input.budget as number, dir === "lower-better").favorable : null;
  const budgetGap = hasBudget ? Math.abs((input.value - (input.budget as number)) / (input.budget as number)) : 0;

  let status = "Limited context";
  let statusTone: FactTone = "neutral";
  if (anomaly?.flagged) {
    status = "Outlier";
    statusTone = "watch";
  } else if (favorableVsBudget === true && budgetGap >= 0.02) {
    status = "Ahead of plan";
    statusTone = "positive";
  } else if (favorableVsBudget === false && budgetGap >= 0.02) {
    status = "Behind plan";
    statusTone = "watch";
  } else if (favorableVsBudget !== null) {
    status = "On plan";
    statusTone = "neutral";
  } else if (t && t.dir !== "flat") {
    if (dir === "higher-better") {
      status = t.dir === "rising" ? "Improving" : "Deteriorating";
      statusTone = t.dir === "rising" ? "positive" : "watch";
    } else if (dir === "lower-better") {
      status = t.dir === "rising" ? "Deteriorating" : "Improving";
      statusTone = t.dir === "rising" ? "watch" : "positive";
    } else {
      status = t.dir === "rising" ? "Rising" : "Falling";
      statusTone = "neutral";
    }
  }

  const trendLabel = t ? `${t.dir} · ${t.strength} (R² ${t.r2.toFixed(2)})` : null;
  return { metric, status, statusTone, trendLabel, direction: dir };
}