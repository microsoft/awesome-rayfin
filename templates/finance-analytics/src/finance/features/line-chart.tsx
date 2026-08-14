import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import type { BarDatum } from "./bar-chart";
import { CursorTooltip } from "../primitives";
import { LineChartSkeleton } from "../components/states";
import { useChartCursor, useRovingIndex, niceTicks, SrChartTable, chartSummary } from "./chart-shared";
import type { InteractionEvent } from "../data/fabric-interop";

export interface LineChartProps {
  data: BarDatum[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a point drills into that period. */
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

/** Standardized area/line chart — pure SVG with a nice-scaled axis, a hover crosshair,
 *  nearest-point cursor tooltip, focusable points and keyboard traversal. */
function LineChartImpl({ data, height = 220, valuePrefix = "", onSelect }: LineChartProps) {
  const { tip, show, hide } = useChartCursor();
  const { active, setActive, onKeyDown } = useRovingIndex(
    data.length,
    onSelect ? (i) => onSelect(data[i], i) : undefined,
  );
  const [focused, setFocused] = useState(false);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const content = (i: number) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{data[i]?.label}</span>
      <span className="font-numeric tabular-nums text-muted-foreground">
        {formatCompact(data[i]?.value ?? 0, valuePrefix)}
      </span>
    </div>
  );

  const w = 600;
  const h = height;
  const pad = 8;
  const n = data.length;
  const values = data.map((d) => d.value);
  const dataMax = Math.max(...values, 0);
  const dataMin = Math.min(...values, 0);
  const { ticks, niceMin, niceMax } = niceTicks(dataMin, dataMax, 4);
  const span = niceMax - niceMin || 1;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i / (n - 1)) * (w - 2 * pad));
  const y = (v: number) => h - pad - ((v - niceMin) / span) * (h - 2 * pad);
  const xPct = (i: number) => (x(i) / w) * 100;
  const yPct = (v: number) => (y(v) / h) * 100;

  useEffect(() => {
    if (!focused || !plotRef.current) return;
    const r = plotRef.current.getBoundingClientRect();
    show(r.left + (xPct(active) / 100) * r.width, r.top + (yPct(values[active] ?? 0) / 100) * r.height, content(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focused]);

  if (n === 0) return null;

  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;

  const nearestIndex = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r || n <= 1) return 0;
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(frac * (n - 1));
  };

  return (
    <div className="flex flex-col" style={{ height: h + 20 }}>
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-m">
        <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={i}>{formatCompact(t, valuePrefix)}</span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          tabIndex={0}
          aria-label={`Line chart. ${chartSummary(data, valuePrefix)} Use arrow keys to explore.`}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); hide(); }}
          onMouseMove={(e) => { const i = nearestIndex(e.clientX); setActive(i); show(e.clientX, e.clientY, content(i)); }}
          onMouseLeave={() => { if (!focused) hide(); }}
          onClick={onSelect ? () => onSelect(data[active], active) : undefined}
        >
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t, i) => (
              <span key={i} className={t === 0 ? "h-px w-full bg-border" : "h-px w-full bg-border/40"} />
            ))}
          </div>

          {(focused || tip) && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/40"
              style={{ left: `${xPct(active)}%` }}
            />
          )}

          <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-hidden="true" className="relative">
            <defs>
              <linearGradient id="fabric-line-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.30" />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={area} fill="url(#fabric-line-fill)" />
            <polyline
              points={line}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              className="chart-draw"
            />
          </svg>

          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary transition-all"
            style={{
              left: `${xPct(active)}%`,
              top: `${yPct(values[active] ?? 0)}%`,
              transform: `translate(-50%, -50%) scale(${focused || tip ? 1.3 : 1})`,
            }}
          />
        </div>

        <div aria-hidden="true" />
        <div className="mt-xs flex justify-between text-100 text-muted-foreground">
          {data.map((d, i) => (
            <span key={i} className={"truncate " + (focused && i === active ? "font-medium text-foreground" : "")}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <SrChartTable caption="Line chart data" data={data} valuePrefix={valuePrefix} />
      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

const LineChartCustom = memo(LineChartImpl);

/** Standardized line/area chart. Routes to the "custom" (default) bespoke SVG chart
 *  or the lazy "fabric" `VegaVisual`. Custom remains the default until a Fabric host
 *  validates the fabric engine end-to-end. */
export function LineChart(props: LineChartProps) {
  if (props.engine === "fabric") {
    return (
      <Suspense fallback={<LineChartSkeleton />}>
        <LazyFabricChart
          variant="line"
          data={props.data}
          height={props.height}
          valuePrefix={props.valuePrefix}
          onSelect={props.onSelect}
          onInteraction={props.onInteraction}
          captureId={props.captureId}
        />
      </Suspense>
    );
  }
  return <LineChartCustom {...props} />;
}
