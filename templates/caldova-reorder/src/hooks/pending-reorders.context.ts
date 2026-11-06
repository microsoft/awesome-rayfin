import { createContext, useContext } from "react";

/**
 * A reorder this browser sent, before the semantic model has caught up.
 *
 * The model reads reorders from OneLake, which Fabric mirrors from the app's
 * database. That mirror takes about half a minute — far too long to leave the
 * screen unchanged after a manager acts. So a sent reorder is held here and
 * painted immediately, then dropped the moment the model reports it.
 */
export interface PendingReorder {
    requestId: string;
    storeId: string;
    sku: string;
    storeName: string;
    productName: string;
    units: number;
    requestedBy: string;
    requestedAt: Date;
}

/**
 * A reorder this browser deleted, before the model has caught up with losing it.
 *
 * The exact mirror image of {@link PendingReorder}, and necessary for the same
 * reason: immediately after a reset the model still reports the deleted rows, so
 * without this the screen would paint them straight back.
 */
export interface ClearedReorder {
    requestId: string;
    storeId: string;
    sku: string;
    units: number;
    requestedAt: Date;
}

export interface PendingReordersValue {
    pending: PendingReorder[];
    /** Reorders removed here that the model still reports. */
    cleared: ClearedReorder[];
    /** Record a reorder that has just been accepted. */
    add: (reorder: PendingReorder) => void;
    /** Record reorders that have just been deleted. */
    remove: (reorders: ClearedReorder[]) => void;
    /** Stop painting pending reorders the model has started reporting. */
    confirmPending: (requestIds: readonly string[]) => void;
    /**
     * Stop hiding cleared reorders the model has stopped reporting. Takes the
     * ids the model *still* reports, so anything absent is released.
     */
    releaseCleared: (requestIdsStillReported: readonly string[]) => void;
    /**
     * Units this screen has just put on order for a product, before the model
     * has mirrored them. `undefined` when there is nothing in flight — the
     * model is then the only answer.
     */
    pendingUnits: (storeId: string, sku: string) => number | undefined;
    /**
     * Units this screen has just cancelled for a product, to be subtracted from
     * whatever the model still reports as on order.
     */
    clearedUnits: (storeId: string, sku: string) => number;
}

export const PendingReordersContext = createContext<PendingReordersValue | undefined>(undefined);

export function usePendingReorders(): PendingReordersValue {
    const context = useContext(PendingReordersContext);

    if (context === undefined) {
        throw new Error("usePendingReorders must be used within a PendingReordersProvider");
    }

    return context;
}
