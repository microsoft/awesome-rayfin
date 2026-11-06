//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@/i18n";
import { useFormat } from "@reorder/lib/format";
import type { DemoReset } from "@reorder/hooks/use-demo-reset";

/**
 * The demo reset, opened by double-clicking the logo. Unlabelled on purpose: it is
 * for the presenter between runs, not for the audience.
 */
export function DemoResetPanel({ reset }: { reset: DemoReset }) {
    const { t } = useI18n();
    const fmt = useFormat();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (reset.state === "confirming") cancelRef.current?.focus();
    }, [reset.state]);

    if (reset.state === "idle" && reset.deleted === null) return null;

    if (reset.deleted !== null && reset.state === "idle") {
        return <Banner onDismiss={reset.dismissResult}>{t("reorder.reset.done", { count: fmt.int(reset.deleted) })}</Banner>;
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t("reorder.reset.label")}
            className="absolute left-0 top-full z-40 mt-200 w-[380px] rounded-xl border border-border-strong bg-card p-500 shadow-raised"
        >
            <p className="text-500 leading-500 font-semibold text-foreground">{t("reorder.reset.question")}</p>
            <p className="mt-200 text-400 leading-400 text-muted-foreground">{t("reorder.reset.body")}</p>

            {reset.state === "failed" && reset.failure && (
                <p role="alert" className="mt-300 text-400 leading-400 font-semibold break-words text-destructive">
                    {t("reorder.reset.failed", { detail: reset.failure })}
                </p>
            )}

            <div className="mt-400 flex justify-end gap-300">
                <button
                    ref={cancelRef}
                    type="button"
                    onClick={reset.cancel}
                    className="rounded-md border border-input px-400 py-200 text-400 leading-400 font-semibold text-foreground hover:bg-hover focus:outline-none focus:ring-2 focus:ring-ring"
                >
                    {t("reorder.reset.cancel")}
                </button>
                <button
                    type="button"
                    onClick={reset.confirm}
                    disabled={reset.state === "resetting"}
                    className="rounded-md bg-destructive px-400 py-200 text-400 leading-400 font-semibold text-destructive-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-60"
                >
                    {reset.state === "resetting" ? t("reorder.reset.running") : t("reorder.reset.confirm")}
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
