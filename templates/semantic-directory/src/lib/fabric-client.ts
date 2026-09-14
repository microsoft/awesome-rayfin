//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { FabricClient, FabricClientConfig } from "@microsoft/fabric-app-data";
import { fabricConfig } from "@/fabric.generated";

// The Fabric data SDK pulls in a heavy columnar decoder (apache-arrow +
// flatbuffers + lz4, ~40 kB gzip) whose ONLY job is decoding live DAX results.
// Demo mode never runs a live query, so the SDK is loaded lazily on first use
// via dynamic import — keeping it out of the initial payload that every visitor
// (and every awesome-rayfin gallery browse) would otherwise pay for. The promise
// is memoized so concurrent first-callers (e.g. the parallel introspection
// queries) share one client instead of each racing to build their own.
let _clientPromise: Promise<FabricClient> | undefined;

async function buildFabricClient(): Promise<FabricClient> {
    const [
        { SemanticModelMessageClient },
        { FabricClient },
        { EmbedFabricApiProxy },
    ] = await Promise.all([
        import("@microsoft/fabric-app-data-embed-client"),
        import("@microsoft/fabric-app-data"),
        import("@microsoft/fabric-app-data-proxy"),
    ]);
    const proxy = new EmbedFabricApiProxy(new SemanticModelMessageClient());
    return new FabricClient({ proxy, ...fabricConfig } as FabricClientConfig);
}

/**
 * Resolves to the pre-configured FabricClient singleton, loading the Fabric data
 * SDK on first call. The client is built once using:
 * - An EmbedFabricApiProxy that communicates with the Fabric host via postMessage
 * - Connection aliases from `fabric.generated.ts` (managed by `npx fabric-app-data`)
 *
 * @internal Used by the live-query hooks — prefer those over direct client access.
 */
export function getFabricClient(): Promise<FabricClient> {
    if (!_clientPromise) {
        _clientPromise = buildFabricClient().catch((err: unknown) => {
            // Don't cache a transient SDK-load failure — let the next call retry.
            _clientPromise = undefined;
            throw err;
        });
    }
    return _clientPromise;
}
