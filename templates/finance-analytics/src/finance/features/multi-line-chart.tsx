import { memo, useRef, useState } from "react";
import { formatCompact, formatSignedCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export type LineStyle = "solid" | "dashed" | "dotted";

export interface LineSeries {
  name: string;
  /** Use `null` to leave a gap — e.g. actuals stop and forecast takes over. */
  values: (number | null)[];
  /** CSS color (defaults cycle through the categorical palette). */
  color?: string;
  /** Stroke style — e.g. actuals solid, forecast dashed, budget dotted. */
  style?: LineStyle;
  /** Fill a soft gradient area beneath this series (e.g. actuals). */
  area?: boolean;
  /** Shaded confidence envelope around this series (e.g. forecast P10–P90). */
  band?: { lower: (number | null)[]; upper: (number | null)[] };
}

export interface MultiLineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a period drills into that x position (all series). */
  onSelect?: (label: string, index: number) => void;
}

const DEFAULTS = ["var(--color-chart-1)", "var(--color-chart-3)", "var(--color-chart-5)", "var(--color-chart-2)"];
const DASH: Record<LineStyle, string | undefined> = { solid: undefined, dashed: "7 5", dotted: "1.5 5" };

/**
 * Multi-series line chart — plots several measures (e.g. Actuals, Forecast,
 * Budget) on a shared nice-scaled axis with a legend, a hover crosshair that
 * reads every series at the nearest period, focus points and keyboard traversal.
 * Actuals draw solid; forecast/budget use dashed/dotted strokes. Pure SVG.
 */
