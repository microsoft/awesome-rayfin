import { useCallback } from "react";

import { useLiveContext } from "./live.context";
import type { LowStockItem } from "@reorder/queries";

/**
 * Send a reorder for one product at one pharmacy.
 *
 * Shared by the row's one-click action and the detail view's considered one, so both take the
 * identical path. Since Phase 5a that path is the data client (no Functions: they make the app
 * owner-only), and it throws on failure so the caller can say "not sent" and why.
 */
export function useSendReorder(item: LowStockItem, onSent: () => void) {
    const live = useLiveContext();

    return useCallback(
        async (units: number) => {
            await live.send({ storeId: item.storeId, sku: item.sku }, units);
            onSent();
        },
        [item, live, onSent],
    );
}
