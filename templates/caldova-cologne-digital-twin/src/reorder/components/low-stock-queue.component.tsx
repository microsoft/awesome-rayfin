//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@reorder/lib/utils";
import { useFormat } from "@reorder/lib/format";
import { canWrite, useLiveContext } from "@reorder/hooks/live.context";
import { useSendReorder } from "@reorder/hooks/use-send-reorder";
import { Sparkline } from "@reorder/components/charts";
import { ProductDetail } from "@reorder/components/product-detail.component";
import {
    lowStockKey,
    type DemandByProduct,
    type LowStockItem,
    type StockStatus,
} from "@reorder/queries/regional-dashboard";

interface LowStockQueueProps {
    items: LowStockItem[];
    isLoading: boolean;
    error: string | null;
    demandByProduct: DemandByProduct;
    /** Units on order per `storeId:sku`, read live from the app database. */
    unitsOnOrder: Map<string, number>;
    /** Why reordering is off, or null when it is on. */
    readOnlyNote: string | null;
}

export function LowStockQueue({
    items,
    isLoading,
    error,
    demandByProduct,
    unitsOnOrder,
    readOnlyNote,
}: LowStockQueueProps) {
    const { t } = useI18n();
    const [opened, setOpened] = useState<LowStockItem | null>(null);

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card" data-testid="reorder-queue">
            <header className="flex items-baseline justify-between gap-400 border-b border-border-strong px-500 py-300">
                <div>
                    <h2 className="text-600 leading-600 font-semibold text-foreground">{t("reorder.queue.title")}</h2>
                    <p className="mt-100 text-400 leading-400 text-muted-foreground">{t("reorder.queue.note")}</p>
                </div>
                <p className="text-300 leading-300 font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {t("reorder.queue.daysHeading")}
                </p>
            </header>

            {error ? (
                <p role="alert" className="px-600 py-700 text-400 leading-400 font-semibold text-destructive">
                    {t("reorder.queue.error", { detail: error })}
                </p>
            ) : isLoading ? (
                <LoadingRows />
            ) : items.length === 0 ? (
                <p className="px-600 py-700 text-500 leading-500 text-muted-foreground">{t("reorder.queue.empty")}</p>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <LowStockRow
                            key={lowStockKey(item)}
                            item={item}
                            rank={index + 1}
                            demand={demandByProduct.get(lowStockKey(item)) ?? []}
                            unitsOnOrder={unitsOnOrder.get(lowStockKey(item))}
                            readOnlyNote={readOnlyNote}
                            onOpenDetail={() => setOpened(item)}
                        />
                    ))}
                </ul>
            )}

            {opened && (
                <ProductDetailFor
                    item={opened}
                    unitsOnOrder={unitsOnOrder.get(lowStockKey(opened))}
                    readOnlyNote={readOnlyNote}
                    onClose={() => setOpened(null)}
                />
            )}
        </section>
    );
}

/**
 * Bridges the detail view to the shared send path, so a reorder placed after
 * studying the numbers behaves exactly like the one-click reorder on the row.
 */
function ProductDetailFor({
    item,
    unitsOnOrder,
    readOnlyNote,
    onClose,
}: {
    item: LowStockItem;
    unitsOnOrder: number | undefined;
    readOnlyNote: string | null;
    onClose: () => void;
}) {
    const send = useSendReorder(item, noop);
    return (
        <ProductDetail
            item={item}
            unitsOnOrder={unitsOnOrder}
            readOnlyNote={readOnlyNote}
            onClose={onClose}
            onReorder={send}
        />
    );
}

function noop() {}

type RowState = "idle" | "sending" | "failed";

interface LowStockRowProps {
    item: LowStockItem;
    rank: number;
    demand: { date: string; value: number }[];
    /** Units on order for this pharmacy and product, if any. */
    unitsOnOrder: number | undefined;
    readOnlyNote: string | null;
    onOpenDetail: () => void;
}

