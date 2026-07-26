//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type PluginOption } from "vite";
import license from "rollup-plugin-license";

import { resolve } from 'path';

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

// Dev-only middleware: makes the local Vite server compatible with browsers that
// enforce Local Network Access (LNA) checks when a public origin (the Fabric portal)
// embeds an iframe pointing at http://localhost. Sets the LNA opt-in response header
// on every response and short-circuits the corresponding preflight OPTIONS request.
// This is required for fetch/XHR subresources from the embedded app — top-level
// iframe navigations additionally require launching Chromium with the
// `--disable-features=...LocalNetworkAccessChecks` flag (see .playwright-config.json).
const localNetworkAccessPlugin: PluginOption = {
  name: 'local-network-access-headers',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network']) {
        const origin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
        res.statusCode = 204;
        res.end();
        return;
      }
      next();
    });
  },
};

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        localNetworkAccessPlugin,
    ],
    resolve: {
        alias: {
            '@': resolve(projectRoot, 'src'),
        }
    },
    optimizeDeps: {
        include: ['@microsoft/fabric-visuals', '@microsoft/fabric-datagrid', '@microsoft/fabric-visuals-core'],
    },
    build: {
        commonjsOptions: {
            include: [/node_modules/],
        },
        rollupOptions: {
            output: {
                // Split heavy vendor code into cacheable chunks so the initial
                // payload isn't one ~1 MB blob. Grouped by update cadence:
                // React/motion/icons rarely change; the Fabric/Rayfin SDK is the
                // largest and most independent surface.
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }
                    // Live-query data SDK + its columnar result decoder
                    // (apache-arrow, flatbuffers, lz4). Reached ONLY through the
                    // dynamic import in fabric-client.ts, so isolating it here
                    // lets it load lazily on the first live query — demo mode
                    // never downloads or parses it.
                    if (
                        id.includes('@microsoft/fabric-app-data') ||
                        id.includes('apache-arrow') ||
                        id.includes('flatbuffers') ||
                        id.includes('lz4js')
                    ) {
                        return 'vendor-fabric-data';
                    }
                    if (id.includes('@microsoft/fabric') || id.includes('@microsoft/rayfin')) {
                        return 'vendor-fabric';
                    }
                    if (id.includes('framer-motion') || id.includes('/motion-dom/') || id.includes('/motion-utils/')) {
                        return 'vendor-motion';
                    }
                    if (id.includes('lucide-react')) {
                        return 'vendor-icons';
                    }
                    if (id.includes('minisearch')) {
                        return 'vendor-search';
                    }
                    if (
                        id.includes('/react-dom/') ||
                        id.includes('/react/') ||
                        id.includes('/scheduler/') ||
                        id.includes('react-error-boundary')
                    ) {
                        return 'vendor-react';
                    }
                    return 'vendor';
                },
            },
            plugins: [
                license({
                    thirdParty: {
                        multipleVersions: true,
                        output: {
                            file: resolve(projectRoot, 'dist', 'THIRD_PARTY_NOTICES.txt'),
                            template(dependencies) {
                                if (dependencies.length === 0) {
                                    return 'No third-party dependencies.';
                                }
                                return (
                                    'This file was auto-generated at build time.\n\n' +
                                    dependencies
                                        .map((dep) => {
                                            const lines = [
                                                `${dep.name}@${dep.version}`,
                                                `License: ${dep.license || 'UNKNOWN'}`,
                                            ];
                                            if (dep.author) {
                                                lines.push(`Author: ${typeof dep.author === 'string' ? dep.author : dep.author.text()}`);
                                            }
                                            if (dep.noticeText) {
                                                lines.push('', 'NOTICE:', dep.noticeText.trim());
                                            }
                                            if (dep.licenseText) {
                                                lines.push('', dep.licenseText.trim());
                                            }
                                            return lines.join('\n');
                                        })
                                        .join('\n\n' + '='.repeat(60) + '\n\n')
                                );
                            },
                        },
                    },
                }),
            ],
        },
    },
});