function MultiLineChartImpl({ labels, series, height = 240, valuePrefix = "", onSelect }: MultiLineChartProps) {
  const { tip, show, hide } = useChartCursor();
  const n = labels.length;
  const { active, setActive, onKeyDown } = useRovingIndex(n, onSelect ? (i) => onSelect(labels[i], i) : undefined);
  const [focused, setFocused] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const all = series.flatMap((s) => [
    ...s.values,
    ...(s.band ? [...s.band.lower, ...s.band.upper] : []),
  ]).filter((v): v is number => v != null);
  const dataMax = all.length ? Math.max(...all) : 1;
  const dataMin = all.length ? Math.min(...all) : 0;
  // Frame tightly around the data with a slim, symmetric margin so the trend
  // fills the plot (and low early points lift clear of the baseline) instead of
  // floating in dead space. Ticks are evenly divided across that hugged domain.
  const spread = dataMax - dataMin || Math.abs(dataMax) || 1;
  const niceMin = dataMin - spread * 0.14;
  const niceMax = dataMax + spread * 0.12;
  const span = niceMax - niceMin || 1;
  const TICK_COUNT = 5;
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => niceMax - (i * span) / (TICK_COUNT - 1));

  const w = 600;
  const h = height;
  const pad = 10;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad));
  const y = (v: number) => h - pad - ((v - niceMin) / span) * (h - 2 * pad);
  const xPct = (i: number) => (x(i) / w) * 100;

  const color = (s: LineSeries, i: number) => s.color ?? DEFAULTS[i % DEFAULTS.length];

  /** Split a series into contiguous non-null runs so gaps render as breaks. */
  const runs = (vals: (number | null)[]): [number, number][][] => {
    const out: [number, number][][] = [];
    let cur: [number, number][] = [];
    vals.forEach((v, i) => {
      if (v == null) { if (cur.length) { out.push(cur); cur = []; } }
      else cur.push([i, v]);
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const areaPath = (vals: (number | null)[]): string =>
    runs(vals)
      .map((run) => {
        const line = run.map(([i, v]) => `${x(i)},${y(v)}`).join(" L");
        return `M${x(run[0][0])},${y(niceMin)} L${line} L${x(run[run.length - 1][0])},${y(niceMin)} Z`;
      })
      .join(" ");

  /** Closed polygon between an upper and lower series over contiguous runs. */
  const bandPath = (band: { lower: (number | null)[]; upper: (number | null)[] }): string => {
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const lo = band.lower[i];
      const hi = band.upper[i];
      if (lo != null && hi != null) pairs.push([i, lo, hi]);
    }
    // split into contiguous index runs
    const segs: [number, number, number][][] = [];
    let cur: [number, number, number][] = [];
    pairs.forEach((p, k) => {
      if (k > 0 && p[0] !== pairs[k - 1][0] + 1) { segs.push(cur); cur = []; }
      cur.push(p);
    });
    if (cur.length) segs.push(cur);
    return segs
      .map((seg) => {
        const top = seg.map(([i, , hi]) => `${x(i)},${y(hi)}`).join(" L");
        const bottom = [...seg].reverse().map(([i, lo]) => `${x(i)},${y(lo)}`).join(" L");
        return `M${top} L${bottom} Z`;
      })
      .join(" ");
  };

  // Handoff index = last period the first series (actuals) has a value.
  const handoff = (() => {
    const v = series[0]?.values ?? [];
    for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return i;
    return -1;
  })();

  const content = (i: number) => {
    const base = series[0]?.values[i];
    return (
      <div className="flex flex-col gap-1">
        <span className="font-medium">{labels[i]}</span>
        {series.map((s, si) => {
          const v = s.values[i];
          if (v == null) return null;
          const delta = si > 0 && base != null ? v - base : null;
          return (
            <span key={s.name} className="flex items-center gap-1.5 tabular-nums">
              <span className="size-2 rounded-full" style={{ background: color(s, si) }} aria-hidden="true" />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="ml-auto font-medium">{formatCompact(v, valuePrefix)}</span>
              {delta != null ? (
                <span className={"text-[11px] " + (delta >= 0 ? "text-success" : "text-destructive")}>
                  {formatSignedCompact(delta, valuePrefix)}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    );
  };

  const nearest = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || n <= 1) return 0;
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (n - 1));
  };

  if (n === 0 || series.length === 0) return null;

  return (
    <div className="flex flex-col gap-s">
      <div className="flex flex-wrap items-center gap-x-l gap-y-1">
        {series.map((s, si) => (
          <span key={s.name} className="flex items-center gap-1.5 text-100 text-muted-foreground">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4" stroke={color(s, si)} strokeWidth="2.5" strokeDasharray={DASH[s.style ?? "solid"]} strokeLinecap="round" />
            </svg>
            {s.name}
          </span>
        ))}
      </div>

      <div className="flex flex-col" style={{ height: h + 20 }}>
        <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-m">
          <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
            {ticks.map((t, i) => <span key={i}>{formatCompact(t, valuePrefix)}</span>)}
          </div>

          <div
            ref={plotRef}
            role="group"
            tabIndex={0}
            aria-label={`Multi-series line chart with ${series.length} series across ${n} periods. Use arrow keys to explore.`}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); hide(); }}
            onMouseMove={(e) => { const i = nearest(e.clientX); setActive(i); show(e.clientX, e.clientY, content(i)); }}
            onMouseLeave={() => { if (!focused) hide(); }}
            onClick={onSelect ? () => onSelect(labels[active], active) : undefined}
            className={"relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring " + (onSelect ? "cursor-pointer" : "")}
          >
            <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
              {ticks.map((t, i) => <span key={i} className={t === 0 ? "h-px w-full bg-border" : "h-px w-full bg-border/40"} />)}
            </div>

            {(focused || tip) && (
              <span aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/40" style={{ left: `${xPct(active)}%` }} />
            )}

            {handoff >= 0 && handoff < n - 1 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-muted-foreground/40"
                style={{ left: `${xPct(handoff)}%` }}
              />
            )}

            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-hidden="true" className="chart-wipe relative overflow-visible">
              <defs>
                {series.map((s, si) =>
                  s.area ? (
                    <linearGradient key={s.name} id={`ml-area-${si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color(s, si)} stopOpacity="0.28" />
                      <stop offset="100%" stopColor={color(s, si)} stopOpacity="0" />
                    </linearGradient>
                  ) : null,
                )}
              </defs>
              {series.map((s, si) =>
                s.band ? (
                  <path key={`band-${s.name}`} d={bandPath(s.band)} fill={color(s, si)} fillOpacity="0.14" stroke="none" />
                ) : null,
              )}
              {series.map((s, si) =>
                s.area ? <path key={`area-${s.name}`} d={areaPath(s.values)} fill={`url(#ml-area-${si})`} stroke="none" /> : null,
              )}
              {series.map((s, si) =>
                runs(s.values).map((run, ri) => (
                  <polyline
                    key={`${s.name}-${ri}`}
                    points={run.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}
                    fill="none"
                    stroke={color(s, si)}
                    strokeWidth={si === 0 ? 3 : 2.25}
                    strokeDasharray={DASH[s.style ?? "solid"]}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    opacity={si === 0 ? 1 : 0.95}
                  />
                )),
              )}
            </svg>

            {series.map((s, si) => {
              const v = s.values[active];
              if (v == null) return null;
              return (
                <span
                  key={s.name}
                  aria-hidden="true"
                  className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card transition-all"
                  style={{
                    left: `${xPct(active)}%`,
                    top: `${(y(v) / h) * 100}%`,
                    background: color(s, si),
                    transform: `translate(-50%, -50%) scale(${focused || tip ? 1.25 : 0})`,
                  }}
                />
              );
            })}
          </div>

          <div aria-hidden="true" />
          <div className="mt-xs flex justify-between text-100 text-muted-foreground">
            {labels.map((l, i) => (
              <span key={i} className={"truncate " + (focused && i === active ? "font-medium text-foreground" : "")}>{l}</span>
            ))}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>Multi-series line chart data</caption>
        <thead>
          <tr><th scope="col">Period</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}><th scope="row">{l}</th>{series.map((s) => <td key={s.name}>{s.values[i] == null ? "—" : formatCompact(s.values[i] as number, valuePrefix)}</td>)}</tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const MultiLineChart = memo(MultiLineChartImpl);
