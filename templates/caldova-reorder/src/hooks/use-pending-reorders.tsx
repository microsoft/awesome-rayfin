import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
    PendingReordersContext,
    type ClearedReorder,
    type PendingReorder,
    type PendingReordersValue,
} from "./pending-reorders.context";

/**
 * Holds the difference between what this browser has done and what the semantic
 * model has caught up with.
 *
 * Two lists, opposite signs. `pending` is a reorder sent but not yet mirrored,
 * so it is painted early. `cleared` is a reorder deleted but still mirrored, so
 * it is hidden until the model agrees. Both are reconciled against the model on
 * request id, and both exist only because the mirror trails the database by
 * about half a minute.
 */
export function PendingReordersProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingReorder[]>([]);
    const [cleared, setCleared] = useState<ClearedReorder[]>([]);

    const add = useCallback((reorder: PendingReorder) => {
        setPending((current) => [reorder, ...current]);
    }, []);

    const remove = useCallback((reorders: ClearedReorder[]) => {
        if (reorders.length === 0) return;

        const removed = new Set(reorders.map((reorder) => reorder.requestId));

        // A reorder deleted before the model ever reported it needs no hiding —
        // it leaves both lists at once.
        setPending((current) => current.filter((reorder) => !removed.has(reorder.requestId)));
        setCleared((current) => [...current, ...reorders]);
    }, []);

    const confirmPending = useCallback((requestIds: readonly string[]) => {
        if (requestIds.length === 0) return;

        const confirmed = new Set(requestIds);

        setPending((current) => {
            const remaining = current.filter((reorder) => !confirmed.has(reorder.requestId));
            return remaining.length === current.length ? current : remaining;
        });
    }, []);

    // A cleared entry stays hidden until the model has stopped reporting it.
    // Release it any earlier and the row comes straight back.
    const releaseCleared = useCallback((requestIdsStillReported: readonly string[]) => {
        const reported = new Set(requestIdsStillReported);

        setCleared((current) => {
            const remaining = current.filter((reorder) => reported.has(reorder.requestId));
            return remaining.length === current.length ? current : remaining;
        });
    }, []);

    const value = useMemo<PendingReordersValue>(
        () => ({
            pending,
            cleared,
            add,
            remove,
            confirmPending,
            releaseCleared,
            pendingUnits: (storeId, sku) => {
                const matches = pending.filter(
                    (reorder) => reorder.storeId === storeId && reorder.sku === sku,
                );

                if (matches.length === 0) return undefined;

                return matches.reduce((total, reorder) => total + reorder.units, 0);
            },
            clearedUnits: (storeId, sku) =>
                cleared
                    .filter((reorder) => reorder.storeId === storeId && reorder.sku === sku)
                    .reduce((total, reorder) => total + reorder.units, 0),
        }),
        [pending, cleared, add, remove, confirmPending, releaseCleared],
    );

    return (
        <PendingReordersContext.Provider value={value}>{children}</PendingReordersContext.Provider>
    );
}
