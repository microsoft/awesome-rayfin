import { envVar } from './env';
import type { IAuthService } from './IAuthService';
import { MockAuthService } from './MockAuthService';
import { RayfinAuthService } from './RayfinAuthService';
import { initRayfinClient } from './rayfinClient';

function isLocalBackendUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Read VITE_* env vars, initialize the Rayfin client, and return the right
 * auth service for the target backend.
 *
 * - Localhost API URL → {@link MockAuthService}
 * - Anything else     → {@link RayfinAuthService} (requires VITE_FABRIC_* vars)
 */
export function bootstrapAuth(): IAuthService {
  const apiUrl =
    envVar(() => import.meta.env.VITE_RAYFIN_API_URL) ||
    'http://localhost:5168';
  const localDev = isLocalBackendUrl(apiUrl);
  const publishableKey = envVar(
    () => import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY
  );

  if (!publishableKey && !localDev) {
    throw new Error(
      'VITE_RAYFIN_PUBLISHABLE_KEY environment variable is required'
    );
  }

  const client = initRayfinClient({
    baseUrl: apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    publishableKey: publishableKey ?? 'local-dev-key',
    // When `rayfin dev functions apply` is running, the CLI writes
    // `VITE_RAYFIN_FUNCTIONS_URL` into `.env.local` so the browser
    // can route `client.functions.X.invoke(...)` at the local Azure
    // Functions Core Tools host (e.g. http://localhost:7071) instead
    // of the deployed Fabric item's `/functions/<name>/invoke` path.
    // Falls back to `undefined` in production, which keeps the
    // existing remote-call behaviour for builders who only consume
    // deployed functions.
    functionsBaseUrl: envVar(() => import.meta.env.VITE_RAYFIN_FUNCTIONS_URL),
    localDev,
  });

  if (localDev) {
    return new MockAuthService(client);
  }

  const workspaceId = envVar(() => import.meta.env.VITE_FABRIC_WORKSPACE_ID);
  const projectId = envVar(() => import.meta.env.VITE_FABRIC_ITEM_ID);
  const fabricPortalUrl = envVar(
    () => import.meta.env.VITE_FABRIC_PORTAL_URL
  );

  if (!workspaceId || !projectId || !fabricPortalUrl) {
    throw new Error(
      'Missing required Fabric config. Set VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID, and VITE_FABRIC_PORTAL_URL.'
    );
  }

  return new RayfinAuthService(client, {
    workspaceId,
    projectId,
    fabricPortalUrl,
    returnOrigin: window.location.origin,
  });
}
