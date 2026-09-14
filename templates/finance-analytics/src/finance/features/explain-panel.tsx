import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Check, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import {
  explain,
  narrate,
  scorecard,
  robustAnomaly,
  type ExplainInput,
  type ExplainSection,
  type FactTone,
  type Directionality,
} from "../lib/insights-kernel";
import { formatCompact, formatSignedCompact, formatSignedPercent } from "../lib/format";

export interface ExplainPanelProps {
  input: ExplainInput;
}

const TONE_DOT: Record<FactTone, string> = {
  positive: "bg-success",
  watch: "bg-destructive",
  neutral: "bg-primary",
};
const TONE_TEXT: Record<FactTone, string> = {
  positive: "text-success",
  watch: "text-destructive",
  neutral: "text-foreground",
};
const TONE_CHIP: Record<FactTone, string> = {
  positive: "border-success/40 bg-success/10 text-success",
  watch: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};
const TONE_STROKE: Record<FactTone, string> = {
  positive: "var(--color-success)",
  watch: "var(--color-destructive)",
  neutral: "var(--color-primary)",
};
const TONE_ACCENT: Record<FactTone, string> = {
  positive: "border-success/30 bg-success/[0.06]",
  watch: "border-destructive/30 bg-destructive/[0.06]",
  neutral: "border-border bg-muted/25",
};

/** Directionality-aware favorability of a delta. Neutral metrics never read
 *  good/bad (so raw balance-sheet balances aren't framed as ahead/behind). */
function favorabilityOf(abs: number, dir: Directionality): boolean | null {
  if (dir === "neutral") return null;
  if (dir === "lower-better") return abs < 0;
  return abs > 0;
}
function varianceTone(fav: boolean | null): string {
  if (fav == null) return "text-foreground";
  return fav ? "text-success" : "text-destructive";
}

/** Finite points of a (number|null)[] paired with their original index. */
function finitePoints(values: (number | null)[]): { i: number; v: number }[] {
  const out: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) out.push({ i, v });
  });
  return out;
}

/** A flat, sectioned block: an uppercase section label over its content, with a
 *  hairline separating it from the previous section. No card chrome / shadow. */
