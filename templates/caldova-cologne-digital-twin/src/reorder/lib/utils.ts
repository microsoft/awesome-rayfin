//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * ⚠️ THE FONT-SIZE SCALE MUST BE DECLARED (measured 2026-10-19). The design tokens name sizes
 * `text-100 … text-600` and `text-hero-700 … text-hero-1000`; plain `twMerge` does not know them,
 * reads them as text COLOURS, and drops `text-hero-800` in favour of a later `text-critical`, so
 * every hero figure rendered at body size. Declaring the scale keeps size and colour apart.
 */
const twMerge = extendTailwindMerge({
    extend: {
        theme: {
            text: ["100", "200", "300", "400", "500", "600", "hero-700", "hero-800", "hero-900", "hero-1000"],
        },
    },
});

/**
 * Merge Tailwind CSS class names with conflict resolution.
 *
 *   cn("px-2 py-1", isActive && "bg-primary text-primary-foreground")
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
