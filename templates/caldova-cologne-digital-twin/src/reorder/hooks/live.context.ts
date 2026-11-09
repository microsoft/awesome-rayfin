import { createContext, useContext } from "react";

import type { LiveState } from "@/reorder-live/useLive";

/**
 * The live half of the tab (sign-in and the app database's reorders), shared by every original
 * screen. Replaces the original's AuthContext and PendingReordersContext: the tab
 * reads the database it writes to, so there is no model lag left to reconcile.
 */
export const LiveContext = createContext<LiveState | null>(null);

export function useLiveContext(): LiveState {
    const live = useContext(LiveContext);
    if (!live) throw new Error("useLiveContext must be used inside the Reorder tab");
    return live;
}

/** True when reorders can be written: signed in through Fabric, not mid-way through anything. */
export function canWrite(live: LiveState): boolean {
    return live.signIn?.kind === "signed-in";
}
