import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { formatCompact } from "../lib/format";
import { CursorTooltip } from "../primitives";
import { BarChartSkeleton } from "../components/states";
import { useChartCursor, useRovingIndex, niceTicks, SrChartTable, chartSummary } from "./chart-shared";
import type { InteractionEvent } from "../data/fabric-interop";

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  valuePrefix?: string;
  /** Click / Enter on a bar drills into that category. */
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

/** Standardized bar chart — HTML bars with a nice-scaled value axis, gridlines, a
 *  zero baseline (with negative-value support), cursor tooltips and full keyboard
 *  traversal. Zero chart-library weight. */
function BarChartImpl({ data, height = 240, valuePrefix = "", onSelect }: BarChartProps) {
  const { tip, show, hide } = useChartCursor();
  const { active, setActive, onKeyDown } = useRovingIndex(
    data.length,
    onSelect ? (i) => onSelect(data[i], i) : undefined,
  );
  const [focused, setFocused] = useState(false);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  const content = (i: number) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{data[i]?.label}</span>
      <span className="font-numeric tabular-nums text-muted-foreground">
        {formatCompact(data[i]?.value ?? 0, valuePrefix)}
      </span>
    </div>
  );

  useEffect(() => {
    if (!focused) return;
    const el = barRefs.current[active];
    if (!el) return;
    const r = el.getBoundingClientRect();
    show(r.left + r.width / 2, r.top, content(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focused]);

  if (data.length === 0) return null;

  const values = data.map((d) => d.value);
  const dataMax = Math.max(...values, 0);
  const dataMin = Math.min(...values, 0);
  const { ticks, niceMin, niceMax } = niceTicks(dataMin, dataMax, 4);
  const domain = niceMax - niceMin || 1;
  const zeroTopPct = ((niceMax - 0) / domain) * 100;
  const hasNeg = dataMin < 0;

  return (
    <div className="flex flex-col" style={{ height: height + 24 }}>
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-m">
        <div className="flex flex-col justify-between py-[1px] text-right text-100 tabular-nums text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={i}>{formatCompact(t, valuePrefix)}</span>
          ))}
        </div>

        <div
          className="relative min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="group"
          tabIndex={0}
          aria-label={`Bar chart. ${chartSummary(data, valuePrefix)} Use arrow keys to explore.`}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            hide();
          }}
        >
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t, i) => (
              <span key={i} className={t === 0 ? "h-px w-full bg-border" : "h-px w-full bg-border/40"} />
            ))}
          </div>

          <div className="relative flex h-full items-stretch gap-3">
            {data.map((d, i) => {
              const barPct = (Math.abs(d.value) / domain) * 100;
              const positive = d.value >= 0;
              const topPct = positive ? zeroTopPct - barPct : zeroTopPct;
              const isActive = focused && i === active;
              return (
                <div key={d.label} className="relative h-full flex-1">
                  <span
                    aria-hidden="true"
                    className={
                      "pointer-events-none absolute left-0 right-0 text-center text-100 font-semibold tabular-nums tracking-tight text-foreground/90 transition-opacity duration-200 " +
                      (isActive ? "opacity-100" : "opacity-80")
                    }
                    style={
                      positive
                        ? { top: `${topPct}%`, transform: "translateY(-135%)" }
                        : { top: `${topPct + barPct}%`, transform: "translateY(35%)" }
                    }
                  >
                    {formatCompact(d.value, valuePrefix)}
                  </span>
                  <div
                    ref={(el) => { barRefs.current[i] = el; }}
                    role={onSelect ? "button" : undefined}
                    aria-label={onSelect ? `${d.label}: ${formatCompact(d.value, valuePrefix)}` : undefined}
                    onMouseMove={(e) => { setActive(i); show(e.clientX, e.clientY, content(i)); }}
                    onMouseLeave={() => { if (!focused) hide(); }}
                    onClick={onSelect ? () => onSelect(d, i) : undefined}
                    className={
                      "bar-grow absolute left-0 right-0 overflow-hidden bg-gradient-to-t from-chart-1/35 via-chart-1/85 to-chart-1 shadow-[0_1px_10px_-2px_var(--color-chart-1)] transition-[filter] duration-200 hover:brightness-110 " +
                      (positive ? "rounded-t-lg" : "rounded-b-lg") + " " +
                      (isActive ? "brightness-110 ring-2 ring-ring ring-offset-1 ring-offset-background" : "") + " " +
                      (onSelect ? "cursor-pointer" : "")
                    }
                    style={{ top: `${topPct}%`, height: `${Math.max(barPct, 0.5)}%`, animationDelay: `${i * 50}ms` }}
                  >
                    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/25 to-transparent" />
                  </div>
                </div>
              );
            })}
          </div>

          {hasNeg && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 h-px bg-border"
              style={{ top: `${zeroTopPct}%` }}
            />
          )}
        </div>

        <div aria-hidden="true" />
        <div className="mt-xs flex gap-3">
          {data.map((d, i) => (
            <span
              key={d.label}
              className={
                "flex-1 truncate text-center text-100 " +
                (focused && i === active ? "font-medium text-foreground" : "text-muted-foreground")
              }
            >
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <SrChartTable caption="Bar chart data" data={data} valuePrefix={valuePrefix} />
      <CursorTooltip content={tip?.content} x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} />
    </div>
  );
}

const BarChartCustom = memo(BarChartImpl);

/** Standardized bar chart. Routes to one of two engines: "custom" (default) — the
 *  bespoke SVG chart — or "fabric" — the official `VegaVisual`, lazy-loaded so its
 *  Vega runtime stays off the initial-load budget. Custom remains the default until
 *  a Fabric host validates the fabric engine end-to-end. */
export function BarChart(props: BarChartProps) {
  if (props.engine === "fabric") {
    return (
      <Suspense fallback={<BarChartSkeleton />}>
        <LazyFabricChart
          variant="bar"
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
  return <BarChartCustom {...props} />;
}
