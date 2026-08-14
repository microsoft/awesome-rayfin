import { memo, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex } from "./chart-shared";

export interface ComboChartProps {
  labels: string[];
  /** Primary measure drawn as bars, scaled to the left axis. */
  bar: { name: string; values: number[]; color?: string };
  /** Secondary measure drawn as a line, scaled to the independent right axis. */
  line: { name: string; values: number[]; color?: string };
  /** Render line values as a percentage (×100 + "%") instead of compact numbers. */
  linePercent?: boolean;
  height?: number;
  valuePrefix?: string;
  onSelect?: (label: string, index: number) => void;
}

const BAR_C = "var(--color-chart-1)";
const LINE_C = "var(--color-chart-5)";

/**
 * Combo / dual-axis chart — bars for a volume measure on the left axis and a line
 * for a rate/ratio measure on an independent right axis (e.g. Revenue vs Margin %).
 * The two scales let related-but-differently-unitted metrics share one frame. Hover
 * crosshair reads both series; keyboard traversable; screen-reader table. Pure SVG.
 */
function ComboChartImpl({ labels, bar, line, linePercent, height = 240, valuePrefix = "", onSelect }: ComboChartProps) {
  const { tip, show, hide } = useChartCursor();
  const n = labels.length;
  const { active, setActive, onKeyDown } = useRovingIndex(n, onSelect ? (i) => onSelect(labels[i], i) : undefined);
  const [focused, setFocused] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const barColor = bar.color ?? BAR_C;
  const lineColor = line.color ?? LINE_C;
  const fmtLine = (v: number) => (linePercent ? `${(v * 100).toFixed(1)}%` : formatCompact(v, valuePrefix));

  // Left axis: bars from 0. Right axis: hug the line's own range.
  const barMax = Math.max(...bar.values, 1) * 1.1;
  const lineMin = Math.min(...line.values);
  const lineMax = Math.max(...line.values);
  const lSpread = lineMax - lineMin || Math.abs(lineMax) || 1;
  const lLo = lineMin - lSpread * 0.2;
  const lHi = lineMax + lSpread * 0.2;
  const lSpan = lHi - lLo || 1;

  const TICKS = 5;
  const leftTicks = Array.from({ length: TICKS }, (_, i) => barMax - (i * barMax) / (TICKS - 1));
  const rightTicks = Array.from({ length: TICKS }, (_, i) => lHi - (i * lSpan) / (TICKS - 1));

  const w = 600;
  const h = height;
  const pad = 10;
  const bandW = w / Math.max(n, 1);
  const cx = (i: number) => bandW * i + bandW / 2;
  const yL = (v: number) => h - pad - (v / barMax) * (h - 2 * pad);
  const yR = (v: number) => h - pad - ((v - lLo) / lSpan) * (h - 2 * pad);
  const xPct = (i: number) => (cx(i) / w) * 100;

  const content = (i: number) => (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{labels[i]}</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="size-2 rounded-[2px]" style={{ background: barColor }} aria-hidden="true" />
        <span className="text-muted-foreground">{bar.name}</span>
        <span className="ml-auto font-medium">{formatCompact(bar.values[i], valuePrefix)}</span>
      </span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="size-2 rounded-full" style={{ background: lineColor }} aria-hidden="true" />
        <span className="text-muted-foreground">{line.name}</span>
        <span className="ml-auto font-medium">{fmtLine(line.values[i])}</span>
      </span>
    </div>
  );

  const nearest = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || n < 1) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n)));
  };

  if (n === 0) return null;

  const linePts = line.values.map((v, i) => `${cx(i)},${yR(v)}`).join(" ");

  return (
    <div className="flex flex-col gap-s">
      <div className="flex flex-wrap items-center gap-x-l gap-y-1">
        <span className="flex items-center gap-1.5 text-100 text-muted-foreground">
          <span className="size-2.5 rounded-[2px]" style={{ background: barColor }} aria-hidden="true" />{bar.name}
        </span>
        <span className="flex items-center gap-1.5 text-100 text-muted-foreground">
          <svg width="18" height="8" aria-hidden="true"><line x1="0" y1="4" x2="18" y2="4" stroke={lineColor} strokeWidth="2.5" strokeLinecap="round" /></svg>{line.name}
        </span>
      </div>

      <div className="flex flex-col" style={{ height: h + 20 }}>
        <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr_auto] grid-rows-[1fr_auto] gap-x-m">
          <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
            {leftTicks.map((t, i) => <span key={i}>{formatCompact(t, valuePrefix)}</span>)}
          </div>

          <div
            ref={plotRef}
            role="group"
            tabIndex={0}
            aria-label={`Combo chart: ${bar.name} bars and ${line.name} line across ${n} periods. Use arrow keys to explore.`}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); hide(); }}
            onMouseMove={(e) => { const i = nearest(e.clientX); setActive(i); show(e.clientX, e.clientY, content(i)); }}
            onMouseLeave={() => { if (!focused) hide(); }}
            onClick={onSelect ? () => onSelect(labels[active], active) : undefined}
            className={"relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring " + (onSelect ? "cursor-pointer" : "")}
          >
            <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
              {leftTicks.map((_, i) => <span key={i} className="h-px w-full bg-border/40" />)}
            </div>

            {(focused || tip) && (
              <span aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/40" style={{ left: `${xPct(active)}%` }} />
            )}

            <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-hidden="true" className="chart-wipe relative overflow-visible">
              <defs>
                <linearGradient id="combo-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={barColor} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={barColor} stopOpacity="0.42" />
                </linearGradient>
              </defs>
              {bar.values.map((v, i) => {
                const bw = bandW * 0.5;
                const top = yL(v);
                return (
                  <rect
                    key={i}
                    x={cx(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={Math.max(h - pad - top, 0)}
                    rx="3"
                    fill="url(#combo-bar)"
                    opacity={i === active && (focused || tip) ? 1 : 0.9}
                  />
                );
              })}
              <polyline points={linePts} fill="none" stroke={lineColor} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>

            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card transition-transform"
              style={{ left: `${xPct(active)}%`, top: `${(yR(line.values[active]) / h) * 100}%`, background: lineColor, transform: `translate(-50%, -50%) scale(${focused || tip ? 1.2 : 0})` }}
            />
          </div>

          <div className="flex flex-col justify-between py-[1px] text-left text-100 tabular-nums text-muted-foreground">
            {rightTicks.map((t, i) => <span key={i}>{fmtLine(t)}</span>)}
          </div>

          <div aria-hidden="true" />
          <div className="mt-xs flex text-100 text-muted-foreground">
            {labels.map((l, i) => (
              <span key={i} className={"flex-1 truncate text-center " + (focused && i === active ? "font-medium text-foreground" : "")}>{l}</span>
            ))}
          </div>
          <div aria-hidden="true" />
        </div>
      </div>

      <table className="sr-only">
        <caption>Combo chart data</caption>
        <thead>
          <tr><th scope="col">Period</th><th scope="col">{bar.name}</th><th scope="col">{line.name}</th></tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={i}><th scope="row">{l}</th><td>{formatCompact(bar.values[i], valuePrefix)}</td><td>{fmtLine(line.values[i])}</td></tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const ComboChart = memo(ComboChartImpl);