function Block({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-3 first:border-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Honest radial dial. Rendered ONLY when a like-for-like metric exists:
 *  - budget-attainment: fill is capped at 100%, the true % (which may exceed
 *    100) is printed in the centre, and it's explicitly labelled "of budget".
 *  - history-rank: a genuine 0–100 percentile, so the fill is the value itself. */
function ScoreDial({ pct, center, tone }: { pct: number; center: string; tone: FactTone }) {
  const r = 20;
  const C = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(100, pct));
  const off = C * (1 - fill / 100);
  return (
    <div className="relative flex size-[52px] shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="size-[52px] -rotate-90">
        <circle cx={24} cy={24} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={4} />
        <circle
          cx={24}
          cy={24}
          r={r}
          fill="none"
          stroke={TONE_STROKE[tone]}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={off}
        />
      </svg>
      <span className={"absolute text-[12px] font-bold tabular-nums " + TONE_TEXT[tone]}>{center}</span>
    </div>
  );
}

/** Sparkline-style trend, plotted by ORIGINAL index so gaps stay as gaps.
 *  Neutral accent — direction is conveyed by the header trend label, not colour. */
function TrendArea({ values, fmt, pointInSeries }: { values: (number | null)[]; fmt: (n: number) => string; pointInSeries?: boolean }) {
  const pts = finitePoints(values);
  if (pts.length < 3) return null;
  const n = values.length;
  const vs = pts.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || Math.abs(max) || 1;
  const pad = span * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const W = 100;
  const H = 30;
  const x = (i: number) => (n <= 1 ? W / 2 : 4 + (i / (n - 1)) * (W - 8));
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  const sorted = [...vs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const segs: string[] = [];
  let cur: string[] = [];
  let prevIdx = -2;
  for (const p of pts) {
    if (p.i !== prevIdx + 1 && cur.length) {
      segs.push(cur.join(" "));
      cur = [];
    }
    cur.push(`${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`);
    prevIdx = p.i;
  }
  if (cur.length) segs.push(cur.join(" "));
  const last = pts[pts.length - 1];
  const stroke = "var(--color-primary)";

  return (
    <Block label={pointInSeries === false ? `Monthly series · ${pts.length} pts` : `Trend · ${pts.length} pts`} aside={<span className="text-[11px] tabular-nums text-muted-foreground">median {fmt(med)}</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-12 w-full" preserveAspectRatio="none" role="img" aria-label={`Series over ${pts.length} periods, latest ${fmt(last.v)}, median ${fmt(med)}.`}>
        <line x1={4} x2={W - 4} y1={y(med)} y2={y(med)} stroke="var(--color-muted-foreground)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />
        {segs.map((pointsStr, k) =>
          pointsStr.includes(" ") ? (
            <polyline key={k} points={pointsStr} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ) : (
            <circle key={k} cx={Number(pointsStr.split(",")[0])} cy={Number(pointsStr.split(",")[1])} r={1.1} fill={stroke} />
          )
        )}
        <circle cx={x(last.i)} cy={y(last.v)} r={2} fill={stroke} stroke="var(--color-card)" strokeWidth={1} />
      </svg>
    </Block>
  );
}

/** Where the clicked value sits within the distribution of its OWN history. Shown
 *  only for a genuine point-in-series ranking (history-rank), and labelled with the
 *  SAME prior-only percentile the header dial uses — one source of truth, so the
 *  strip, dial, and read-out can never disagree. */
function HistoryDistribution({ values, point, pct, sample, fmt }: { values: number[]; point: number; pct: number; sample: number; fmt: (n: number) => string }) {
  const vs = values.filter((v) => Number.isFinite(v));
  if (vs.length < 5 || !Number.isFinite(point)) return null;
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || Math.abs(max) || 1;
  const pos = (v: number) => 3 + ((v - min) / span) * 94;
  const sorted = [...vs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const rounded = Math.round(pct);
  return (
    <Block label="Distribution" aside={<span className="text-[11px] tabular-nums text-muted-foreground">median {fmt(med)}</span>}>
      <svg viewBox="0 0 100 16" className="h-6 w-full" preserveAspectRatio="none" role="img" aria-label={`${fmt(point)} ranks in the ${rounded}th percentile of ${sample} prior periods; range ${fmt(min)} to ${fmt(max)}, median ${fmt(med)}.`}>
        <line x1={3} x2={97} y1={8} y2={8} stroke="var(--color-muted-foreground)" strokeWidth={0.5} opacity={0.4} />
        {vs.map((v, i) => (
          <circle key={i} cx={pos(v)} cy={8} r={1.1} fill="var(--color-muted-foreground)" opacity={0.45} />
        ))}
        <line x1={pos(med)} x2={pos(med)} y1={3.5} y2={12.5} stroke="var(--color-muted-foreground)" strokeWidth={0.6} strokeDasharray="1.5 1.5" />
        <circle cx={pos(point)} cy={8} r={2.6} fill="var(--color-primary)" stroke="var(--color-card)" strokeWidth={1} />
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{fmt(min)}</span>
        <span className="font-semibold text-foreground">{rounded}th pct</span>
        <span>{fmt(max)}</span>
      </div>
    </Block>
  );
}

/** Grouped magnitude bars — pure magnitude, zero-baseline aware. Neutral accent:
 *  bars show size, not judgement (the stat table carries favorable/unfavorable). */
function VsPlanBars({ value, budget, priorYear, fmt }: { value: number; budget?: number; priorYear?: number; fmt: (n: number) => string }) {
  const rows: { label: string; v: number; accent: boolean }[] = [{ label: "Actual", v: value, accent: true }];
  if (typeof budget === "number" && Number.isFinite(budget)) rows.push({ label: "Budget", v: budget, accent: false });
  if (typeof priorYear === "number" && Number.isFinite(priorYear)) rows.push({ label: "Prior yr", v: priorYear, accent: false });
  if (rows.length < 2) return null;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.v))) || 1;
  const hasNeg = rows.some((r) => r.v < 0);
  const zero = hasNeg ? 50 : 0;

  return (
    <Block label="Actual vs plan">
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const w = (Math.abs(r.v) / maxAbs) * (hasNeg ? 50 : 100);
          const left = r.v < 0 ? zero - w : zero;
          return (
            <div key={r.label} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{r.label}</span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted/50">
                {hasNeg ? <div className="absolute inset-y-0 w-px bg-border" style={{ left: `${zero}%` }} aria-hidden="true" /> : null}
                <div className={"absolute inset-y-0 rounded " + (r.accent ? "bg-primary" : "bg-muted-foreground/35")} style={{ left: `${left}%`, width: `${Math.max(w, 1)}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right text-[11px] font-semibold tabular-nums">{fmt(r.v)}</span>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

/** Number-line anomaly gauge with a true median ± 3.5·scale band. Gated by caller. */
function AnomalyGauge({ values, fmt }: { values: number[]; fmt: (n: number) => string }) {
  const a = robustAnomaly(values);
  if (!a || a.degenerate) return null;
  const last = values[values.length - 1];
  const band = 3.5 * a.scale;
  const lo = Math.min(a.median - band * 1.25, ...values);
  const hi = Math.max(a.median + band * 1.25, ...values);
  const span = hi - lo || 1;
  const pos = (v: number) => 4 + ((v - lo) / span) * 92;
  const bandLeft = pos(a.median - band);
  const bandRight = pos(a.median + band);

  return (
    <Block label="Outlier check" aside={<span className={"text-[11px] tabular-nums " + (a.flagged ? "text-destructive" : "text-muted-foreground")}>z {a.z.toFixed(1)}</span>}>
      <svg viewBox="0 0 100 16" className="h-6 w-full" preserveAspectRatio="none" role="img" aria-label={`Latest ${fmt(last)} versus a typical range of ${fmt(a.median - band)} to ${fmt(a.median + band)}; robust z-score ${a.z.toFixed(1)}, ${a.flagged ? "flagged as an outlier" : "within normal range"}.`}>
        <rect x={bandLeft} y={5} width={Math.max(bandRight - bandLeft, 0.5)} height={6} rx={2} fill="var(--color-muted-foreground)" opacity={0.18} />
        <line x1={pos(a.median)} x2={pos(a.median)} y1={3} y2={13} stroke="var(--color-muted-foreground)" strokeWidth={0.6} strokeDasharray="1.5 1.5" />
        <circle cx={pos(last)} cy={8} r={2.4} fill={a.flagged ? "var(--color-destructive)" : "var(--color-primary)"} stroke="var(--color-card)" strokeWidth={1} />
      </svg>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Typical range {fmt(a.median - band)} – {fmt(a.median + band)}</p>
    </Block>
  );
}

/** Share-of-total bars for additive, same-sign, positive parts. */
function CompositionBars({ parts: rawParts, fmt }: { parts: { label: string; value: number }[]; fmt: (n: number) => string }) {
  const parts = rawParts.filter((c) => Number.isFinite(c.value) && c.value > 0);
  if (parts.length < 2) return null;
  const total = parts.reduce((s, c) => s + c.value, 0);
  if (total <= 0) return null;
  const ranked = [...parts].sort((a, b) => b.value - a.value).slice(0, 4);
  return (
    <Block label="Composition">
      <div className="flex flex-col gap-1.5">
        {ranked.map((c, i) => {
          const share = c.value / total;
          return (
            <div key={c.label} className="flex items-center gap-2">
              <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground" title={c.label}>{c.label}</span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-muted/50">
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(share * 100, 1)}%`, backgroundColor: `var(--color-chart-${(i % 5) + 1})` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums">{Math.round(share * 100)}% · {fmt(c.value)}</span>
            </div>
          );
        })}
      </div>
    </Block>
  );
}

