import type { IAuthService } from './IAuthService';
import { MockAuthService } from './MockAuthService';
import { RayfinAuthService } from './RayfinAuthService';
import { initRayfinClient } from './rayfinClient';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { portalInTenant } from './fabricPortal';

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
  // Offline demo of the Fabric User Manager: fixture data, no backend at all.
  if (import.meta.env.VITE_UM_MOCK === 'true') return new OfflineAuthService();

  const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
  const localDev = isLocalBackendUrl(apiUrl);
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

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
    functionsBaseUrl: import.meta.env.VITE_RAYFIN_FUNCTIONS_URL,
    localDev,
  });

  if (localDev) {
    return new MockAuthService(client);
  }

  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;

  if (!workspaceId || !projectId || !fabricPortalUrl) {
    throw new Error(
      'Missing required Fabric config. Set VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID, and VITE_FABRIC_PORTAL_URL.'
    );
  }

  return new RayfinAuthService(client, {
    workspaceId,
    projectId,
    // In this app's tenant, so that a guest's sign-in window does not open in their home tenant.
    fabricPortalUrl: portalInTenant(fabricPortalUrl, import.meta.env.VITE_FABRIC_TENANT_ID),
    returnOrigin: window.location.origin,
  });
}
