import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Sparkline, type SeriesPoint } from "@/components/charts";
import type { HeadlineTiles } from "@/queries/regional-dashboard";

interface SummaryTilesProps {
    tiles: HeadlineTiles | undefined;
    isLoading: boolean;
    error: string | null;
    /** Products running low on each of the last seven days. */
    lowStockTrend: SeriesPoint[];
    /**
     * How far today's count is from the model's: reorders sent here it has not
     * mirrored, less ones deleted here it still counts. Can be negative.
     */
    todayAdjustment: number;
}

export function SummaryTiles({
    tiles,
    isLoading,
    error,
    lowStockTrend,
    todayAdjustment,
}: SummaryTilesProps) {
    if (error) {
        return (
            <div
                role="alert"
                className="rounded-xl border border-destructive bg-destructive-surface px-600 py-500 text-400 leading-400 text-destructive"
            >
                Could not read the headline numbers from the semantic model. {error}
            </div>
        );
    }

    const reordersToday =
        tiles === undefined
            ? undefined
            : Math.max(0, tiles.reordersSentToday + todayAdjustment);

    return (
        <div className="grid grid-cols-3 gap-500">
            <Tile
                label="Stores in region"
                value={tiles?.storesInRegion}
                isLoading={isLoading}
                caption="Covered by you"
            />
            <Tile
                label="Products running low"
                value={tiles?.productsRunningLow}
                isLoading={isLoading}
                caption="Under a week of stock"
                tone="critical"
                chart={
                    <Sparkline
                        series={lowStockTrend}
                        label="Products running low on each of the last seven days"
                    />
                }
            />
            <Tile
                label="Reorders sent today"
                value={reordersToday}
                isLoading={isLoading}
                caption={todayAdjustment > 0 ? "Just sent by you" : "Since midnight, UTC"}
                highlight={todayAdjustment > 0}
            />
        </div>
    );
}

interface TileProps {
    label: string;
    value: number | undefined;
    isLoading: boolean;
    caption: string;
    tone?: "default" | "critical";
    chart?: ReactNode;
    highlight?: boolean;
}

function Tile({ label, value, isLoading, caption, tone = "default", chart, highlight }: TileProps) {
    return (
        <div
            className={cn(
                "overflow-hidden rounded-xl border bg-card px-600 py-400 shadow-card transition-colors duration-500",
                highlight ? "border-success" : "border-border",
            )}
        >
            <p className="text-300 leading-300 font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {label}
            </p>

            <div className="mt-200 flex items-end justify-between gap-500">
                <div className="min-w-0">
                    <div
                        className={cn(
                            "font-numeric text-hero-800 leading-hero-800 font-bold tabular-nums",
                            tone === "critical" ? "text-critical" : "text-foreground",
                        )}
                    >
                        {isLoading || value === undefined ? (
                            <span className="inline-block h-[40px] w-[4ch] animate-pulse rounded-md bg-muted align-middle" />
                        ) : (
                            value.toLocaleString()
                        )}
                    </div>
                    <p className="mt-100 text-400 leading-400 text-muted-foreground">{caption}</p>
                </div>

                {chart && <div className="w-[52%] min-w-0 pb-200">{chart}</div>}
            </div>
        </div>
    );
}
