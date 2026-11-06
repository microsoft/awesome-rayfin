//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { OpaqueSession } from "@microsoft/rayfin-auth";
import { isEmbeddedMode } from "@microsoft/fabric-embedded-host";

import { IAuthService } from "@/services/rayfin-auth.service";
import { AuthContext, type AuthContextValue } from "./auth.context";

interface AuthProviderProps {
    children: ReactNode;
    rayfinAuthService: IAuthService;
}

/**
 * AuthProvider — runs the Fabric embedded auth handoff once on mount.
 *
 * Behavior:
 * - When loaded inside a Fabric iframe (`?fabricEmbedded=true`), calls
 *   `initEmbeddedAuth` to acquire a Rayfin session via postMessage.
 * - When loaded standalone, `initEmbeddedAuth` returns `null` immediately
 *   and the provider settles in an unauthenticated state and `<AuthGate>` 
 *   renders the "not embedded" notice.
 *
 * Consume the session with the `useAuth` hook.
 */
export function AuthProvider({ children, rayfinAuthService }: AuthProviderProps) {
    const [session, setSession] = useState<OpaqueSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    // Recorded once at mount: the SDK persists a flag when it sees the portal's
    // query parameter, so asking later can give a different answer than the one
    // the sign-in attempt actually acted on.
    const [isEmbedded] = useState(() => {
        // Being in an iframe is the honest test for the message this drives:
        // "are you actually inside the portal?". The SDK's own check reads the
        // `?fabricEmbedded=true` parameter, which a gated origin's sign-in
        // redirect can drop — so on its own it would call the portal "outside
        // Fabric" and send the reader in the wrong direction.
        try {
            return isEmbeddedMode({}) || window.self !== window.top;
        } catch {
            // Cross-origin access to window.top throws, which itself means framed.
            return true;
        }
    });

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const result = await rayfinAuthService.initEmbeddedAuth();
                if (cancelled)
                    return;

                // `null` inside the portal means the handoff ran and produced no
                // session. That is a failure, not "you opened this outside
                // Fabric", and it has to say so or it sends the reader hunting
                // in the wrong place.
                if (result === null && isEmbeddedMode({})) {
                    setError(
                        new Error(
                            "Embedded sign-in did not return a session. See the console for the handoff error.",
                        ),
                    );
                }

                setSession(result);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [rayfinAuthService]);



    const value = useMemo<AuthContextValue>(
        () => ({
            session,
            isAuthenticated: session?.isAuthenticated ?? false,
            isLoading,
            error,
            isEmbedded,
        }),
        [session, isLoading, error, isEmbedded],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}