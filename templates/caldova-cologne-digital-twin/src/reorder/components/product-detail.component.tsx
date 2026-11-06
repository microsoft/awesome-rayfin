//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@reorder/lib/utils";
import { useFormat } from "@reorder/lib/format";
import { canWrite, useLiveContext } from "@reorder/hooks/live.context";
import { useModelQuery } from "@reorder/hooks/use-model-query";
import { SmallMultiples, type FacetSeries } from "@reorder/components/charts";
import {
    forPeriod,
    groupByStore,
    salesRate,
    stockByStore,
    type LowStockItem,
    type Period,
} from "@reorder/queries";

interface ProductDetailProps {
    item: LowStockItem;
    /** Units already on order for this product at this pharmacy, if any. */
    unitsOnOrder: number | undefined;
    /** Why reordering is off, or null when it is on. */
    readOnlyNote: string | null;
    onClose: () => void;
    onReorder: (units: number) => Promise<void>;
}

/**
 * Everything needed to decide how many units to order.
 *
 * The queue answers "what is running low"; this answers "how bad, how fast, and
 * what is happening in the other pharmacies", the three things that turn a
 * suggested quantity into a decision.
 */
export function ProductDetail({ item, unitsOnOrder, readOnlyNote, onClose, onReorder }: ProductDetailProps) {
    const { t } = useI18n();
    const fmt = useFormat();
    const live = useLiveContext();
    const writable = canWrite(live);
    const [period, setPeriod] = useState<Period>("week");
    const [units, setUnits] = useState(item.suggestedReorderUnits);
    const [sending, setSending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const dialogRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    const rate = useModelQuery(useMemo(() => salesRate(item.sku, item.storeId), [item]));
    const stock = useModelQuery(useMemo(() => stockByStore(item.sku), [item]));

    useDismissOnEscape(onClose);
    useFocusOnOpen(closeRef);

    const figures = rate.rows[0];
    const perPeriod = figures ? forPeriod(figures, period) : null;

    const facets: FacetSeries[] = useMemo(
        () =>
            groupByStore(stock.rows).map((series) => ({
                storeId: series.storeId,
                storeName: series.storeName,
                isCritical: series.currentCover < (figures?.thresholdDays ?? 7),
                isFocused: series.storeId === item.storeId,
                cover: series.currentCover,
                points: series.points,
            })),
        [stock.rows, figures, item.storeId],
    );

    async function send() {
        if (!Number.isInteger(units) || units < 1) {
            setFailure(t("reorder.invalidUnits"));
            return;
        }
        setSending(true);
        setFailure(null);

        try {
            await onReorder(units);
            onClose();
        } catch (err) {
            setSending(false);
            setFailure(err instanceof Error ? err.message : String(err));
        }
    }

    const names = { product: item.productName, store: item.storeName };
    const onOrder = unitsOnOrder !== undefined && unitsOnOrder > 0 ? unitsOnOrder : undefined;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-500"
            onMouseDown={(event) => {
                if (!dialogRef.current?.contains(event.target as Node)) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t("reorder.detail.label", names)}
                data-testid="reorder-detail"
                className="w-full max-w-[1180px] rounded-xl border border-border bg-card shadow-raised"
            >
                <header className="flex items-start justify-between gap-500 border-b border-border-strong px-700 py-400">
                    <div className="min-w-0">
                        <h2 className="text-hero-700 leading-hero-700 font-bold text-foreground">{item.productName}</h2>
                        <p className="mt-100 text-500 leading-500 text-muted-foreground">
                            {item.storeName} · {item.sku}
                        </p>
                    </div>

                    <button
                        ref={closeRef}
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-input px-400 py-200 text-400 leading-400 font-semibold text-foreground hover:bg-hover focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {t("reorder.detail.close")}
                    </button>
                </header>

                <div className="px-700 py-400">
                    <div className="flex items-center justify-between gap-500">
                        <PeriodToggle period={period} onChange={setPeriod} />
                        <p className="text-400 leading-400 text-muted-foreground">{t("reorder.detail.source")}</p>
                    </div>

                    {rate.error && (
                        <p role="alert" className="mt-300 text-400 font-semibold text-destructive">
                            {t("reorder.detail.rateError", { detail: rate.error })}
                        </p>
                    )}

                    <div className="mt-400 grid grid-cols-4 gap-400">
                        <Figure
                            label={t("reorder.detail.soldHere")}
                            value={perPeriod ? fmt.dec1(perPeriod.store) : null}
                            unit={t("reorder.detail.perDay")}
                        />
                        <Figure
                            label={t("reorder.detail.soldRegion")}
                            value={perPeriod ? fmt.dec1(perPeriod.region) : null}
                            unit={t("reorder.detail.perDay")}
                        />
                        <Figure
                            label={t("reorder.detail.coverHere")}
                            value={figures ? fmt.dec1(figures.daysOfStock) : null}
                            unit={t("reorder.days")}
                            tone="critical"
                        />
                        <Figure
                            label={t("reorder.detail.suggested")}
                            value={figures ? fmt.int(figures.suggestedUnits) : null}
                            unit={
                                figures
                                    ? t("reorder.detail.toReach", { days: fmt.int(figures.targetCoverDays) })
                                    : t("reorder.units")
                            }
                        />
                    </div>

                    <section className="mt-500">
                        <div className="flex items-baseline justify-between gap-400">
                            <h3 className="text-500 leading-500 font-semibold text-foreground">
                                {t("reorder.detail.stockTitle")}
                            </h3>
                            <p className="text-400 leading-400 text-muted-foreground">{t("reorder.detail.stockNote")}</p>
                        </div>

                        {stock.error ? (
                            <p role="alert" className="mt-400 text-400 font-semibold text-destructive">
                                {t("reorder.detail.stockError", { detail: stock.error })}
                            </p>
                        ) : (
                            <div className="mt-300">
                                <SmallMultiples
                                    series={facets}
                                    label={t("reorder.detail.stockChart", { product: item.productName })}
                                    formatCover={(days) => t("reorder.detail.coverShort", { days: fmt.dec1(days) })}
                                />
                            </div>
                        )}

                        <p className="mt-300 text-400 leading-400 text-muted-foreground">{t("reorder.detail.estimated")}</p>
                    </section>
                </div>

                <footer className="flex items-center justify-between gap-500 border-t border-border-strong bg-secondary px-700 py-400">
                    {onOrder !== undefined ? (
                        <p className="text-500 leading-500 font-semibold text-success">
                            {t("reorder.detail.alreadyOnOrder", { units: fmt.int(onOrder) })}
                        </p>
                    ) : (
                        <div className="flex items-center gap-300" title={writable ? undefined : (readOnlyNote ?? undefined)}>
                            <label htmlFor="detail-units" className="text-400 leading-400 font-semibold text-foreground">
                                {t("reorder.detail.unitsToOrder")}
                            </label>
                            <input
                                id="detail-units"
                                type="number"
                                min={1}
                                step={1}
                                value={units}
                                onChange={(event) => setUnits(Number(event.target.value))}
                                disabled={sending || !writable}
                                className="w-[9ch] rounded-md border border-input bg-background px-300 py-200 text-right font-numeric text-500 leading-500 tabular-nums text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                            />
                            <button
                                type="button"
                                onClick={send}
                                disabled={sending || !writable}
                                className="rounded-md bg-primary px-500 py-200 text-500 leading-500 font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {sending ? t("reorder.sending") : t("reorder.detail.send")}
                            </button>
                        </div>
                    )}

                    {failure ? (
                        <p
                            role="alert"
                            className="max-w-[52ch] text-right text-400 leading-400 font-semibold break-words text-destructive"
                        >
                            {t("reorder.notSent", { detail: failure })}
                        </p>
                    ) : (
                        !writable &&
                        readOnlyNote && <p className="max-w-[52ch] text-right text-400 leading-400 text-muted-foreground">{readOnlyNote}</p>
                    )}
                </footer>
            </div>
        </div>
    );
}

function PeriodToggle({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
    const { t } = useI18n();
    return (
        <div className="inline-flex rounded-md border border-input p-100" role="group">
            {(["week", "month"] as const).map((option) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onChange(option)}
                    aria-pressed={period === option}
                    className={cn(
                        "rounded-[4px] px-400 py-200 text-400 leading-400 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                        period === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-hover",
                    )}
                >
                    {option === "week" ? t("reorder.detail.last7") : t("reorder.detail.last28")}
                </button>
            ))}
        </div>
    );
}

function Figure({
    label,
    value,
    unit,
    tone = "default",
}: {
    label: string;
    value: string | null;
    unit: string;
    tone?: "default" | "critical";
}) {
    return (
        <div className="rounded-xl border border-border bg-background px-500 py-300">
            <p className="text-300 leading-300 font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
            <p
                className={cn(
                    "mt-200 font-numeric text-hero-700 leading-hero-700 font-bold tabular-nums",
                    tone === "critical" ? "text-critical" : "text-foreground",
                )}
            >
                {value ?? <span className="inline-block h-[32px] w-[3ch] animate-pulse rounded-md bg-muted align-middle" />}
            </p>
            <p className="text-400 leading-400 text-muted-foreground">{unit}</p>
        </div>
    );
}

function useDismissOnEscape(onClose: () => void) {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onClose]);
}

/** Move focus into the dialog on open, and hand it back to the page on close. */
function useFocusOnOpen(target: React.RefObject<HTMLElement | null>) {
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        target.current?.focus();

        return () => previous?.focus();
    }, [target]);
}
