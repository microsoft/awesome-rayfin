import { memo, useEffect, useRef, useState } from "react";
import { formatCompact, formatSignedCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { useChartCursor, useRovingIndex, niceTicks } from "./chart-shared";

export type WaterfallKind = "start" | "delta" | "total";

export interface WaterfallStep {
  label: string;
  value: number;
  /** "start"/"total" anchor to the baseline; "delta" (default) floats on the running total. */
  kind?: WaterfallKind;
}

export interface WaterfallChartProps {
  steps: WaterfallStep[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a step drills into it. */
  onSelect?: (step: WaterfallStep, index: number) => void;
}

interface Bar { label: string; kind: WaterfallKind; value: number; lo: number; hi: number; end: number }

/**
 * Waterfall / bridge chart — shows how a starting value moves to an ending value
 * through signed contributions. Anchors (start/total) rise from the baseline;
 * deltas float on the running total with connectors, green for increases and red
 * for decreases. Hover reads the step value + running total; full keyboard support.
 */
function WaterfallChartImpl({ steps, height = 240, valuePrefix = "", onSelect }: WaterfallChartProps) {
  const { tip, show, hide } = useChartCursor();
  const { active, setActive, onKeyDown } = useRovingIndex(steps.length, onSelect ? (i) => onSelect(steps[i], i) : undefined);
  const [focused, setFocused] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  let running = 0;
  const bars: Bar[] = steps.map((s) => {
    const kind = s.kind ?? "delta";
    if (kind === "delta") {
      const lo = Math.min(running, running + s.value);
      const hi = Math.max(running, running + s.value);
      running += s.value;
      return { label: s.label, kind, value: s.value, lo, hi, end: running };
    }
    // start / total anchor to zero; total resets running to its absolute value
    const hi = Math.max(0, s.value);
    const lo = Math.min(0, s.value);
    running = s.value;
    return { label: s.label, kind, value: s.value, lo, hi, end: running };
  });

  const maxV = Math.max(...bars.map((b) => b.hi), 0);
  const minV = Math.min(...bars.map((b) => b.lo), 0);
  const { ticks, niceMin, niceMax } = niceTicks(minV, maxV, 4);
  const domain = niceMax - niceMin || 1;

  const w = 600;
  const h = height;
  const pad = 8;
  const n = bars.length;
  const band = (w - 2 * pad) / n;
  const bw = band * 0.6;
  const cx = (i: number) => pad + band * i + band / 2;
  const y = (v: number) => h - pad - ((v - niceMin) / domain) * (h - 2 * pad);

  const colorOf = (b: Bar) =>
    b.kind !== "delta" ? "var(--color-chart-1)" : b.value >= 0 ? "var(--color-success)" : "var(--color-destructive)";

  const content = (i: number) => {
    const b = bars[i];
    if (!b) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{b.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {b.kind === "delta" ? formatSignedCompact(b.value, valuePrefix) : formatCompact(b.value, valuePrefix)}
          {b.kind === "delta" ? (b.value >= 0 ? " increase" : " decrease") : b.kind === "start" ? " opening" : " closing"}
        </span>
        <span className="tabular-nums text-muted-foreground">Running total {formatCompact(b.end, valuePrefix)}</span>
      </div>
    );
  };

  useEffect(() => {
    if (!focused || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const b = bars[active];
    show(r.left + (cx(active) / w) * r.width, r.top + (y(b.hi) / h) * r.height, content(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focused]);

  if (n === 0) return null;

  return (
    <div className="flex flex-col" style={{ height: h + 22 }}>
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-m">
        <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
          {ticks.map((t, i) => <span key={i}>{formatCompact(t, valuePrefix)}</span>)}
        </div>

        <div
          role="group"
          tabIndex={0}
          aria-label={`Waterfall chart with ${n} steps. Use arrow keys to explore.`}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); hide(); }}
          className={"relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring " + (onSelect ? "cursor-pointer" : "")}
        >
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t, i) => <span key={i} className={t === 0 ? "h-px w-full bg-border" : "h-px w-full bg-border/40"} />)}
          </div>

          <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" className="relative overflow-visible" role="img" aria-hidden="true">
            {bars.map((b, i) => {
              if (i === 0) return null;
              const prevEnd = bars[i - 1].end;
              return <line key={"c" + i} x1={cx(i - 1)} y1={y(prevEnd)} x2={cx(i)} y2={y(prevEnd)} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />;
            })}
            {bars.map((b, i) => {
              const top = y(b.hi);
              const barH = Math.max(y(b.lo) - y(b.hi), 1.5);
              return (
                <g key={b.label}>
                  <rect
                    x={cx(i) - bw / 2}
                    y={top}
                    width={bw}
                    height={barH}
                    rx="2"
                    fill={colorOf(b)}
                    className="bar-grow"
                    style={{ transformBox: "fill-box", transformOrigin: "bottom", animationDelay: `${i * 55}ms` }}
                    opacity={0.92}
                  />
                  {focused && i === active ? (
                    <rect x={cx(i) - bw / 2 - 2} y={top - 2} width={bw + 4} height={barH + 4} rx="3" fill="none" stroke="var(--color-ring)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  ) : null}
                  <rect
                    x={cx(i) - band / 2}
                    y={0}
                    width={band}
                    height={h}
                    fill="transparent"
                    style={{ cursor: onSelect ? "pointer" : "default" }}
                    onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
                    onMouseLeave={() => { if (!focused) hide(); }}
                    onClick={onSelect ? () => onSelect(steps[i], i) : undefined}
                  />
                </g>
              );
            })}
          </svg>

          {bars.map((b, i) => (
            <span
              key={"v" + b.label}
              aria-hidden="true"
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full pb-0.5 text-[10px] font-semibold tabular-nums"
              style={{
                left: `${(cx(i) / w) * 100}%`,
                top: `${(y(b.hi) / h) * 100}%`,
                color:
                  b.kind !== "delta"
                    ? "var(--color-foreground)"
                    : b.value >= 0
                      ? "var(--color-success)"
                      : "var(--color-destructive)",
              }}
            >
              {b.kind === "delta" ? formatSignedCompact(b.value, valuePrefix) : formatCompact(b.value, valuePrefix)}
            </span>
          ))}
        </div>

        <div aria-hidden="true" />
        <div className="mt-xs flex gap-1">
          {bars.map((b, i) => (
            <span key={b.label} className={"flex-1 truncate text-center text-100 " + (focused && i === active ? "font-medium text-foreground" : "text-muted-foreground")}>{b.label}</span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>Waterfall chart data</caption>
        <thead><tr><th scope="col">Step</th><th scope="col">Change</th><th scope="col">Running total</th></tr></thead>
        <tbody>
          {bars.map((b, i) => (
            <tr key={i}><th scope="row">{b.label}</th><td>{b.kind === "delta" ? formatSignedCompact(b.value, valuePrefix) : formatCompact(b.value, valuePrefix)}</td><td>{formatCompact(b.end, valuePrefix)}</td></tr>
          ))}
        </tbody>
      </table>

      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

export const WaterfallChart = memo(WaterfallChartImpl);