function LowStockRow({ item, rank, demand, unitsOnOrder, readOnlyNote, onOpenDetail }: LowStockRowProps) {
    const { t } = useI18n();
    const fmt = useFormat();
    const live = useLiveContext();
    const [units, setUnits] = useState(item.suggestedReorderUnits);
    const [state, setState] = useState<RowState>("idle");
    const [failure, setFailure] = useState<string | null>(null);

    const send = useSendReorder(item, noop);
    const writable = canWrite(live);
    const onOrder = unitsOnOrder !== undefined && unitsOnOrder > 0 ? unitsOnOrder : undefined;

    async function sendReorder() {
        if (!Number.isInteger(units) || units < 1) {
            setState("failed");
            setFailure(t("reorder.invalidUnits"));
            return;
        }
        setState("sending");
        setFailure(null);

        try {
            await send(units);
            setState("idle");
        } catch (err) {
            setState("failed");
            const message = err instanceof Error ? err.message : String(err);
            console.error("[reorder] send failed", err);
            setFailure(message);
        }
    }

    const names = { product: item.productName, store: item.storeName };

    return (
        <li
            // The whole row opens the detail view, because that is what a manager
            // reaches for when the suggested quantity is not obviously right. The
            // reorder controls stop the event, so the one-click path is untouched.
            onClick={onOpenDetail}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenDetail();
                }
            }}
            role="button"
            tabIndex={0}
            data-testid={`queue-${item.storeId}-${item.sku}`}
            aria-label={t("reorder.queue.openDetail", names)}
            className={cn(
                "flex cursor-pointer items-center gap-400 border-b border-border px-500 py-200 transition-colors last:border-b-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                onOrder !== undefined ? "bg-success-surface/50" : "hover:bg-hover",
            )}
        >
            <span
                aria-hidden
                className={cn(
                    "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md font-numeric text-400 font-bold tabular-nums",
                    onOrder !== undefined ? "bg-muted text-muted-foreground" : "bg-primary-surface text-primary",
                )}
            >
                {rank}
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-500 leading-500 font-semibold text-balance text-foreground">{item.productName}</p>
                <p className="text-400 leading-400 text-muted-foreground">
                    {item.storeName} · {item.sku}
                </p>
            </div>

            <div className="w-[92px] shrink-0">
                <Sparkline series={demand} label={t("reorder.queue.demandLabel", names)} />
            </div>

            <DaysOfStock item={item} muted={onOrder !== undefined} />

            <div className="min-w-[8ch] shrink-0 whitespace-nowrap text-right">
                <p className="font-numeric text-500 leading-500 font-semibold tabular-nums text-foreground">
                    {fmt.int(item.onHandUnits)}
                </p>
                <p className="text-400 leading-400 text-muted-foreground">{t("reorder.queue.onHand")}</p>
            </div>

            <div
                className="flex min-w-[26ch] shrink-0 flex-col items-end gap-100"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                {onOrder !== undefined ? (
                    <span
                        data-testid="on-order"
                        className="inline-flex items-center gap-200 whitespace-nowrap rounded-full bg-success px-400 py-200 text-400 leading-400 font-bold text-success-foreground"
                    >
                        {t("reorder.queue.onOrder", { units: fmt.int(onOrder) })}
                    </span>
                ) : (
                    <div className="flex items-center gap-300" title={writable ? undefined : (readOnlyNote ?? undefined)}>
                        <label className="sr-only" htmlFor={`units-${lowStockKey(item)}`}>
                            {t("reorder.queue.unitsLabel", names)}
                        </label>
                        <input
                            id={`units-${lowStockKey(item)}`}
                            type="number"
                            min={1}
                            step={1}
                            value={units}
                            onChange={(event) => setUnits(Number(event.target.value))}
                            disabled={state === "sending" || !writable}
                            className="w-[8ch] rounded-md border border-input bg-background px-300 py-200 text-right font-numeric text-400 leading-400 tabular-nums text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                        <button
                            type="button"
                            data-testid="reorder-send"
                            onClick={sendReorder}
                            disabled={state === "sending" || !writable}
                            className="rounded-md bg-primary px-400 py-200 text-400 leading-400 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {state === "sending" ? t("reorder.sending") : t("reorder.queue.send")}
                        </button>
                    </div>
                )}

                {state === "failed" && failure && (
                    <p
                        role="alert"
                        className="max-w-[46ch] text-right text-400 leading-400 font-semibold break-words text-destructive"
                    >
                        {t("reorder.notSent", { detail: shorten(failure) })}
                    </p>
                )}
            </div>
        </li>
    );
}

const STATUS_KEY: Record<StockStatus, string> = {
    Critical: "reorder.status.critical",
    Low: "reorder.status.low",
    Healthy: "reorder.status.healthy",
};

/**
 * The hero value on each row.
 *
 * Urgency is carried by the word, the weight and the bar as well as the colour,
 * so it survives a washed-out projector and colour-blind viewers.
 */
function DaysOfStock({ item, muted }: { item: LowStockItem; muted: boolean }) {
    const { t } = useI18n();
    const fmt = useFormat();
    const isCritical = item.stockStatus === "Critical" && !muted;
    const fill = Math.min(100, Math.max(6, (item.daysOfStock / 7) * 100));

    return (
        <div className="w-[21ch] shrink-0">
            <div className="flex items-baseline gap-200">
                <span
                    className={cn(
                        "font-numeric text-hero-700 leading-hero-700 tabular-nums",
                        muted
                            ? "font-semibold text-muted-foreground"
                            : isCritical
                              ? "font-bold text-critical"
                              : "font-semibold text-foreground",
                    )}
                >
                    {fmt.dec1(item.daysOfStock)}
                </span>
                <span className="text-400 leading-400 text-muted-foreground">{t("reorder.days")}</span>

                <span
                    className={cn(
                        "ml-auto rounded-full px-300 py-100 text-300 leading-300 font-bold uppercase tracking-wide",
                        muted
                            ? "bg-muted text-muted-foreground"
                            : isCritical
                              ? "bg-critical text-critical-foreground"
                              : "bg-warning-surface text-warning",
                    )}
                >
                    {t(STATUS_KEY[item.stockStatus] ?? "reorder.status.low")}
                </span>
            </div>

            <div className="mt-200 h-[8px] w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn("h-full rounded-full", muted ? "bg-border-strong" : isCritical ? "bg-critical" : "bg-warning")}
                    style={{ width: `${fill}%` }}
                />
            </div>
        </div>
    );
}

/**
 * Errors arrive verbose. Keep enough on the row to act on, but not so much that
 * it takes over the screen. The full error is logged either way.
 */
function shorten(message: string): string {
    const cleaned = message.replace(/\s+/g, " ").trim();
    return cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
}

function LoadingRows() {
    return (
        <ul aria-hidden>
            {Array.from({ length: 7 }).map((_, i) => (
                <li key={i} className="flex items-center gap-400 border-b border-border px-600 py-500 last:border-b-0">
                    <div className="h-[26px] w-[26px] shrink-0 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] flex-1 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] w-[12ch] shrink-0 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] w-[18ch] shrink-0 animate-pulse rounded-md bg-muted" />
                </li>
            ))}
        </ul>
    );
}
