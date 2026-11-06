//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { ConnectorsRayfinClient } from "@microsoft/rayfin-client/experimental";
import { fabricSemanticModel } from "@microsoft/rayfin-connector-fabric-semanticmodel";

import { connectorConfig as caldovaModelConfig } from "../../rayfin/connectors/caldovaModel/schema";
import type { AppSchema } from "@/types/data-schema";
import type { AppConnectorsSchema } from "@/types/connectors-schema";
import type { AppFunctionsSchema } from "@/types/functions-schema";

export type CaldovaClient = ConnectorsRayfinClient<
    AppSchema,
    AppFunctionsSchema,
    AppConnectorsSchema
>;

let _client: CaldovaClient | undefined;

/**
 * Returns the pre-configured Rayfin client singleton.
 *
 * One client covers the whole app: `connectors.caldovaModel` reads Caldova's
 * semantic model, and `functions.sendReorder` writes a reorder back.
 */
export function getRayfinClient(): CaldovaClient {
    if (!_client) {
        const apiUrl = import.meta.env.VITE_RAYFIN_API_URL;
        const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

        if (!apiUrl || !publishableKey) {
            throw new Error(`Missing required env vars for creating rayfin client - run 'npx rayfin up'`);
        }

        _client = new ConnectorsRayfinClient<
            AppSchema,
            AppFunctionsSchema,
            AppConnectorsSchema
        >(
            {
                baseUrl: apiUrl,
                publishableKey,
                authStorage: true,
                // The connector reaches the semantic model through a function
                // bridge that is redeployed with the app, so the first call of a
                // session pays a cold start. The default 30s is not enough for
                // that, and a dashboard read is idempotent — waiting is better
                // than showing an error the user can only answer by reloading.
                timeout: 60_000,
                connectors: {
                    caldovaModel: caldovaModelConfig,
                },
            },
            // The semantic model answers in Apache Arrow. This runtime decodes it
            // and hands back a normalised result, so callers never see the wire.
            { caldovaModel: fabricSemanticModel() },
        );
    }

    return _client;
}
