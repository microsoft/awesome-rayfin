import { useState } from "react";

import { cn } from "@/lib/utils";
import { usePendingReorders } from "@/hooks/pending-reorders.context";
import { useSendReorder } from "@/hooks/use-send-reorder";
import { Sparkline } from "@/components/charts";
import { ProductDetail } from "@/components/product-detail.component";
import {
    lowStockKey,
    type DemandByProduct,
    type LowStockItem,
    type UnitsOnOrder,
} from "@/queries/regional-dashboard";

interface LowStockQueueProps {
    items: LowStockItem[];
    isLoading: boolean;
    error: string | null;
    demandByProduct: DemandByProduct;
    /** Units already on order per product, as the model reports them. */
    unitsOnOrder: UnitsOnOrder;
    /** Re-reads the queue once the model has caught up. */
    onReorderSent: () => void;
}

export function LowStockQueue({
    items,
    isLoading,
    error,
    demandByProduct,
    unitsOnOrder,
    onReorderSent,
}: LowStockQueueProps) {
    const [opened, setOpened] = useState<LowStockItem | null>(null);

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <header className="flex items-baseline justify-between gap-400 border-b border-border-strong px-500 py-300">
                <div>
                    <h2 className="text-600 leading-600 font-semibold text-foreground">
                        Products running low
                    </h2>
                    <p className="mt-100 text-400 leading-400 text-muted-foreground">
                        Worst first. &ldquo;Running low&rdquo; is defined in the semantic model.
                    </p>
                </div>
                <p className="text-300 leading-300 font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    Days of stock
                </p>
            </header>

            {error ? (
                <p
                    role="alert"
                    className="px-600 py-700 text-400 leading-400 font-semibold text-destructive"
                >
                    Could not read the low-stock queue. {error}
                </p>
            ) : isLoading ? (
                <LoadingRows />
            ) : items.length === 0 ? (
                <p className="px-600 py-700 text-500 leading-500 text-muted-foreground">
                    Nothing is running low across your stores right now.
                </p>
            ) : (
                <ul>
                    {items.map((item, index) => (
                        <LowStockRow
                            key={lowStockKey(item)}
                            item={item}
                            rank={index + 1}
                            demand={demandByProduct.get(lowStockKey(item)) ?? []}
                            unitsOnOrder={unitsOnOrder.get(lowStockKey(item))}
                            onSent={onReorderSent}
                            onOpenDetail={() => setOpened(item)}
                        />
                    ))}
                </ul>
            )}

            {opened && (
                <ProductDetailFor
                    item={opened}
                    unitsOnOrder={unitsOnOrder.get(lowStockKey(opened))}
                    onClose={() => setOpened(null)}
                    onSent={onReorderSent}
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
    onClose,
    onSent,
}: {
    item: LowStockItem;
    unitsOnOrder: number | undefined;
    onClose: () => void;
    onSent: () => void;
}) {
    const send = useSendReorder(item, onSent);
    const { pendingUnits, clearedUnits } = usePendingReorders();

    // Same reasoning as the row it was opened from, or a reset would leave the
    // detail view insisting the product is still on order.
    const onOrder = unitsOnOrderFor(
        unitsOnOrder,
        pendingUnits(item.storeId, item.sku),
        clearedUnits(item.storeId, item.sku),
    );

    return (
        <ProductDetail item={item} unitsOnOrder={onOrder} onClose={onClose} onReorder={send} />
    );
}

type RowState = "idle" | "sending" | "failed";

/**
 * Units on order for a product, as this screen currently believes them.
 *
 * The model is the durable answer — it survives a refresh and counts another
 * manager's open request too. The two local lists cover the half-minute in which
 * it has not caught up: one with a reorder just sent, the other with one just
 * deleted.
 *
 * Cleared units are subtracted rather than clearing the badge outright, so a
 * colleague's open request for the same product keeps it.
 */
function unitsOnOrderFor(
    fromModel: number | undefined,
    justSent: number | undefined,
    justCleared: number,
): number | undefined {
    if (justSent !== undefined) return justSent;

    const remaining = fromModel === undefined ? undefined : fromModel - justCleared;
    return remaining !== undefined && remaining > 0 ? remaining : undefined;
}

interface LowStockRowProps {
    item: LowStockItem;
    rank: number;
    demand: { date: string; value: number }[];
    /** Units the model already counts as on order for this product. */
    unitsOnOrder: number | undefined;
    onSent: () => void;
    onOpenDetail: () => void;
}

function LowStockRow({
    item,
    rank,
    demand,
    unitsOnOrder,
    onSent,
    onOpenDetail,
}: LowStockRowProps) {
    const [units, setUnits] = useState(item.suggestedReorderUnits);
    const [state, setState] = useState<RowState>("idle");
    const [failure, setFailure] = useState<string | null>(null);

    const { pendingUnits, clearedUnits } = usePendingReorders();
    const send = useSendReorder(item, onSent);

    const onOrder = unitsOnOrderFor(
        unitsOnOrder,
        pendingUnits(item.storeId, item.sku),
        clearedUnits(item.storeId, item.sku),
    );

    async function sendReorder() {
        setState("sending");
        setFailure(null);

        try {
            await send(units);
            setState("idle");
        } catch (err) {
            setState("failed");
            const message = err instanceof Error ? err.message : String(err);
            // The row shows the gist; the console keeps the whole thing for
            // whoever has to work out why purchasing said no.
            console.error("[reorder] sendReorder failed", err);
            setFailure(message);
        }
    }

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
            aria-label={`Show detail for ${item.productName} at ${item.storeName}`}
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
                <p className="text-500 leading-500 font-semibold text-balance text-foreground">
                    {item.productName}
                </p>
                <p className="text-400 leading-400 text-muted-foreground">
                    {item.storeName} · {item.sku}
                </p>
            </div>

            <div className="w-[92px] shrink-0">
                <Sparkline
                    series={demand}
                    label={`Daily demand for ${item.productName} at ${item.storeName}`}
                />
            </div>

            <DaysOfStock item={item} muted={onOrder !== undefined} />

            <div className="w-[8ch] shrink-0 text-right">
                <p className="font-numeric text-500 leading-500 font-semibold tabular-nums text-foreground">
                    {item.onHandUnits}
                </p>
                <p className="text-400 leading-400 text-muted-foreground">on hand</p>
            </div>

            <div
                className="flex w-[21ch] shrink-0 flex-col items-end gap-100"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                {onOrder !== undefined ? (
                    <span className="inline-flex items-center gap-200 whitespace-nowrap rounded-full bg-success px-400 py-200 text-400 leading-400 font-bold text-success-foreground">
                        On order · {onOrder} units
                    </span>
                ) : (
                    <div className="flex items-center gap-300">
                        <label className="sr-only" htmlFor={`units-${lowStockKey(item)}`}>
                            Units to reorder for {item.productName} at {item.storeName}
                        </label>
                        <input
                            id={`units-${lowStockKey(item)}`}
                            type="number"
                            min={1}
                            value={units}
                            onChange={(event) => setUnits(Number(event.target.value))}
                            disabled={state === "sending"}
                            className="w-[8ch] rounded-md border border-input bg-background px-300 py-200 text-right font-numeric text-400 leading-400 tabular-nums text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                        <button
                            type="button"
                            onClick={sendReorder}
                            disabled={state === "sending"}
                            className="rounded-md bg-primary px-400 py-200 text-400 leading-400 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
                        >
                            {state === "sending" ? "Sending…" : "Reorder"}
                        </button>
                    </div>
                )}

                {state === "failed" && failure && (
                    <p
                        role="alert"
                        className="max-w-[46ch] text-right text-400 leading-400 font-semibold break-words text-destructive"
                    >
                        Not sent. {shorten(failure)}
                    </p>
                )}
            </div>
        </li>
    );
}

