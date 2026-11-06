import { useCallback } from "react";

import { getRayfinClient } from "@/lib/rayfin-client";
import { useAuth } from "./auth.context";
import { usePendingReorders } from "./pending-reorders.context";
import type { LowStockItem } from "@/queries";

/**
 * Send a reorder for one product at one store.
 *
 * Shared by the row's one-click action and the detail view's considered one, so
 * both take the identical path: call the function, then paint the result
 * immediately rather than waiting for the model to mirror it.
 */
export function useSendReorder(item: LowStockItem, onSent: () => void) {
    const { session } = useAuth();
    const { add } = usePendingReorders();

    return useCallback(
        async (units: number) => {
            const result = await getRayfinClient().functions.sendReorder.invoke({
                storeId: item.storeId,
                sku: item.sku,
                units,
            });

            add({
                requestId: result.requestId,
                storeId: item.storeId,
                sku: item.sku,
                storeName: item.storeName,
                productName: item.productName,
                units,
                requestedBy: session?.user?.email ?? "you",
                requestedAt: new Date(),
            });

            onSent();
        },
        [item, add, session, onSent],
    );
}
