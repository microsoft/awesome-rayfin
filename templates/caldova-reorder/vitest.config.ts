//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        environment: "jsdom",
        setupFiles: ["src/test/setup.ts"],
        globals: true,
        // data/ is its own package with node:test (`npm --prefix data test`), not vitest.
        include: ["src/**/*.{test,spec}.{ts,tsx}"],
        passWithNoTests: true,
    },
    resolve: {
        alias: { "@": resolve(import.meta.dirname, "src") },
    },
});
