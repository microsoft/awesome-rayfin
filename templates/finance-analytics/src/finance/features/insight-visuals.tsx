import { memo } from "react";
import { formatCompact } from "../lib/format";

/**
 * Inline "micro-visuals" for the intelligence rail. Each is a tiny, dependency-free
 * SVG/flex sketch sized for a ~280px rail row — it turns an insight from a sentence
 * into something you can *read at a glance*. Every one is honest (it only draws the
 * numbers it is given) and accessible (an `aria-label` summarises it, and the parent
 * insight body carries the same facts as text).
 */
export type InsightVisual =
  /** Ranked share-of-total bars (composition / concentration). */
  | { kind: "share-bars"; items: { label: string; value: number }[]; valuePrefix?: string; highlight?: string }
  /** Each item's metric relative to a centre line (e.g. margin vs portfolio average). */
  | { kind: "diverging-bars"; items: { label: string; value: number }[]; center: number; unit?: string }
  /** Where one point sits within the min–max range of its peers/history. */
  | { kind: "distribution"; values: number[]; point: number; pointLabel?: string; valuePrefix?: string }
  /** A bare ordered series shape. */
  | { kind: "sparkline"; values: number[] };

const CHART = (i: number) => `var(--color-chart-${(i % 5) + 1})`;

function ShareBars({ items, valuePrefix = "", highlight }: Extract<InsightVisual, { kind: "share-bars" }>) {
  const rows = items.filter((r) => Number.isFinite(r.value) && r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0 || rows.length === 0) return null;
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 4);
  const desc = top.map((r) => `${r.label} ${Math.round((r.value / total) * 100)}%`).join(", ");
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`Share of total: ${desc}.`}>
      {top.map((r, i) => {
        const share = r.value / total;
        const on = highlight && r.label === highlight;
        return (
          <div key={r.label} className="flex items-center gap-2">
            <span className={"w-14 shrink-0 truncate text-[10px] " + (on ? "font-semibold text-foreground" : "text-muted-foreground")} title={r.label}>
              {r.label}
            </span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, backgroundColor: on ? "var(--color-primary)" : CHART(i) }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] font-semibold tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
          </div>
        );
      })}
      {valuePrefix ? null : null}
    </div>
  );
}

function DivergingBars({ items, center, unit = "" }: Extract<InsightVisual, { kind: "diverging-bars" }>) {
  const rows = items.filter((r) => Number.isFinite(r.value));
  if (rows.length === 0 || !Number.isFinite(center)) return null;
  const maxDev = Math.max(...rows.map((r) => Math.abs(r.value - center)), 1e-9);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const show = sorted.length > 5 ? [...sorted.slice(0, 2), ...sorted.slice(-2)] : sorted;
  const desc = show.map((r) => `${r.label} ${r.value.toFixed(1)}${unit}`).join(", ");
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={`Versus the ${center.toFixed(1)}${unit} average: ${desc}.`}>
      {show.map((r) => {
        const dev = r.value - center;
        const w = (Math.abs(dev) / maxDev) * 50;
        const above = dev >= 0;
        return (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-14 shrink-0 truncate text-[10px] text-muted-foreground" title={r.label}>{r.label}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
              <div className="absolute inset-y-0 w-px bg-border" style={{ left: "50%" }} aria-hidden="true" />
              <div
                className={"absolute inset-y-0 " + (above ? "rounded-r-full bg-success/80" : "rounded-l-full bg-destructive/70")}
                style={above ? { left: "50%", width: `${Math.max(w, 1.5)}%` } : { left: `${50 - Math.max(w, 1.5)}%`, width: `${Math.max(w, 1.5)}%` }}
              />
            </div>
            <span className={"w-9 shrink-0 text-right text-[10px] font-semibold tabular-nums " + (above ? "text-success" : "text-destructive")}>
              {dev >= 0 ? "+" : ""}{dev.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DistributionStrip({ values, point, pointLabel, valuePrefix = "" }: Extract<InsightVisual, { kind: "distribution" }>) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 3 || !Number.isFinite(point)) return null;
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const pos = (v: number) => 3 + ((v - min) / span) * 94;
  const sorted = [...vs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const below = vs.filter((v) => v <= point).length;
  const pctile = Math.round((below / vs.length) * 100);
  const fmt = (n: number) => formatCompact(n, valuePrefix);
  return (
    <div role="img" aria-label={`${pointLabel ?? "This point"} ${fmt(point)} sits at the ${pctile}th percentile of ${vs.length} values, range ${fmt(min)} to ${fmt(max)}.`}>
      <svg viewBox="0 0 100 14" className="h-5 w-full" preserveAspectRatio="none">
        <line x1={3} x2={97} y1={7} y2={7} stroke="var(--color-muted-foreground)" strokeWidth={0.5} opacity={0.4} />
        {vs.map((v, i) => (
          <circle key={i} cx={pos(v)} cy={7} r={1.1} fill="var(--color-muted-foreground)" opacity={0.5} />
        ))}
        <line x1={pos(med)} x2={pos(med)} y1={3} y2={11} stroke="var(--color-muted-foreground)" strokeWidth={0.6} strokeDasharray="1.5 1.5" />
        <circle cx={pos(point)} cy={7} r={2.4} fill="var(--color-primary)" stroke="var(--color-card)" strokeWidth={1} />
      </svg>
      <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground">
        <span>{fmt(min)}</span>
        <span className="font-semibold text-foreground">{pctile}th pct</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  );
}

function MiniSparkline({ values }: Extract<InsightVisual, { kind: "sparkline" }>) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 3) return null;
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const x = (i: number) => (i / (vs.length - 1)) * 100;
  const y = (v: number) => 2 + (1 - (v - min) / span) * 16;
  const line = vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 20" className="h-5 w-full text-primary" preserveAspectRatio="none" role="img" aria-label={`Series of ${vs.length} points from ${min} to ${max}.`}>
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(vs.length - 1)} cy={y(vs[vs.length - 1])} r={1.8} fill="currentColor" />
    </svg>
  );
}

/** Render whichever inline micro-visual an insight carries. */
function InsightVisualImpl({ visual }: { visual: InsightVisual }) {
  switch (visual.kind) {
    case "share-bars":
      return <ShareBars {...visual} />;
    case "diverging-bars":
      return <DivergingBars {...visual} />;
    case "distribution":
      return <DistributionStrip {...visual} />;
    case "sparkline":
      return <MiniSparkline {...visual} />;
    default:
      return null;
  }
}

export const InsightVisualView = memo(InsightVisualImpl);
