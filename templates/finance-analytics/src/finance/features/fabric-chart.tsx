/**
 * Fabric-backed chart — the Phase B1 adoption of the official Vega charting
 * substrate (`@microsoft/fabric-visuals`' `VegaVisual`). It renders a bar, line or
 * donut from this template's `BarDatum[]` model via a generated Vega-Lite spec,
 * themed with OUR palette (never the SDK's default) through `useVisualTheme()` plus
 * concrete chart colors resolved from CSS, and pairs the SVG with a visually-hidden
 * data table so screen readers get the exact figures the visual encodes.
 *
 * Why adopt it: a Vega selection round-trips into the semantic model and
 * cross-filters every other visual in the Fabric workspace (via `onInteraction`),
 * and the underlying Vega `view` exposes `toImageURL()` for deck image capture —
 * neither of which the custom SVG charts get for free.
 *
 * This module is loaded ONLY behind a lazy boundary (see `bar-chart.tsx` /
 * `line-chart.tsx` / `donut-chart.tsx`, `engine="fabric"`), so `@microsoft/
 * fabric-visuals` and its `vega`/`vega-lite` runtime land in their own async chunk
 * and never touch the initial-load budget. The SDK is an OPTIONAL peer dependency:
 * importing this file requires it to be installed, which every Fabric Apps
 * Analytics host already provides.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { VegaVisual, type VegaVisualHandle } from "@microsoft/fabric-visuals";
import type { BarDatum } from "./bar-chart";
import { useVisualTheme } from "../lib/visual-theme";
import { SrChartTable, chartSummary } from "./chart-shared";
import { chartCaptureRegistry, type CaptureView } from "../lib/chart-capture";
import type { InteractionEvent } from "../data/fabric-interop";
import {
  buildChartSpec,
  toChartData,
  selectionToIndex,
  DEFAULT_ACCENT,
  type FabricChartVariant,
} from "./fabric-chart.specs";

export interface FabricChartProps {
  /** Which official chart to render. */
  variant: FabricChartVariant;
  data: BarDatum[];
  /** Pixel height of the plot area. Default 240. */
  height?: number;
  /** Currency/unit prefix for axis + tooltip formatting (e.g. "$"). */
  valuePrefix?: string;
  /** Convenience: fired when a single category is selected in the visual. */
  onSelect?: (datum: BarDatum, index: number) => void;
  /** Raw official interaction stream, forwarded to the host for cross-filtering. */
  onInteraction?: (events: InteractionEvent[]) => void;
  /** When set, publishes this visual's live Vega view to the chart-capture registry
   *  under this id, so the Deck Builder can embed a pixel-perfect snapshot of it. */
  captureId?: string;
}

/** Fallback categorical palette (mirrors `theme.css` `--color-chart-*`) used before
 *  styles resolve and under SSR, so donut segments are always colored on-theme. */
const PALETTE_FALLBACK = [
  "#0f6cbd", "#0e7a5f", "#b8730a", "#8a63d2",
  "#c23934", "#0e8a8a", "#a8477e", "#5b6b7b",
];

/** Resolve the concrete chart palette + accent from the app's CSS custom
 *  properties. Vega renders SVG presentation attributes (`fill="#…"`) which do not
 *  resolve `var(--…)`, so the colors must be concrete strings — SSR-safe. */
function readChartColors(): { accent: string; palette: string[] } {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { accent: DEFAULT_ACCENT, palette: PALETTE_FALLBACK };
  }
  const cs = getComputedStyle(document.documentElement);
  const palette = PALETTE_FALLBACK.map((fallback, i) => {
    const v = cs.getPropertyValue(`--color-chart-${i + 1}`).trim();
    return v || fallback;
  });
  return { accent: palette[0] || DEFAULT_ACCENT, palette };
}

/**
 * Lazy official-chart renderer. Forwards the underlying `VegaVisualHandle` (so a
 * parent can reach `view.toImageURL()` for deck capture) and keeps chart colors in
 * sync with the live theme by re-reading the CSS palette whenever the visual theme
 * flips (dark mode / high-contrast).
 */
const FabricChart = forwardRef<VegaVisualHandle, FabricChartProps>(function FabricChart(
  { variant, data, height = 240, valuePrefix = "", onSelect, onInteraction, captureId },
  ref,
) {
  const theme = useVisualTheme();
  const innerRef = useRef<VegaVisualHandle>(null);
  useImperativeHandle(ref, () => ({ get view() { return innerRef.current?.view ?? null; } }), []);

  // Publish this visual's live Vega view so the Deck Builder can snapshot it via
  // view.toImageURL(). The getter is late-bound (reads innerRef at capture time),
  // so it always reflects the currently-mounted view even after re-renders.
  useEffect(() => {
    if (!captureId) return;
    return chartCaptureRegistry.register(
      captureId,
      () => (innerRef.current?.view ?? null) as CaptureView | null,
    );
  }, [captureId]);

  // Re-resolve concrete chart colors whenever the theme flips (the palette CSS vars
  // change with the .dark class), so Vega's baked-in fills track the app theme.
  const [colors, setColors] = useState(readChartColors);
  useEffect(() => { setColors(readChartColors()); }, [theme]);

  const spec = useMemo(
    () => buildChartSpec(variant, { valuePrefix, accent: colors.accent, palette: colors.palette }),
    [variant, valuePrefix, colors],
  );
  const chartData = useMemo(() => toChartData(data, valuePrefix), [data, valuePrefix]);

  const handleInteraction = (events: InteractionEvent[]) => {
    onInteraction?.(events);
    if (!onSelect) return;
    for (const ev of events) {
      if (ev.action !== "select") continue;
      for (const selection of ev.selections) {
        const index = selectionToIndex(selection, data);
        if (index !== -1) {
          onSelect(data[index], index);
          return;
        }
      }
    }
  };

  const caption = `${variant[0].toUpperCase()}${variant.slice(1)} chart data`;

  return (
    <div
      className="relative w-full"
      style={{ height }}
      role="group"
      aria-label={`${variant} chart. ${chartSummary(data, valuePrefix)}`}
    >
      <VegaVisual
        ref={innerRef}
        spec={spec}
        theme={theme}
        data={chartData}
        onInteraction={handleInteraction}
        capabilities={{ disableLegendScroll: false }}
        style={{ width: "100%", height: "100%" }}
      />
      <SrChartTable caption={caption} data={data} valuePrefix={valuePrefix} />
    </div>
  );
});

export default FabricChart;
