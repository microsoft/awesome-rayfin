import type { DataTable } from "./types";
import { formatCompact } from "./format";
import { concentration } from "./concentration";
import { visualSelectionStore } from "./visual-selection";
import type { ExplainInput } from "./insights-kernel";
import type { Insight } from "../features/intelligence-rail";

/**
 * Overview-specific intelligence for the sample FinanceModel (segment × region ×
 * channel × tier, with revenue / units / margin measures). Wired via
 * `config.insights` so schema-specific logic never leaks into the generic
 * `generateInsights` fallback. Every insight is built from ONE structured analysis
 * so the narrative, evidence chip, inline visual and drill can't drift apart, and
 * every claim is honest:
 *   - Concentration uses the raw Herfindahl index ALWAYS shown next to its
 *     equal-share baseline (1/n) and effective group count (1/HHI) — never labelled
 *     "concentrated" for a near-even mix. Tone stays neutral unless one group passes
 *     half the total (a defensible single-point-of-failure watch).
 *   - Margin is a ratio, so it is aggregated as REVENUE-WEIGHTED margin
 *     (Σ marginᵢ·revᵢ / Σ revᵢ) and shown against the portfolio-weighted average.
 *     Revenue weight travels with every margin claim so a tiny segment's big pp swing
 *     can't masquerade as material. It is NOT a composition drill (margins don't sum).
 *   - Composition drills (`children`) always select the PORTFOLIO total with parts
 *     that sum to it, tagged `directionality:"neutral"`, `pointInSeries:false`.
 */
export function overviewInsights(table: DataTable): Insight[] {
  const has = (key: string) => table.columns.some((c) => c.key === key);
  const rows = table.rows;
  if (!rows.length) return [];

  const prefix = "$";
  const fmt = (n: number) => formatCompact(n, prefix);
  const insights: Insight[] = [];

  // 1 — Revenue concentration by segment. -----------------------------------
  if (has("segment") && has("revenue")) {
    const bySeg = new Map<string, number>();
    for (const r of rows) bySeg.set(String(r.segment), (bySeg.get(String(r.segment)) ?? 0) + Number(r.revenue ?? 0));
    const entries = [...bySeg.entries()].map(([label, value]) => ({ label, value }));
    const con = concentration(entries);
    if (con) {
      const rawTotal = entries.reduce((s, e) => s + e.value, 0);
      const fullyCovered = entries.every((e) => Number.isFinite(e.value) && e.value > 0) && Math.abs(rawTotal - con.total) < 1e-6;
      const top = con.ranked[0];
      const topPct = Math.round(top.share * 100);
      const explain: ExplainInput = {
        label: "Portfolio revenue · all segments",
        value: con.total,
        valuePrefix: prefix,
        directionality: "neutral",
        pointInSeries: false,
        children: con.ranked.map((r) => ({ label: r.label, value: r.value })),
      };
      insights.push({
        title: `${top.label} leads revenue`,
        body: `${top.label} holds ${topPct}% of revenue (${fmt(top.value)}); ${con.vitalFew} of ${con.n} segments make up 80%.`,
        tone: con.topShare >= 0.5 ? "watch" : "neutral",
        metric: `${topPct}%`,
        source: "Revenue by segment",
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
                  visual: "Revenue by segment",
                  label: "Portfolio revenue",
                  value: fmt(con.total),
                  insights: [],
                  explain,
                }),
            }
          : undefined,
      });
    }
  }

  // 2 — Margin leaders vs laggards (revenue-weighted, vs portfolio average). --
  if (has("segment") && has("revenue") && has("margin")) {
    const agg = new Map<string, { rev: number; gp: number }>();
    let dropped = false;
    for (const r of rows) {
      const rev = Number(r.revenue ?? 0);
      const mgn = Number(r.margin);
      if (!Number.isFinite(rev) || rev <= 0 || !Number.isFinite(mgn)) {
        // A row we can't weight honestly. If it carried revenue, the share
        // denominators below would be understated — so drop the whole insight.
        if (Number.isFinite(rev) && rev > 0) dropped = true;
        continue;
      }
      const cur = agg.get(String(r.segment)) ?? { rev: 0, gp: 0 };
      cur.rev += rev;
      cur.gp += mgn * rev; // margin is already in percentage POINTS
      agg.set(String(r.segment), cur);
    }
    const seg = [...agg.entries()]
      .filter(([, v]) => v.rev > 0)
      .map(([label, v]) => ({ label, wm: v.gp / v.rev, rev: v.rev }));
    const totalRev = seg.reduce((s, r) => s + r.rev, 0);
    if (!dropped && seg.length >= 2 && totalRev > 0) {
      const portfolio = seg.reduce((s, r) => s + r.wm * r.rev, 0) / totalRev;
      const sorted = [...seg].sort((a, b) => b.wm - a.wm);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const spread = best.wm - worst.wm;
      const shr = (r: { rev: number }) => Math.round((r.rev / totalRev) * 100);
      insights.push({
        title: `${best.label} runs the richest margin`,
        body:
          `${best.label} earns ${best.wm.toFixed(1)}% margin (${shr(best)}% of revenue) vs ` +
          `${worst.label} at ${worst.wm.toFixed(1)}% (${shr(worst)}%); portfolio averages ${portfolio.toFixed(1)}%.`,
        tone: "neutral",
        metric: `${best.wm.toFixed(1)}%`,
        source: "Revenue-weighted margin by segment",
        evidence: `avg ${portfolio.toFixed(1)}% · spread ${spread.toFixed(1)}pp · ${seg.length} segments`,
        visual: {
          kind: "diverging-bars",
          items: seg.map((r) => ({ label: r.label, value: r.wm })),
          center: portfolio,
          unit: "%",
        },
      });
    }
  }

  // 3 — Geographic revenue mix by region. -----------------------------------
  if (has("region") && has("revenue")) {
    const byRegion = new Map<string, number>();
    for (const r of rows) byRegion.set(String(r.region), (byRegion.get(String(r.region)) ?? 0) + Number(r.revenue ?? 0));
    const entries = [...byRegion.entries()].map(([label, value]) => ({ label, value }));
    const con = concentration(entries);
    if (con && con.n >= 2) {
      const rawTotal = entries.reduce((s, e) => s + e.value, 0);
      const fullyCovered = entries.every((e) => Number.isFinite(e.value) && e.value > 0) && Math.abs(rawTotal - con.total) < 1e-6;
      const top = con.ranked[0];
      const topPct = Math.round(top.share * 100);
      const explain: ExplainInput = {
        label: "Portfolio revenue · all regions",
        value: con.total,
        valuePrefix: prefix,
        directionality: "neutral",
        pointInSeries: false,
        children: con.ranked.map((r) => ({ label: r.label, value: r.value })),
      };
      insights.push({
        title: `${top.label} anchors the geographic mix`,
        body: `${top.label} is ${topPct}% of revenue across ${con.n} regions; ${con.vitalFew} of ${con.n} make up 80%.`,
        tone: con.topShare >= 0.5 ? "watch" : "neutral",
        metric: `${topPct}%`,
        source: "Revenue by region",
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
                  visual: "Revenue by region",
                  label: "Portfolio revenue",
                  value: fmt(con.total),
                  insights: [],
                  explain,
                }),
            }
          : undefined,
      });
    }
  }

  return insights;
}
