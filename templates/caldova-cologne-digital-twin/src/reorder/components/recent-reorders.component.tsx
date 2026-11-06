//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { AnimatePresence, motion } from "framer-motion";

import { useI18n } from "@/i18n";
import { useFormat } from "@reorder/lib/format";
import type { Reorder } from "@reorder/queries/regional-dashboard";

interface RecentReordersProps {
    /** Newest first, read live from the app database (Phase 5a), names from the snapshot. */
    reorders: Reorder[];
    isLoading: boolean;
    error: string | null;
    /** Ids sent from this page, for the single arrival flash. */
    justSent: ReadonlySet<string>;
    /** Why the list cannot be read (no session), or null. */
    readOnlyNote: string | null;
}

const MAX_ROWS = 6;

export function RecentReorders({ reorders, isLoading, error, justSent, readOnlyNote }: RecentReordersProps) {
    const { t } = useI18n();
    const rows = reorders.slice(0, MAX_ROWS);

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card" data-testid="reorder-recent">
            <header className="border-b border-border-strong px-600 py-500">
                <h2 className="text-600 leading-600 font-semibold text-foreground">{t("reorder.recent.title")}</h2>
                <p className="mt-100 text-400 leading-400 text-muted-foreground">{t("reorder.recent.note")}</p>
            </header>

            {readOnlyNote ? (
                <p className="px-600 py-700 text-400 leading-400 text-muted-foreground">{readOnlyNote}</p>
            ) : error ? (
                <p role="alert" className="px-600 py-700 text-400 leading-400 font-semibold text-destructive">
                    {t("reorder.recent.error", { detail: error })}
                </p>
            ) : isLoading && rows.length === 0 ? (
                <p className="px-600 py-700 text-400 leading-400 text-muted-foreground">{t("reorder.recent.loading")}</p>
            ) : rows.length === 0 ? (
                <p className="px-600 py-700 text-500 leading-500 text-muted-foreground">{t("reorder.recent.empty")}</p>
            ) : (
                <ul>
                    <AnimatePresence initial={false}>
                        {rows.map((reorder) => (
                            <ReorderRow key={reorder.requestId} reorder={reorder} isNew={justSent.has(reorder.requestId)} />
                        ))}
                    </AnimatePresence>
                </ul>
            )}
        </section>
    );
}

function ReorderRow({ reorder, isNew }: { reorder: Reorder; isNew: boolean }) {
    const { t } = useI18n();
    const fmt = useFormat();
    return (
        <motion.li
            layout
            initial={isNew ? { opacity: 0, height: 0 } : false}
            animate={{
                opacity: 1,
                height: "auto",
                // A single, deliberate flash: unmistakable from the back of the
                // room, and over inside a second.
                backgroundColor: isNew ? ["var(--color-success)", "var(--color-card)"] : "var(--color-card)",
            }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="border-b border-border px-600 py-400 last:border-b-0"
        >
            <div className="flex items-baseline justify-between gap-400">
                <p className="min-w-0 flex-1 text-500 leading-500 font-semibold text-foreground">{reorder.productName}</p>
                <p className="shrink-0 font-numeric text-500 leading-500 font-bold tabular-nums text-foreground">
                    {fmt.int(reorder.units)}
                    <span className="ml-100 text-400 font-medium text-muted-foreground">{t("reorder.units")}</span>
                </p>
            </div>
            <p className="mt-100 text-400 leading-400 text-muted-foreground">
                {reorder.storeName} · {reorder.requestedBy}
            </p>
            <p className="text-400 leading-400 text-muted-foreground">
                {fmt.when(reorder.requestedAt) || t("reorder.recent.justNow")}
            </p>
        </motion.li>
    );
}
