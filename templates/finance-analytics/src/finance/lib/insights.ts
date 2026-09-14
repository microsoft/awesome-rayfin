import type { DataTable } from "./types";
import { numericColumns, categoryColumns } from "./types";
import { formatCompact } from "./format";
import { concentration } from "./concentration";
import { visualSelectionStore } from "./visual-selection";
import type { ExplainInput } from "./insights-kernel";
import type { Insight } from "../features/intelligence-rail";

export interface InsightOptions {
  /** Category column key to group by. Defaults to the first non-numeric column. */
  category?: string;
  /** Measure column key to analyze. Defaults to the first numeric column. */
  measure?: string;
  /** Prefix for formatted values, e.g. "$". */
  valuePrefix?: string;
  /** Max number of insights to return. Default 3. */
  max?: number;
}

/**
 * Deterministically derive narrative, source-cited insights from a DataTable —
 * no LLM required, runs client-side on the live query result. This GENERIC
 * generator is intentionally schema-agnostic: it groups by one category column and
 * summarises how one measure is distributed across it (concentration + the long
 * tail), so it works for any standardized app. Each insight carries honest
 * `evidence` (never a fabricated confidence %), an inline micro-visual, and — for
 * the concentration insight — a click-through that opens a composition drill whose
 * parts sum to the total. Provide `config.insights` to override with a
 * schema-specific generator (see `overviewInsights`).
 */
export function generateInsights(table: DataTable, options: InsightOptions = {}): Insight[] {
  const max = options.max ?? 3;
  const prefix = options.valuePrefix ?? "";
  if (!table.rows.length) return [];

  const measureKey = options.measure ?? numericColumns(table)[0]?.key;
  if (!measureKey) return [];
  const categoryKey = options.category ?? categoryColumns(table)[0]?.key;
  if (!categoryKey) return [];

  const colLabel = (key: string) => table.columns.find((c) => c.key === key)?.label ?? key;
  const measureLabel = colLabel(measureKey);
  const categoryLabel = colLabel(categoryKey);
  const groups = (categoryLabel ?? "groups").toLowerCase();
  const fmt = (n: number) => formatCompact(n, prefix);

  const totals = new Map<string, number>();
  for (const r of table.rows) {
    const k = String(r[categoryKey] ?? "—");
    totals.set(k, (totals.get(k) ?? 0) + Number(r[measureKey] ?? 0));
  }
  const entries = [...totals.entries()].map(([label, value]) => ({ label, value }));
  const con = concentration(entries);
  if (!con) return [];
  // Only offer a composition drill when every group is a finite, positive part that
  // sums to the whole — otherwise "all groups" would silently exclude negatives.
  const rawTotal = entries.reduce((s, e) => s + e.value, 0);
  const fullyCovered = entries.every((e) => Number.isFinite(e.value) && e.value > 0) && Math.abs(rawTotal - con.total) < 1e-6;

  const src = `${measureLabel} by ${categoryLabel}`;
  const top = con.ranked[0];
  const topPct = Math.round(top.share * 100);
  const insights: Insight[] = [];

  // 1 — Concentration: how much of the measure the leader (and the vital few) hold.
  //     Neutral by default — concentration isn't inherently adverse — but a single
  //     group past half of the total is a defensible single-point-of-failure watch.
  const explain: ExplainInput = {
    label: `${measureLabel} · all ${groups}`,
    value: con.total,
    valuePrefix: prefix,
    directionality: "neutral",
    pointInSeries: false,
    children: con.ranked.map((r) => ({ label: r.label, value: r.value })),
  };
  insights.push({
    title: `${top.label} leads ${measureLabel}`,
    body:
      `${top.label} holds ${topPct}% of ${measureLabel} (${fmt(top.value)}); ` +
      `${con.vitalFew} of ${con.n} ${groups} make up 80%.`,
    tone: con.topShare >= 0.5 ? "watch" : "neutral",
    metric: `${topPct}%`,
    source: src,
    evidence: `HHI ${con.hhi.toFixed(2)} · even ${con.evenHhi.toFixed(2)} · ~${con.effectiveN.toFixed(1)} eff.`,
    visual: {
      kind: "share-bars",
      items: con.ranked.map((r) => ({ label: r.label, value: r.value })),
      valuePrefix: prefix,
      highlight: top.label,
    },
    action: fullyCovered
      ? {
          label: "Break down",
          onRun: () =>
            visualSelectionStore.select({
              visual: src,
              label: `${measureLabel} · all ${groups}`,
              value: fmt(con.total),
              insights: [],
              explain,
            }),
        }
      : undefined,
  });

  // 2 — The long tail: the smallest contributor, for a focus/rationalisation cue.
  if (con.n > 1) {
    const bottom = con.ranked[con.ranked.length - 1];
    insights.push({
      title: `${bottom.label} trails the field`,
      body: `${bottom.label} is the smallest of ${con.n} ${groups} at ${fmt(bottom.value)} (${Math.round(bottom.share * 100)}% of ${measureLabel}).`,
      tone: "neutral",
      metric: fmt(bottom.value),
      source: src,
      evidence: `${con.n} ${groups}`,
    });
  }

  return insights.slice(0, max);
}
