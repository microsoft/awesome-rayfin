//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@reorder/lib/utils";
import { useFormat } from "@reorder/lib/format";
import { Sparkline, type SeriesPoint } from "@reorder/components/charts";
import type { HeadlineTiles } from "@reorder/queries/regional-dashboard";

interface SummaryTilesProps {
    tiles: HeadlineTiles | undefined;
    isLoading: boolean;
    error: string | null;
    /** Pharmacy and product pairs running low on each of the last seven days. */
    lowStockTrend: SeriesPoint[];
    /**
     * Reorders sent today (UTC), read live from the app database. `null` when the tab is read-only:
     * the number needs a session, and a zero would be a claim rather than an absence.
     */
    reordersToday: number | null;
    /** Whether one of today's reorders was sent from this page, for the original's green cue. */
    justSent: boolean;
}

export function SummaryTiles({
    tiles,
    isLoading,
    error,
    lowStockTrend,
    reordersToday,
    justSent,
}: SummaryTilesProps) {
    const { t } = useI18n();

    if (error) {
        return (
            <div
                role="alert"
                className="rounded-xl border border-destructive bg-destructive-surface px-600 py-500 text-400 leading-400 text-destructive"
            >
                {t("reorder.tiles.error", { detail: error })}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-3 gap-500" data-testid="reorder-tiles">
            <Tile
                label={t("reorder.tiles.stores")}
                value={tiles?.storesInRegion}
                isLoading={isLoading}
                caption={t("reorder.tiles.storesCaption")}
            />
            <Tile
                label={t("reorder.tiles.low")}
                value={tiles?.productsRunningLow}
                isLoading={isLoading}
                caption={t("reorder.tiles.lowCaption")}
                tone="critical"
                chart={<Sparkline series={lowStockTrend} label={t("reorder.tiles.lowTrend")} />}
            />
            <Tile
                label={t("reorder.tiles.today")}
                value={reordersToday ?? undefined}
                unavailable={reordersToday === null ? t("reorder.tiles.todayReadOnly") : undefined}
                isLoading={false}
                caption={justSent ? t("reorder.tiles.todayJustSent") : t("reorder.tiles.todayCaption")}
                highlight={justSent}
            />
        </div>
    );
}

interface TileProps {
    label: string;
    value: number | undefined;
    /** Said in place of the number when there is none to show. */
    unavailable?: string;
    isLoading: boolean;
    caption: string;
    tone?: "default" | "critical";
    chart?: ReactNode;
    highlight?: boolean;
}

function Tile({ label, value, unavailable, isLoading, caption, tone = "default", chart, highlight }: TileProps) {
    const fmt = useFormat();
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
                        {unavailable ? (
                            <span className="text-400 leading-400 font-semibold text-muted-foreground">{unavailable}</span>
                        ) : isLoading || value === undefined ? (
                            <span className="inline-block h-[40px] w-[4ch] animate-pulse rounded-md bg-muted align-middle" />
                        ) : (
                            fmt.int(value)
                        )}
                    </div>
                    <p className="mt-100 text-400 leading-400 text-muted-foreground">{caption}</p>
                </div>

                {chart && <div className="w-[52%] min-w-0 pb-200">{chart}</div>}
            </div>
        </div>
    );
}
