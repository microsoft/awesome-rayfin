import {
  ensureSignedInWithFabric,
  initEmbeddedAuth,
  type FabricAuthOptions,
} from '@microsoft/rayfin-auth-provider-fabric';

import { getRayfinClient, initRayfinClient } from './rayfinClient';

export interface AppEnv {
  apiUrl: string;
  publishableKey: string;
  fabric: FabricAuthOptions;
}

/** True when the page itself is served from a dev server. */
export function isLocalFrontend(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Pin the Fabric broker to the tenant that actually owns this app.
 *
 * ⚠️ THIS IS THE MSIT-vs-MCAPS BUG. `rayfin env` writes a bare
 * `VITE_FABRIC_PORTAL_URL=https://app.fabric.microsoft.com`, and the broker URL therefore carries
 * no tenant. Fabric then resolves the tenant from the *browser session*, so anyone whose Windows /
 * browser identity is homed elsewhere - e.g. a Microsoft corp account, whose home cluster is
 * `msit.powerbi.com` - gets sent to a portal where this app item does not exist. The handoff never
 * comes back and the app shows "Authentication failed. Unable to acquire credentials."
 *
 * The SDK documents that it preserves any existing path and query on `fabricPortalUrl` and only
 * appends `/groups/{ws}/appbackends/{item}` plus its PKCE parameters, so adding `ctid` here is
 * enough to force the right tenant.
 */
function portalUrlForTenant(portalUrl: string, tenantId: string | undefined): string {
  if (!tenantId) return portalUrl;
  const url = new URL(portalUrl);
  if (!url.searchParams.has('ctid')) url.searchParams.set('ctid', tenantId);
  return url.toString();
}

/**
 * Read the `VITE_*` values written by `rayfin env` and construct the client.
 *
 * Throws with an actionable message rather than failing deep inside the SDK, because a missing
 * value here always means `rayfin env --framework vite` has not been run for this environment.
 */
export function bootstrap(): AppEnv {
  const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error(
      'VITE_RAYFIN_PUBLISHABLE_KEY is missing. Run `npx rayfin env --framework vite`.',
    );
  }

  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;
  const tenantId = import.meta.env.VITE_FABRIC_TENANT_ID;

  if (!workspaceId || !projectId || !fabricPortalUrl) {
    throw new Error(
      'Missing Fabric config. Expected VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID and ' +
        'VITE_FABRIC_PORTAL_URL - run `npx rayfin env --framework vite`.',
    );
  }

  initRayfinClient({ baseUrl: apiUrl, publishableKey });

  return {
    apiUrl,
    publishableKey,
    fabric: {
      workspaceId,
      projectId,
      fabricPortalUrl: portalUrlForTenant(fabricPortalUrl, tenantId),
      returnOrigin: window.location.origin,
    },
  };
}

/**
 * Resume a session without ever opening a window. Safe on page load; returns false when the user
 * still has to click sign-in.
 */
export async function tryResumeSession(env: AppEnv): Promise<boolean> {
  const { auth } = getRayfinClient();

  const embedded = await initEmbeddedAuth(auth, env.fabric);
  if (embedded) return true;

  if (auth.getSession().isAuthenticated) return true;

  try {
    await auth.refreshSession();
    return auth.getSession().isAuthenticated;
  } catch {
    return false;
  }
}

/** Interactive sign-in. Must be called from a user gesture - step 4 opens a window. */
export async function signIn(env: AppEnv): Promise<void> {
  const { auth } = getRayfinClient();
  await ensureSignedInWithFabric(auth, env.fabric);
}
