import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { usePendingReorders } from "@/hooks/pending-reorders.context";
import type { Reorder } from "@/queries/regional-dashboard";

interface RecentReordersProps {
    reorders: Reorder[];
    isLoading: boolean;
    error: string | null;
}

const MAX_ROWS = 6;

export function RecentReorders({ reorders, isLoading, error }: RecentReordersProps) {
    const { pending, cleared } = usePendingReorders();

    /**
     * What the model reports, plus anything sent in this session that it has not
     * mirrored yet. Pending entries are dropped as the model picks them up, so a
     * reorder is shown once and only once.
     */
    const rows = useMemo(() => {
        // The model still reports reorders that have just been deleted, so they
        // are filtered out here until it catches up with losing them.
        const removed = new Set(cleared.map((reorder) => reorder.requestId));
        const visible = reorders.filter((reorder) => !removed.has(reorder.requestId));
        const fromModel = new Set(visible.map((reorder) => reorder.requestId));

        const optimistic: (Reorder & { isPending: true })[] = pending
            .filter((reorder) => !fromModel.has(reorder.requestId))
            .map((reorder) => ({
                requestId: reorder.requestId,
                storeName: reorder.storeName,
                productName: reorder.productName,
                units: reorder.units,
                requestedBy: reorder.requestedBy,
                requestedAt: reorder.requestedAt,
                isPending: true,
            }));

        return [...optimistic, ...visible].slice(0, MAX_ROWS);
    }, [reorders, pending, cleared]);

    return (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <header className="border-b border-border-strong px-600 py-500">
                <h2 className="text-600 leading-600 font-semibold text-foreground">
                    Recent reorders
                </h2>
                <p className="mt-100 text-400 leading-400 text-muted-foreground">
                    Recorded in Fabric, with who asked and when.
                </p>
            </header>

            {error ? (
                <p
                    role="alert"
                    className="px-600 py-700 text-400 leading-400 font-semibold text-destructive"
                >
                    Could not read recent reorders. {error}
                </p>
            ) : isLoading && rows.length === 0 ? (
                <p className="px-600 py-700 text-400 leading-400 text-muted-foreground">
                    Reading the model…
                </p>
            ) : rows.length === 0 ? (
                <p className="px-600 py-700 text-500 leading-500 text-muted-foreground">
                    No reorders sent yet.
                </p>
            ) : (
                <ul>
                    <AnimatePresence initial={false}>
                        {rows.map((reorder) => (
                            <ReorderRow
                                key={reorder.requestId}
                                reorder={reorder}
                                isNew={"isPending" in reorder}
                            />
                        ))}
                    </AnimatePresence>
                </ul>
            )}
        </section>
    );
}

function ReorderRow({ reorder, isNew }: { reorder: Reorder; isNew: boolean }) {
    return (
        <motion.li
            layout
            initial={isNew ? { opacity: 0, height: 0 } : false}
            animate={{
                opacity: 1,
                height: "auto",
                // A single, deliberate flash: unmistakable from the back of the
                // room, and over inside a second.
                backgroundColor: isNew
                    ? ["var(--color-success)", "var(--color-card)"]
                    : "var(--color-card)",
            }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="border-b border-border px-600 py-400 last:border-b-0"
        >
            <div className="flex items-baseline justify-between gap-400">
                <p className="min-w-0 flex-1 text-500 leading-500 font-semibold text-foreground">
                    {reorder.productName}
                </p>
                <p className="shrink-0 font-numeric text-500 leading-500 font-bold tabular-nums text-foreground">
                    {reorder.units}
                    <span className="ml-100 text-400 font-medium text-muted-foreground">units</span>
                </p>
            </div>
            <p className="mt-100 text-400 leading-400 text-muted-foreground">
                {reorder.storeName} · {reorder.requestedBy}
            </p>
            <p className="text-400 leading-400 text-muted-foreground">
                {formatWhen(reorder.requestedAt)}
            </p>
        </motion.li>
    );
}

function formatWhen(at: Date): string {
    if (Number.isNaN(at.getTime())) return "just now";

    return at.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
