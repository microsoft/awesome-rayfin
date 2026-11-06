import { useRef, type ReactNode } from "react";

import { NUMBER_LOCALE, useI18n } from "@/i18n";
import { cn } from "@reorder/lib/utils";
import { useElementWidth } from "@reorder/hooks/use-element-width";
import { SparklineSvg, TrendSvg } from "./line-chart";

/**
 * Chart wrappers with the same sizing contract everywhere.
 *
 * Phase 5a: the faceted store panels were Vega views (`@microsoft/fabric-visuals`), which the twin
 * does not ship. They are drawn with the original's own SVG sparkline instead, which its line-chart
 * notes already preferred ("plain SVG has no lifecycle to get stuck in").
 */
export interface SeriesPoint {
    date: string;
    value: number;
}

interface ChartProps {
    series: SeriesPoint[];
    label: string;
}

export interface TrendChartProps extends ChartProps {
    height?: number;
    valueTitle?: string;
}

export interface FacetSeries {
    storeId: string;
    storeName: string;
    isCritical: boolean;
    isFocused: boolean;
    /** Days of cover now, for the worst-first order and the panel's figure. */
    cover: number;
    points: SeriesPoint[];
}

export interface SmallMultiplesProps {
    series: FacetSeries[];
    label: string;
    columns?: number;
    /** How many panels at most; the focused pharmacy is always among them. */
    limit?: number;
    formatCover: (days: number) => string;
}

const NAVY = "#1B3658";
const CRITICAL = "#A11B14";

function NoData({ height }: { height: number }) {
    const { t } = useI18n();
    return (
        <div
            style={{ height }}
            className="flex items-center justify-center rounded-md bg-muted/60 text-400 leading-400 font-medium text-muted-foreground"
        >
            {t("reorder.noData")}
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
                    locale={NUMBER_LOCALE}
                />
            )}
        </div>
    );
}

/**
 * One small panel per pharmacy, worst cover first. Cologne has 120 partner pharmacies where the
 * original region had 15, so the grid shows the `limit` worst plus the one being looked at.
 */
export function SmallMultiples({ series, label, columns = 5, limit = 20, formatCover }: SmallMultiplesProps) {
    if (series.length === 0) {
        return <NoData height={120} />;
    }

    const worst = [...series].sort((a, b) => a.cover - b.cover);
    const shown = worst.slice(0, limit);
    const focused = worst.find((s) => s.isFocused);
    if (focused && !shown.includes(focused)) shown[shown.length - 1] = focused;

    return (
        <div
            role="list"
            aria-label={label}
            className="grid gap-300"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
            {shown.map((facet) => (
                <div
                    role="listitem"
                    key={facet.storeId}
                    className={cn(
                        "rounded-md border px-300 py-200",
                        facet.isFocused ? "border-primary bg-primary-surface" : "border-border bg-background",
                    )}
                >
                    <div className="flex items-baseline justify-between gap-200">
                        <p
                            className={cn(
                                "min-w-0 truncate text-200 leading-200 text-foreground",
                                facet.isFocused ? "font-bold" : "font-medium",
                            )}
                            title={facet.storeName}
                        >
                            {facet.storeName.replace(/^Caldova Partner-/, "")}
                        </p>
                        <p
                            className={cn(
                                "shrink-0 font-numeric text-200 leading-200 font-bold tabular-nums",
                                facet.isCritical ? "text-critical" : "text-muted-foreground",
                            )}
                        >
                            {formatCover(facet.cover)}
                        </p>
                    </div>
                    <div className="mt-100">
                        <SparklineSvg
                            series={facet.points}
                            height={34}
                            label={facet.storeName}
                            colour={facet.isCritical ? CRITICAL : NAVY}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
