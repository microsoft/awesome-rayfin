//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { ErrorBoundary } from "react-error-boundary";
import { LazyMotion, MotionConfig, domMax } from "framer-motion";

import App from "./App.tsx";
import { ErrorFallback } from "./ErrorFallback";
import { useAppTheme } from "./hooks/use-theme";
import { ThemeContext } from "./hooks/theme.context";
import { AuthProvider } from "./hooks/use-auth";
import { AuthGate } from "./components/auth-gate.component";
import type { IAuthService } from "./services/rayfin-auth.service";

/**
 * App root: wires the theme context, motion runtime, error boundary, and auth
 * providers around <App />. Kept in its own module so `main.tsx` holds only the
 * bootstrap side effects (Fast Refresh stays happy with a component-only file).
 */
export function Root({ rayfinAuthService }: { rayfinAuthService: IAuthService | null }) {
    const { isDark, preference, setPreference, toggleTheme } = useAppTheme();

    return (
        <ThemeContext.Provider value={{ isDark, preference, setPreference, toggleTheme }}>
            <LazyMotion features={domMax} strict>
                {/* Honour prefers-reduced-motion for every framer animation. */}
                <MotionConfig reducedMotion="user">
                <ErrorBoundary FallbackComponent={ErrorFallback}>
                    {rayfinAuthService ? (
                        <AuthProvider rayfinAuthService={rayfinAuthService}>
                            <AuthGate>
                                <App />
                            </AuthGate>
                        </AuthProvider>
                    ) : (
                        // Demo mode: no Fabric/Rayfin config → boot straight into
                        // the bundled demo dataset with no auth handoff.
                        <App />
                    )}
                </ErrorBoundary>
                </MotionConfig>
            </LazyMotion>
        </ThemeContext.Provider>
    );
}
