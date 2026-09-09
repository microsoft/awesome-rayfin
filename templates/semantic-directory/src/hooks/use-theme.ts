//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { appConfig } from "@/app.config";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = appConfig.themeStorageKey;

function readStoredPreference(): ThemePreference {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
        /* localStorage may be unavailable in the embedded host — ignore. */
    }
    return "system";
}

/** Resolve the host/OS appearance when preference is "system". */
function hostPrefersDark(): boolean {
    const appearance = document.documentElement.getAttribute("data-appearance");
    if (appearance === "dark") return true;
    if (appearance === "light") return false;
    if (document.documentElement.classList.contains("dark")) return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(pref: ThemePreference): boolean {
    if (pref === "dark") return true;
    if (pref === "light") return false;
    return hostPrefersDark();
}

/**
 * Theme controller. Honors an explicit user choice (persisted) and otherwise
 * follows the Fabric host / OS appearance. Applies the `dark` class to <html>
 * so Tailwind's dark variant and our CSS tokens switch in lockstep.
 */
export function useAppTheme() {
    const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
    // Track the host/OS appearance independently; the final `isDark` is derived
    // during render, so there is no cascading setState-in-effect.
    const [systemIsDark, setSystemIsDark] = useState(hostPrefersDark);

    const isDark =
        preference === "dark" ? true : preference === "light" ? false : systemIsDark;

    // Apply the resolved appearance to <html> whenever it changes. This writes to
    // an external system (the DOM), which is exactly what effects are for.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", isDark);
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    }, [isDark]);

    // Always track the host/OS appearance; `isDark` consumes it only while the
    // preference is "system". setState here fires from event/observer callbacks
    // (never synchronously in the effect body).
    useEffect(() => {
        const mql = window.matchMedia("(prefers-color-scheme: dark)");
        const sync = () => setSystemIsDark(hostPrefersDark());
        mql.addEventListener("change", sync);
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-appearance"],
        });
        return () => {
            mql.removeEventListener("change", sync);
            observer.disconnect();
        };
    }, []);

    const setPreference = useCallback((next: ThemePreference) => {
        setPreferenceState(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            /* ignore persistence failures */
        }
    }, []);

    /** Flip between light and dark, pinning an explicit user choice. */
    const toggleTheme = useCallback(() => {
        setPreferenceState((prev) => {
            const next: ThemePreference = resolveIsDark(prev) ? "light" : "dark";
            try {
                localStorage.setItem(STORAGE_KEY, next);
            } catch {
                /* ignore */
            }
            return next;
        });
    }, []);

    return { isDark, preference, setPreference, toggleTheme };
}
