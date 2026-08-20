//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import RayfinClient from "@microsoft/rayfin-client";
import type { OpaqueSession } from "@microsoft/rayfin-auth";
import {
    initEmbeddedAuth as sdkInitEmbeddedAuth,
    type FabricAuthOptions,
} from "@microsoft/rayfin-auth-provider-fabric";
import { getRayfinClient } from "@/lib/rayfin-client";

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
 * Called from `main.tsx` at module init — **before** React mounts.
 *
 * Returns `null` when the app is NOT configured for a live Fabric model (no
 * Rayfin / Fabric env vars). In that case the app boots straight into the
 * bundled **demo** experience with no auth gate — perfect for a first run,
 * a stakeholder demo, or exploring the template before connecting a model.
 *
 * When every required var IS present (after `npx rayfin up`), it returns a
 * real auth service and `<AuthGate>` runs the embedded Fabric handoff.
 *
 * Required vars (all must be set for live mode):
 * - `VITE_RAYFIN_API_URL` — Rayfin API base URL (e.g. `http://localhost:5168`)
 * - `VITE_RAYFIN_PUBLISHABLE_KEY` — Rayfin publishable key (`pk-...`)
 * - `VITE_FABRIC_WORKSPACE_ID` — Fabric workspace ID
 * - `VITE_FABRIC_ITEM_ID` — Fabric item ID
 * - `VITE_FABRIC_PORTAL_URL` — Fabric portal base URL
 */
export function bootstrapAuth(): IAuthService | null {
    // Trim so a whitespace-only value counts as unset (→ demo mode) rather than
    // producing a misconfigured live client.
    const apiUrl = import.meta.env.VITE_RAYFIN_API_URL?.trim();
    const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY?.trim();
    const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID?.trim();
    const projectId = import.meta.env.VITE_FABRIC_ITEM_ID?.trim();
    const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL?.trim();

    // Not configured for live → demo mode. No client, no auth gate.
    if (!apiUrl || !publishableKey || !workspaceId || !projectId || !fabricPortalUrl) {
        return null;
    }

    const client = getRayfinClient();

    const fabricOptions: FabricAuthOptions = {
        workspaceId,
        projectId,
        fabricPortalUrl,
        returnOrigin: window.location.origin,
    };

    return new RayfinAuthService(client, fabricOptions);
}

/**
 * Auth service that wraps the Fabric brokered authentication SDK
 * (`@microsoft/rayfin-auth-provider-fabric`).
 */
class RayfinAuthService implements IAuthService {
    constructor(
        private readonly client: RayfinClient,
        private readonly fabricOptions: FabricAuthOptions,
    ) {}

    async initEmbeddedAuth(): Promise<OpaqueSession | null> {
        return sdkInitEmbeddedAuth(this.client.auth, this.fabricOptions);
    }
}