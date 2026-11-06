import { lazy, Suspense, useRef, type ReactNode } from "react";

import { useElementWidth } from "@/hooks/use-element-width";
import { SparklineSvg, TrendSvg } from "./line-chart";

/**
 * Chart entry points.
 *
 * The small line charts are plain SVG — see `line-chart.tsx` for why. Vega is
 * kept for the fifteen-panel faceted grid, which would be real work by hand, and
 * is loaded only when the detail view opens rather than on first paint.
 */

const VegaCharts = lazy(() => import("./vega-charts"));

export interface SeriesPoint {
    /** ISO date, as the model returns it. */
    date: string;
    value: number;
}

interface ChartProps {
    series: SeriesPoint[];
    /** Accessible description; charts carry no tooltips, so this is the fallback. */
    label: string;
}

export interface TrendChartProps extends ChartProps {
    height?: number;
    valueTitle?: string;
}

/** One store's stock history, for the small-multiples grid. */
export interface FacetSeries {
    storeId: string;
    storeName: string;
    /** Drawn in the urgency colour when the store is below the threshold. */
    isCritical: boolean;
    /** The store the manager opened this from, drawn heavier. */
    isFocused: boolean;
    points: SeriesPoint[];
}

export interface SmallMultiplesProps {
    series: FacetSeries[];
    label: string;
    columns?: number;
}

const NAVY = "#1B3658";

/**
 * Says so when there is nothing to draw.
 *
 * An empty series used to render as a flat line, which reads as "demand is
 * steady" rather than "this query returned nothing" — the wrong message, and
 * indistinguishable from real data on a projector.
 */
function NoData({ height }: { height: number }) {
    return (
        <div
            style={{ height }}
            className="flex items-center justify-center rounded-md bg-muted/60 text-400 leading-400 font-medium text-muted-foreground"
        >
            No data
        </div>
    );
}

function Reserved({ height, children }: { height: number; children?: ReactNode }) {
    return (
        <div style={{ height }} className="flex items-end" aria-hidden>
            {children}
        </div>
    );
}

export function Sparkline({ series, label }: ChartProps) {
    const height = 36;

    if (series.length === 0) return <NoData height={height} />;

    return <SparklineSvg series={series} height={height} label={label} colour={NAVY} />;
}

export function TrendChart({ series, label, height = 168 }: TrendChartProps) {
    const host = useRef<HTMLDivElement>(null);
    const width = useElementWidth(host);

    return (
        <div ref={host} className="w-full">
            {series.length === 0 ? (
                <NoData height={height} />
            ) : width === undefined ? (
                <Reserved height={height} />
            ) : (
                <TrendSvg
                    series={series}
                    width={width}
                    height={height}
                    label={label}
                    colour={NAVY}
                />
            )}
        </div>
    );
}

/**
 * Fifteen stores at once.
 *
 * Drawn as one faceted spec rather than fifteen chart instances — the same
 * picture, a fraction of the work — and as small multiples rather than fifteen
 * overlapping lines, which is unreadable at the back of a room.
 *
 * Panels are a fixed width, so this chart never had the container-measuring
 * problem the line charts did.
 */
export function SmallMultiples({ series, label, columns = 5 }: SmallMultiplesProps) {
    if (series.length === 0) {
        return <NoData height={120} />;
    }

    return (
        <Suspense fallback={<Reserved height={318} />}>
            <VegaCharts kind="facet" facets={series} label={label} height={68} columns={columns} />
        </Suspense>
    );
}
