//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { createContext, useContext } from "react";
import type { ThemePreference } from "./use-theme";

interface ThemeContextValue {
    isDark: boolean;
    preference: ThemePreference;
    setPreference: (next: ThemePreference) => void;
    toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
    isDark: false,
    preference: "system",
    setPreference: () => {},
    toggleTheme: () => {},
});

export function useThemeContext() {
    return useContext(ThemeContext);
}
