//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import logoUrl from "@reorder/assets/caldova-logo.svg";
import { useI18n } from "@/i18n";
import { useFormat } from "@reorder/lib/format";
import { canWrite, useLiveContext } from "@reorder/hooks/live.context";
import { useDemoReset } from "@reorder/hooks/use-demo-reset";
import { DemoResetPanel } from "@reorder/components/demo-reset.component";

interface AppHeaderProps {
    /** The model's own notion of "now", so the screen states what it is showing. */
    asOf: Date | null;
    /** One Stadtbezirk, or null for all of them. */
    region: string | null;
    onReset: () => void;
    /** Why reordering is off, or null when it is on. */
    readOnlyNote: string | null;
}

/**
 * The top bar.
 *
 * Enterprise software always answers two questions before anything else: who am
 * I signed in as, and how current is this? Both live here.
 */
export function AppHeader({ asOf, region, onReset, readOnlyNote }: AppHeaderProps) {
    const { t } = useI18n();
    const fmt = useFormat();
    const live = useLiveContext();
    const email = live.signIn?.kind === "signed-in" ? live.signIn.user.email : null;
    const reset = useDemoReset({ onReset });

    return (
        <header className="border-b border-border-strong bg-card">
            <div className="mx-auto flex max-w-[1680px] items-center gap-500 px-800 py-300">
                {/* Double-click opens the demo reset (signed in only). Unlabelled on purpose. */}
                <div className="relative">
                    <img
                        src={logoUrl}
                        alt="Caldova"
                        onDoubleClick={canWrite(live) ? reset.open : undefined}
                        className="h-[26px] w-auto select-none"
                    />
                    <DemoResetPanel reset={reset} />
                </div>

                <span className="h-[28px] w-px bg-border-strong" aria-hidden />

                <div className="min-w-0">
                    <p className="text-500 leading-500 font-semibold text-foreground">{t("reorder.header.title")}</p>
                    <p className="text-400 leading-400 text-muted-foreground">
                        {region ? t("reorder.header.region", { region }) : t("reorder.header.allDistricts")}
                    </p>
                </div>

                <div className="ml-auto flex items-center gap-600">
                    <div className="text-right">
                        <p className="text-400 leading-400 text-muted-foreground">{t("reorder.header.asOf")}</p>
                        <p className="text-400 leading-400 font-semibold text-foreground" data-testid="reorder-asof">
                            {asOf ? fmt.day(asOf) : "…"}
                        </p>
                    </div>

                    {email ? (
                        <div className="flex items-center gap-300">
                            <span
                                aria-hidden
                                className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-primary text-400 font-bold text-primary-foreground"
                            >
                                {initials(email)}
                            </span>
                            <span className="text-400 leading-400 text-foreground">{email}</span>
                        </div>
                    ) : (
                        <p className="max-w-[34ch] text-right text-400 leading-400 text-muted-foreground" data-testid="reorder-readonly">
                            {readOnlyNote}
                        </p>
                    )}
                </div>
            </div>
        </header>
    );
}

function initials(email: string): string {
    const [local] = email.split("@");
    const parts = local.split(/[._-]+/).filter(Boolean);

    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return local.slice(0, 2).toUpperCase();
}
