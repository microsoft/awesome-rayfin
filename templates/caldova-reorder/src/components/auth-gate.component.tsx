//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { type ReactNode } from "react";

import { useAuth } from "@/hooks/auth.context";

interface AuthGateProps {
    children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
    const { isLoading, isAuthenticated, isEmbedded, error } = useAuth();

    if (isLoading) {
        return (
            <Centred>
                <p className="text-500 leading-500 text-muted-foreground">Connecting to Fabric…</p>
            </Centred>
        );
    }

    if (!isAuthenticated) {
        // Two different failures, two different things to go and do. Reporting
        // "you are outside Fabric" to someone who is plainly inside it wastes
        // their time looking in the wrong place.
        return isEmbedded ? (
            <Centred>
                <h2 className="mb-200 text-600 leading-600 font-semibold text-foreground">
                    Couldn&rsquo;t finish signing in to Fabric
                </h2>
                <p className="mb-300 text-400 leading-400 text-muted-foreground">
                    The app is running inside the Fabric portal, but the sign-in handoff did not
                    return a session. Reloading the page usually retries it.
                </p>
                {error && (
                    <p className="mb-400 break-words text-400 leading-400 font-semibold text-destructive">
                        {error.message}
                    </p>
                )}
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="rounded-md bg-primary px-400 py-200 text-400 leading-400 font-semibold text-primary-foreground hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring"
                >
                    Try again
                </button>
            </Centred>
        ) : (
            <Centred>
                <h2 className="mb-200 text-600 leading-600 font-semibold text-foreground">
                    Can&rsquo;t open this app outside Fabric
                </h2>
                <p className="mb-300 text-400 leading-400 text-muted-foreground">
                    Opening apps connected to semantic models outside of the Fabric portal is not
                    supported at this time.
                </p>
                <HostFacts />
            </Centred>
        );
    }

    return <>{children}</>;
}

/**
 * What the app can see about how it was loaded.
 *
 * Shown only on the "outside Fabric" path, where the interesting question is
 * why the app thinks that. Embedded mode is detected from the portal's
 * `fabricEmbedded` query parameter, so if the app really is in the portal and
 * still lands here, this says whether the parameter arrived at all.
 */
function HostFacts() {
    const inIframe = window.self !== window.top;
    const search = window.location.search || "(none)";

    return (
        <p className="text-300 leading-300 break-words text-muted-foreground">
            In an iframe: {String(inIframe)} · query: {search}
        </p>
    );
}

function Centred({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-600">
            <div className="w-full max-w-[52ch] text-center">{children}</div>
        </div>
    );
}
