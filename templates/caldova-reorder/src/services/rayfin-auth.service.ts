//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type { OpaqueSession } from "@microsoft/rayfin-auth";
import {
    initEmbeddedAuth as sdkInitEmbeddedAuth,
    type FabricAuthOptions,
} from "@microsoft/rayfin-auth-provider-fabric";
import { getRayfinClient, type CaldovaClient } from "@/lib/rayfin-client";

export interface IAuthService {
    /**
     * Try to acquire a session via the embedded (iframe) Fabric flow
     * without any UI. Returns `null` when not running inside a Fabric
     * iframe — the {@link AuthGate} renders the "not embedded" notice in
     * that case.
     */
    initEmbeddedAuth(): Promise<OpaqueSession | null>;
}

/**
 * Read `VITE_*` env vars and construct the auth service used by the app.
 *
 * Called from `main.tsx` at module init — **before** React mounts. If
 * any required env var is missing this throws synchronously, the SPA
 * never boots, and the user sees the static `<noscript>` fallback in
 * `index.html`. That is intentional: a Fabric-embedded app with no
 * usable Rayfin or Fabric config has nothing to render.
 *
 * Required vars:
 * - `VITE_RAYFIN_API_URL` — Rayfin API base URL (e.g. `http://localhost:5168`)
 * - `VITE_RAYFIN_PUBLISHABLE_KEY` — Rayfin publishable key (`pk-...`)
 * - `VITE_FABRIC_WORKSPACE_ID` — Fabric workspace ID
 * - `VITE_FABRIC_ITEM_ID` — Fabric item ID
 * - `VITE_FABRIC_PORTAL_URL` — Fabric portal base URL
 */
export function bootstrapAuth(): IAuthService {
    const client = getRayfinClient();

    const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
    const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
    const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;

    if (
        !workspaceId ||
        !projectId ||
        !fabricPortalUrl
    ) {
        throw new Error(`Missing required env vars for Fabric auth - run 'npx rayfin up'`);
    }

    const fabricOptions: FabricAuthOptions = {
        workspaceId,
        projectId,
        fabricPortalUrl,
        returnOrigin: window.location.origin,
        // Declared rather than sniffed. The SDK otherwise infers embedded mode
        // from the portal's `?fabricEmbedded=true`, and that parameter does not
        // survive the sign-in redirect a gated (`assetAccess: protected`) origin
        // performs — leaving the app convinced it was opened outside Fabric.
        // This app only ever runs embedded, so it can simply say so.
        fabricEmbedded: true,
    };

    return new RayfinAuthService(client, fabricOptions);
}

/**
 * Auth service that wraps the Fabric brokered authentication SDK
 * (`@microsoft/rayfin-auth-provider-fabric`).
 */
class RayfinAuthService implements IAuthService {
    constructor(
        private readonly client: CaldovaClient,
        private readonly fabricOptions: FabricAuthOptions,
    ) {}

    async initEmbeddedAuth(): Promise<OpaqueSession | null> {
        return sdkInitEmbeddedAuth(this.client.auth, this.fabricOptions);
    }
}