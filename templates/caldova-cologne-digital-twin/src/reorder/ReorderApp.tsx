//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";

import { useI18n } from "@/i18n";
import { sentToday, unitsOnOrder } from "@/reorder-live/live";
import { useSnapshot } from "@/reorder-live/snapshot";
import type { LiveState } from "@/reorder-live/useLive";
import { AppHeader } from "@reorder/components/app-header.component";
import { SummaryTiles } from "@reorder/components/summary-tiles.component";
import { LowStockQueue } from "@reorder/components/low-stock-queue.component";
import { RecentReorders } from "@reorder/components/recent-reorders.component";
import { TrendChart } from "@reorder/components/charts";
import { LiveContext } from "@reorder/hooks/live.context";
import { useFormat } from "@reorder/lib/format";
import { useModelQuery } from "@reorder/hooks/use-model-query";
import {
    demandTrend,
    headlineTiles,
    lowStockTrend,
    indexProductDemand,
    lowStockQueue,
    productDemand,
    type Reorder,
} from "@reorder/queries/regional-dashboard";

/**
 * The original caldova-reorder screen, as the twin's "Reorder" tab.
 *
 * What changed against the original, and why:
 *   · figures come from the baked snapshot instead of the DAX connector, whose delegated Functions
 *     bridge makes the deployed app open ONLY for its owner
 *   · reorders are read and written live through the data client (no Functions), so the original's
 *     pending/cleared reconciliation against the model's mirror lag is gone
 *   · German by default, English on the switch; outside the Fabric portal it is read-only
 */
/** How long the "just sent by you" cue stays, about the original's model mirror lag. */
const JUST_SENT_MS = 30_000;

/** True for `ms` after `at`, then false again on its own (otherwise the cue never clears). */
function useRecently(at: number | null, ms: number): boolean {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (at === null) return;
        setNow(Date.now());
        const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at + ms - Date.now()) + 50);
        return () => clearTimeout(timer);
    }, [at, ms]);
    return at !== null && now - at < ms;
}

export function ReorderApp({ live }: { live: LiveState }) {
    const { t } = useI18n();
    const fmt = useFormat();
    const snapshot = useSnapshot();

    const tiles = useModelQuery(headlineTiles());
    const queue = useModelQuery(lowStockQueue());
    const demand = useModelQuery(demandTrend());
    const perProduct = useModelQuery(productDemand());
    const lowTrend = useModelQuery(lowStockTrend());

    const signedIn = live.signIn?.kind === "signed-in";
    const readOnlyNote =
        live.signIn === null
            ? t("reorder.signingIn")
            : live.signIn.kind === "read-only"
              ? t(`reorder.readOnly.${live.signIn.reason}`)
              : null;

    const onOrder = useMemo(() => unitsOnOrder(live.reorders), [live.reorders]);

    const recent: Reorder[] = useMemo(
        () =>
            live.reorders.map((r) => ({
                requestId: r.id,
                storeName: snapshot?.stores[r.storeId]?.name ?? r.storeId,
                productName: snapshot?.products[r.sku]?.name ?? r.sku,
                units: r.units,
                requestedBy: r.requestedBy,
                requestedAt: r.requestedAt,
            })),
        [live.reorders, snapshot],
    );

    const today = signedIn ? sentToday(live.reorders) : null;
    const justSentToday = useRecently(live.lastSentAt, JUST_SENT_MS) && signedIn;

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

    return (
        <LiveContext.Provider value={live}>
            {/* The arrival flash is motion; honour the reader's reduced-motion setting. */}
            <MotionConfig reducedMotion="user">
            <div className="min-h-full bg-background font-base text-foreground" data-testid="reorder-view">
                <AppHeader
                    asOf={headline?.latestSalesDate ?? null}
                    region={headline?.region ?? null}
                    onReset={() => undefined}
                    readOnlyNote={readOnlyNote}
                />

                <main className="mx-auto max-w-[1680px] px-800 pt-400 pb-600">
                    <SummaryTiles
                        tiles={headline}
                        isLoading={tiles.isLoading}
                        error={tiles.error}
                        lowStockTrend={lowStockSeries}
                        reordersToday={today}
                        justSent={justSentToday}
                    />

                    <div className="mt-500 grid grid-cols-[minmax(0,7fr)_minmax(0,3fr)] items-start gap-500">
                        <LowStockQueue
                            items={queue.rows}
                            isLoading={queue.isLoading}
                            error={queue.error}
                            demandByProduct={demandByProduct}
                            unitsOnOrder={onOrder}
                            readOnlyNote={readOnlyNote}
                        />

                        <div className="grid gap-500">
                            <RecentReorders
                                reorders={recent}
                                isLoading={live.isLoading}
                                error={live.error}
                                justSent={live.justSent}
                                readOnlyNote={signedIn ? null : readOnlyNote}
                            />

                            <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
                                <header className="border-b border-border-strong px-600 py-500">
                                    <h2 className="text-600 leading-600 font-semibold text-foreground">
                                        {t("reorder.demand.title")}
                                    </h2>
                                    <p className="mt-100 text-400 leading-400 text-muted-foreground">
                                        {t("reorder.demand.note")}
                                    </p>
                                </header>
                                <div className="px-500 pt-500 pb-400">
                                    <TrendChart series={demandSeries} label={t("reorder.demand.label")} height={150} />
                                </div>
                            </section>
                        </div>
                    </div>

                    <p className="mt-500 text-400 leading-400 text-muted-foreground">
                        {t("reorder.provenance", { date: headline ? fmt.day(headline.latestSalesDate) : "…" })}
                    </p>
                </main>
            </div>
            </MotionConfig>
        </LiveContext.Provider>
    );
}