/**
 * The hero value on each row.
 *
 * Urgency is carried by the word, the weight and the bar as well as the colour,
 * so it survives a washed-out projector and colour-blind viewers.
 */
function DaysOfStock({ item, muted }: { item: LowStockItem; muted: boolean }) {
    const isCritical = item.stockStatus === "Critical" && !muted;
    const fill = Math.min(100, Math.max(6, (item.daysOfStock / 7) * 100));

    return (
        <div className="w-[15ch] shrink-0">
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
                    {item.daysOfStock.toFixed(1)}
                </span>
                <span className="text-400 leading-400 text-muted-foreground">days</span>

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
                    {item.stockStatus}
                </span>
            </div>

            <div className="mt-200 h-[8px] w-full overflow-hidden rounded-full bg-muted">
                <div
                    className={cn(
                        "h-full rounded-full",
                        muted ? "bg-border-strong" : isCritical ? "bg-critical" : "bg-warning",
                    )}
                    style={{ width: `${fill}%` }}
                />
            </div>
        </div>
    );
}

/**
 * Function errors arrive verbose. Keep enough on the row to act on — a bare
 * status code sends the reader to the console — but not so much that it takes
 * over the screen. The full error is logged either way.
 */
function shorten(message: string): string {
    const cleaned = message.replace(/\s+/g, " ").trim();
    return cleaned.length > 220 ? `${cleaned.slice(0, 217)}…` : cleaned;
}

function LoadingRows() {
    return (
        <ul aria-hidden>
            {Array.from({ length: 7 }).map((_, i) => (
                <li
                    key={i}
                    className="flex items-center gap-400 border-b border-border px-600 py-500 last:border-b-0"
                >
                    <div className="h-[26px] w-[26px] shrink-0 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] flex-1 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] w-[12ch] shrink-0 animate-pulse rounded-md bg-muted" />
                    <div className="h-[24px] w-[18ch] shrink-0 animate-pulse rounded-md bg-muted" />
                </li>
            ))}
        </ul>
    );
}
