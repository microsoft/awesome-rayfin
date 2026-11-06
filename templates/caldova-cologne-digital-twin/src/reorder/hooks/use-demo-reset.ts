import { useEffect, useState } from "react";

import { useLiveContext } from "./live.context";

export type ResetState = "idle" | "confirming" | "resetting" | "failed";

interface DemoResetOptions {
    /** Told after a reset. The list re-reads the database itself, so there is nothing to hand back. */
    onReset: () => void;
}

/**
 * A way to put the demo back to its opening state between runs.
 *
 * It always asks before deleting anything — an accidental double-click wiping
 * the table mid-demo would be worse than having no reset at all.
 *
 * Only the signed-in user's own reorders are removed; the seeded history that
 * gives the recent list its texture belongs to other people and stays put.
 */
export function useDemoReset({ onReset }: DemoResetOptions) {
    const live = useLiveContext();
    const [state, setState] = useState<ResetState>("idle");
    const [failure, setFailure] = useState<string | null>(null);
    const [deleted, setDeleted] = useState<number | null>(null);

    useEffect(() => {
        if (state !== "confirming") return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setState("idle");
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [state]);

    async function confirm() {
        setState("resetting");
        setFailure(null);

        try {
            // Phase 5a: the data client, scoped to the caller's own rows (src/reorder-live/live.ts).
            const removed = await live.reset();

            setDeleted(removed);
            setState("idle");
            onReset();
        } catch (err) {
            setState("failed");
            setFailure(err instanceof Error ? err.message : String(err));
        }
    }

    return {
        state,
        failure,
        deleted,
        open: () => setState("confirming"),
        cancel: () => setState("idle"),
        confirm,
        dismissResult: () => setDeleted(null),
    };
}

export type DemoReset = ReturnType<typeof useDemoReset>;
