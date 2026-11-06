//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useCallback, useEffect, useMemo } from "react";

import { AppHeader } from "@/components/app-header.component";
import { SummaryTiles } from "@/components/summary-tiles.component";
import { LowStockQueue } from "@/components/low-stock-queue.component";
import { RecentReorders } from "@/components/recent-reorders.component";
import { TrendChart } from "@/components/charts";
import { useModelQuery } from "@/hooks/use-model-query";
import {
    usePendingReorders,
    type ClearedReorder,
} from "@/hooks/pending-reorders.context";
import {
    demandTrend,
    headlineTiles,
    lowStockTrend,
    indexOpenReorders,
    lowStockKey,
    indexProductDemand,
    lowStockQueue,
    openReorders,
    productDemand,
    recentReorders,
} from "@/queries/regional-dashboard";

/** How often to re-read the model while a reorder is waiting to be mirrored. */
const RECONCILE_INTERVAL_MS = 15_000;

/**
 * One screen: what is running low across the manager's stores, and one action
 * per row to do something about it.
 */
function App() {
    const { pending, cleared, confirmPending, releaseCleared, remove } = usePendingReorders();

    // Keep polling while the screen and the model disagree in either direction:
    // a reorder just sent, or one just deleted that the model still reports.
    const pollMs = pending.length + cleared.length > 0 ? RECONCILE_INTERVAL_MS : undefined;

    const tiles = useModelQuery(headlineTiles(), pollMs);
    const queue = useModelQuery(lowStockQueue());
    const reorders = useModelQuery(recentReorders(), pollMs);
    const demand = useModelQuery(demandTrend());
    const perProduct = useModelQuery(productDemand());
    const onOrder = useModelQuery(openReorders(), pollMs);
    const lowTrend = useModelQuery(lowStockTrend());

    const unitsOnOrder = useMemo(() => indexOpenReorders(onOrder.rows), [onOrder.rows]);

    /**
     * A pending reorder is only handed over once the model reports it in *both*
     * places it is painted: the recent list and the on-order badge. Releasing it
     * as soon as the first query catches up would blink the badge off until the
     * second one followed.
     */
    const reportedByModel = useMemo(
        () => reorders.rows.map((reorder) => reorder.requestId),
        [reorders.rows],
    );

    /**
     * A pending reorder is only released once the model reports it in *both*
     * places it is painted — the recent list and the on-order set. Releasing on
     * the first query to catch up would blink the badge off until the second
     * followed.
     */
    const confirmed = useMemo(() => {
        const reported = new Set(reportedByModel);

        return pending
            .filter(
                (reorder) =>
                    reported.has(reorder.requestId) && unitsOnOrder.has(lowStockKey(reorder)),
            )
            .map((reorder) => reorder.requestId);
    }, [pending, reportedByModel, unitsOnOrder]);

    useEffect(() => {
        confirmPending(confirmed);
    }, [confirmed, confirmPending]);

    useEffect(() => {
        releaseCleared(reportedByModel);
    }, [reportedByModel, releaseCleared]);

    const headline = tiles.rows[0];

    const demandSeries = useMemo(
        () => demand.rows.map((point) => ({ date: point.date, value: point.units })),
        [demand.rows],
    );

    const lowStockSeries = useMemo(
        () => lowTrend.rows.map((point) => ({ date: point.date, value: point.runningLow })),
        [lowTrend.rows],
    );

    const demandByProduct = useMemo(() => indexProductDemand(perProduct.rows), [perProduct.rows]);

    /**
     * After a reset, hide what was deleted and re-read.
     *
     * The re-read alone would put the rows straight back: the model trails the
     * database by about half a minute, so it still reports them. Recording them
     * as cleared first is what makes the reset look like it took.
     */
    const afterReset = useCallback(
        (justCleared: ClearedReorder[]) => {
            remove(justCleared);
            tiles.refresh();
            queue.refresh();
            reorders.refresh();
            onOrder.refresh();
        },
        [remove, tiles, queue, reorders, onOrder],
    );

    /**
     * How far "Reorders sent today" is from what the model can see: reorders
     * sent here that it has not mirrored, less ones deleted here that it still
     * counts. Only rows dated today count either way, because the measure is
     * `Reorders Sent Today` and it works in UTC.
     */
    const todayAdjustment = useMemo(() => {
        const reported = new Set(reportedByModel);
        const today = new Date().toISOString().slice(0, 10);
        const isToday = (at: Date) => at.toISOString().slice(0, 10) === today;

        const notYetCounted = pending.filter(
            (reorder) => !reported.has(reorder.requestId) && isToday(reorder.requestedAt),
        ).length;

        const stillCounted = cleared.filter(
            (reorder) => reported.has(reorder.requestId) && isToday(reorder.requestedAt),
        ).length;

        return notYetCounted - stillCounted;
    }, [pending, cleared, reportedByModel]);

    return (
        <div className="min-h-screen bg-background font-base">
            <AppHeader
                asOf={headline?.latestSalesDate ?? null}
                region={headline?.region ?? null}
                onReset={afterReset}
            />

            <main className="mx-auto max-w-[1680px] px-800 pt-400 pb-600">
                <SummaryTiles
                    tiles={headline}
                    isLoading={tiles.isLoading}
                    error={tiles.error}
                    lowStockTrend={lowStockSeries}
                    todayAdjustment={todayAdjustment}
                />

                <div className="mt-500 grid grid-cols-[minmax(0,7fr)_minmax(0,3fr)] items-start gap-500">
                    <LowStockQueue
                        items={queue.rows}
                        isLoading={queue.isLoading}
                        error={queue.error}
                        demandByProduct={demandByProduct}
                        unitsOnOrder={unitsOnOrder}
                        onReorderSent={queue.refresh}
                    />

                    <div className="grid gap-500">
                        <RecentReorders
                            reorders={reorders.rows}
                            isLoading={reorders.isLoading}
                            error={reorders.error}
                        />

                        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                            <header className="border-b border-border-strong px-600 py-500">
                                <h2 className="text-600 leading-600 font-semibold text-foreground">
                                    Regional demand
                                </h2>
                                <p className="mt-100 text-400 leading-400 text-muted-foreground">
                                    Units sold per day, last fortnight.
                                </p>
                            </header>
                            <div className="px-500 pt-500 pb-400">
                                <TrendChart
                                    series={demandSeries}
                                    label="Units sold per day across the region over the last fortnight"
                                    height={150}
                                />
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
