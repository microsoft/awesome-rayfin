import { useEffect, useRef, type ReactNode } from "react";

import type { DemoReset } from "@/hooks/use-demo-reset";

/**
 * The confirmation the demo reset asks for, and the acknowledgement afterwards.
 *
 * Deliberately unlabelled until summoned: the gesture is a double-click on the
 * wordmark. An audience never finds it, and a presenter does not have to look at
 * a "reset" button all the way through the talk.
 */
export function DemoResetPanel({ reset }: { reset: DemoReset }) {
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (reset.state === "confirming") cancelRef.current?.focus();
    }, [reset.state]);

    if (reset.state === "idle" && reset.deleted === null) return null;

    if (reset.deleted !== null && reset.state === "idle") {
        return (
            <Banner onDismiss={reset.dismissResult}>
                Demo reset — {reset.deleted} {reset.deleted === 1 ? "reorder" : "reorders"} removed.
            </Banner>
        );
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Reset the demo"
            className="absolute left-0 top-full z-40 mt-200 w-[380px] rounded-xl border border-border-strong bg-card p-500 shadow-raised"
        >
            <p className="text-500 leading-500 font-semibold text-foreground">Reset the demo?</p>
            <p className="mt-200 text-400 leading-400 text-muted-foreground">
                Removes the reorders you sent. The earlier history, raised by other managers, is
                left alone.
            </p>

            {reset.state === "failed" && reset.failure && (
                <p
                    role="alert"
                    className="mt-300 text-400 leading-400 font-semibold break-words text-destructive"
                >
                    Could not reset. {reset.failure}
                </p>
            )}

            <div className="mt-400 flex justify-end gap-300">
                <button
                    ref={cancelRef}
                    type="button"
                    onClick={reset.cancel}
                    className="rounded-md border border-input px-400 py-200 text-400 leading-400 font-semibold text-foreground hover:bg-hover focus:outline-none focus:ring-2 focus:ring-ring"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={reset.confirm}
                    disabled={reset.state === "resetting"}
                    className="rounded-md bg-destructive px-400 py-200 text-400 leading-400 font-semibold text-destructive-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
                >
                    {reset.state === "resetting" ? "Resetting…" : "Reset"}
                </button>
            </div>
        </div>
    );
}

function Banner({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onDismiss, 4000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div
            role="status"
            className="absolute left-0 top-full z-40 mt-200 rounded-xl border border-success bg-success-surface px-500 py-300 text-400 leading-400 font-semibold whitespace-nowrap text-success"
        >
            {children}
        </div>
    );
}
