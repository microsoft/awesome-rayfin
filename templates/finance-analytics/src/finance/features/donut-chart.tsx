import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import type { BarDatum } from "./bar-chart";
import { CursorTooltip } from "../primitives";
import { AnimatedNumber } from "../components/animated-number";
import { DonutChartSkeleton } from "../components/states";
import { useChartCursor, useRovingIndex, SrChartTable } from "./chart-shared";
import type { InteractionEvent } from "../data/fabric-interop";

export interface DonutChartProps {
  data: BarDatum[];
  size?: number;
  valuePrefix?: string;
  /** Caption under the center total (default "Total"). */
  centerLabel?: string;
  /** Click / Enter on a segment drills into that slice. */
  onSelect?: (datum: BarDatum, index: number) => void;
  /** Chart engine. "custom" (default) = the bespoke, dependency-free SVG chart;
   *  "fabric" = the official Vega `VegaVisual` (lazy-loaded) with native selection
   *  cross-filtering and deck image capture. Requires the optional peer dep. */
  engine?: "custom" | "fabric";
  /** Official interaction stream (fabric engine only), forwarded to the host. */
  onInteraction?: (events: InteractionEvent[]) => void;
  /** Fabric engine only: publish this chart's live view to the capture registry
   *  under this id so the Deck Builder can embed a pixel-perfect snapshot. */
  captureId?: string;
}

const LazyFabricChart = lazy(() => import("./fabric-chart"));

const PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
];

/** Standardized donut/share chart — pure SVG, zero chart-library weight. Segments are
 *  hover- and keyboard-focusable with a cursor tooltip; the total sits in the center. */
function DonutChartImpl({ data, size = 220, valuePrefix = "", centerLabel = "Total", onSelect }: DonutChartProps) {
  const { tip, show, hide } = useChartCursor();
  const { active, setActive, onKeyDown } = useRovingIndex(
    data.length,
    onSelect ? (i) => onSelect(data[i], i) : undefined,
  );
  const [focused, setFocused] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const total = data.reduce((s, d) => s + d.value, 0);
  const divisor = total || 1;
  const r = size / 2;
  const stroke = size * 0.16;
  const rr = r - stroke / 2;
  const circ = 2 * Math.PI * rr;

  const content = (i: number) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{data[i]?.label}</span>
      <span className="font-numeric tabular-nums text-muted-foreground">
        {formatCompact(data[i]?.value ?? 0, valuePrefix)} · {Math.round(((data[i]?.value ?? 0) / divisor) * 100)}%
      </span>
    </div>
  );

  const midFrac = (i: number) => {
    let before = 0;
    for (let k = 0; k < i; k++) before += data[k].value;
    return (before + (data[i]?.value ?? 0) / 2) / divisor;
  };

  useEffect(() => {
    if (!focused || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const angle = -Math.PI / 2 + midFrac(active) * 2 * Math.PI;
    const cx = box.left + box.width / 2 + Math.cos(angle) * (rr / size) * box.width;
    const cy = box.top + box.height / 2 + Math.sin(angle) * (rr / size) * box.height;
    show(cx, cy, content(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focused]);

  const emphasized = focused || !!tip;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-xxl">
      <div
        className="relative shrink-0 chart-pop rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ width: size, height: size }}
        role="group"
        tabIndex={0}
        aria-label={`Share donut chart of ${data.length} categories. Use arrow keys to explore.`}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); hide(); }}
      >
        <svg ref={svgRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-hidden="true">
          <g transform={`rotate(-90 ${r} ${r})`}>
            <circle cx={r} cy={r} r={rr} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
            {data.map((d, i) => {
              const dash = (d.value / divisor) * circ;
              const isActive = emphasized && i === active;
              const seg = (
                <circle
                  key={i}
                  cx={r}
                  cy={r}
                  r={rr}
                  fill="none"
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={isActive ? stroke + 4 : stroke}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  className={onSelect ? "cursor-pointer" : undefined}
                  style={{
                    opacity: emphasized && i !== active ? 0.45 : 1,
                    transition: "opacity 150ms, stroke-width 150ms",
                  }}
                  onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
                  onMouseLeave={() => { if (!focused) hide(); }}
                  onClick={onSelect ? () => onSelect(d, i) : undefined}
                />
              );
              offset += dash;
              return seg;
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-numeric text-500 font-semibold leading-500 tabular-nums">
            <AnimatedNumber value={total} format={(v) => formatCompact(v, valuePrefix)} />
          </span>
          <span className="text-100 uppercase tracking-wide text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="flex min-w-44 flex-col gap-s text-300">
        {data.map((d, i) => (
          <li
            key={i}
            className={
              "flex items-center gap-s rounded px-1 " +
              (emphasized && i === active ? "bg-accent/60" : "")
            }
            onMouseEnter={() => setActive(i)}
          >
            <span className="size-3 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden="true" />
            <span className="truncate">{d.label}</span>
            <span className="ml-auto pl-l font-numeric tabular-nums text-muted-foreground">{formatCompact(d.value, valuePrefix)}</span>
            <span className="w-9 shrink-0 text-right font-numeric font-semibold tabular-nums">{Math.round((d.value / divisor) * 100)}%</span>
          </li>
        ))}
      </ul>

      <SrChartTable caption="Share chart data" data={data} valuePrefix={valuePrefix} />
      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

const DonutChartCustom = memo(DonutChartImpl);

/** Standardized donut/share chart. Routes to the "custom" (default) bespoke SVG
 *  chart or the lazy "fabric" `VegaVisual`. Custom remains the default until a
 *  Fabric host validates the fabric engine end-to-end. The fabric donut has no
 *  center total (a Vega arc limitation); use the custom engine when that matters. */
export function DonutChart(props: DonutChartProps) {
  if (props.engine === "fabric") {
    return (
      <Suspense fallback={<DonutChartSkeleton />}>
        <LazyFabricChart
          variant="donut"
          data={props.data}
          height={props.size}
          valuePrefix={props.valuePrefix}
          onSelect={props.onSelect}
          onInteraction={props.onInteraction}
          captureId={props.captureId}
        />
      </Suspense>
    );
  }
  return <DonutChartCustom {...props} />;
}