/** Dense figures table: actual + each existing comparator with a directionality-
 *  coloured variance (abs + %). Zero comparators show "—" for the percentage. */
function FiguresTable({ input, dir, fmt }: { input: ExplainInput; dir: Directionality; fmt: (n: number) => string }) {
  const comps: { label: string; v: number }[] = [];
  if (typeof input.budget === "number" && Number.isFinite(input.budget)) comps.push({ label: "Budget", v: input.budget });
  if (typeof input.target === "number" && Number.isFinite(input.target)) comps.push({ label: "Forecast", v: input.target });
  if (typeof input.priorYear === "number" && Number.isFinite(input.priorYear)) comps.push({ label: "Prior year", v: input.priorYear });

  return (
    <Block label="Figures">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Figures for {input.label}</caption>
        <tbody>
          <tr className="border-b border-border/40">
            <th scope="row" className="py-1 text-left font-medium text-muted-foreground">Actual</th>
            <td className="py-1 text-right font-semibold tabular-nums text-foreground" colSpan={2}>{fmt(input.value)}</td>
          </tr>
          {comps.map((c) => {
            const abs = input.value - c.v;
            const pct = c.v !== 0 ? abs / Math.abs(c.v) : null;
            const fav = favorabilityOf(abs, dir);
            return (
              <tr key={c.label} className="border-b border-border/40 last:border-0">
                <th scope="row" className="py-1 text-left font-medium text-muted-foreground">vs {c.label}</th>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{fmt(c.v)}</td>
                <td className={"py-1 text-right font-semibold tabular-nums " + varianceTone(fav)}>
                  {formatSignedCompact(abs, input.valuePrefix ?? "")}
                  <span className="ml-1 text-[11px] font-medium opacity-80">{pct != null ? formatSignedPercent(pct) : "—"}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Block>
  );
}

function DetailSection({ section }: { section: ExplainSection }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[12px] font-medium text-foreground">{section.title}</span>
        <ChevronDown size={13} className={"ml-auto shrink-0 text-muted-foreground transition-transform " + (open ? "" : "-rotate-90")} aria-hidden="true" />
      </button>
      <p className="sr-only">{section.summary}</p>
      {open ? (
        <div className="flex flex-col gap-1.5 pb-2">
          {section.facts.map((f, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {f.tone ? <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + TONE_DOT[f.tone]} aria-hidden="true" /> : null}
                  <span className="truncate">{f.label}</span>
                </div>
                {f.hint ? <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{f.hint}</div> : null}
              </div>
              <span className={"shrink-0 text-[12px] font-semibold tabular-nums " + (f.tone ? TONE_TEXT[f.tone] : "text-foreground")}>{f.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Deterministic "explain this number" read-out for a clicked datum, styled as a
 * flat, sectioned, numbers-first deep-dive (no floating cards): an honest header
 * (status + trend + an optional like-for-like dial), a computed read-out, a dense
 * figures table, inline magnitude/trend/outlier/composition visuals, and the full
 * collapsible detail. Every signal is computed by the insights kernel — no plan is
 * invented, aggregates are never ranked against their own series, and neutral
 * (balance-sheet) metrics are never framed as favorable/unfavorable. Lazy chunk.
 */
export function ExplainPanel({ input }: ExplainPanelProps) {
  const [copied, setCopied] = useState(false);
  const prefix = input.valuePrefix ?? "";
  const fmt = useMemo(() => (v: number) => formatCompact(v, prefix), [prefix]);

  const analysis = useMemo(() => {
    const sections = explain(input, fmt);
    const card = scorecard(input);
    const finite = input.series ? finitePoints(input.series.values).map((p) => p.v) : [];
    const showGauge = !!input.pointInSeries && finite.length >= 6;
    return { sections, card, finite, showGauge, story: narrate(sections) };
  }, [input, fmt]);

  const { sections, card, showGauge, story } = analysis;

  // 2–3 read-out bullets for the brief (skip the raw Snapshot restatement).
  const bullets = sections.filter((s) => s.id !== "snapshot").map((s) => s.summary).filter(Boolean).slice(0, 3);

  const trendIcon = card.trendLabel?.startsWith("rising") ? (
    <TrendingUp size={13} aria-hidden="true" />
  ) : card.trendLabel?.startsWith("falling") ? (
    <TrendingDown size={13} aria-hidden="true" />
  ) : (
    <Minus size={13} aria-hidden="true" />
  );

  // Honest dial: percentile ring for history-rank; a capped "of budget" dial for
  // attainment (true % printed in the centre); nothing when there is no metric.
  const dial =
    card.metric.kind === "history-rank"
      ? { pct: card.metric.pct, center: `${Math.round(card.metric.pct)}`, sub: `Percentile · ${card.metric.sample} prior periods` }
      : card.metric.kind === "budget-attainment"
        ? { pct: card.metric.pct, center: `${Math.round(card.metric.pct)}%`, sub: "of budget" }
        : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${input.label} — ${fmt(input.value)}\n${card.status}. ${story}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header — status, trend, and an honest dial when a like-for-like reading exists */}
      <div className="flex items-center gap-3">
        {dial ? <ScoreDial pct={dial.pct} center={dial.center} tone={card.statusTone} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold " + TONE_CHIP[card.statusTone]}>{card.status}</span>
            {card.trendLabel ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={card.trendLabel}>
                {trendIcon}
                <span className="capitalize">{card.trendLabel.split(" · ")[0]}</span>
              </span>
            ) : null}
          </div>
          {dial ? <p className="mt-1 text-[11px] text-muted-foreground">{dial.sub}</p> : null}
        </div>
      </div>

      {/* Read-out — deterministic computed brief */}
      {bullets.length ? (
        <div className={"relative overflow-hidden rounded-lg border p-3 " + TONE_ACCENT[card.statusTone]}>
          <span aria-hidden="true" className={"absolute inset-x-0 top-0 h-0.5 " + TONE_DOT[card.statusTone]} />
          <div className="mb-1.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Zap size={11} className={TONE_TEXT[card.statusTone]} aria-hidden="true" />
              Read-out
            </span>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-1.5 text-[13px] leading-snug text-foreground">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Figures + inline visuals — only the ones that are honestly applicable */}
      <FiguresTable input={input} dir={card.direction} fmt={fmt} />
      <VsPlanBars value={input.value} budget={input.budget} priorYear={input.priorYear} fmt={fmt} />
      {input.series ? <TrendArea values={input.series.values} fmt={fmt} pointInSeries={input.pointInSeries} /> : null}
      {card.metric.kind === "history-rank" ? (
        <HistoryDistribution values={analysis.finite.slice(0, -1)} point={input.value} pct={card.metric.pct} sample={card.metric.sample} fmt={fmt} />
      ) : null}
      {showGauge && input.series ? <AnomalyGauge values={analysis.finite} fmt={fmt} /> : null}
      {input.children ? <CompositionBars parts={input.children} fmt={fmt} /> : null}

      {/* Full detail */}
      <div className="border-t border-border/60 pt-1">
        {sections.map((s) => (
          <DetailSection key={s.id} section={s} />
        ))}
      </div>
    </div>
  );
}

export default ExplainPanel;
