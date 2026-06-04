import type { IAuthService } from './IAuthService';
import { RayfinAuthService } from './RayfinAuthService';
import { initRayfinClient } from './rayfinClient';

/**
 * Read VITE_* env vars, initialize the Rayfin client, and return the
 * auth service configured for the appropriate mode.
 *
 * - API URL points to localhost → email/password auth
 * - Otherwise                  → Fabric brokered auth
 */
export function bootstrapAuth(): IAuthService {
  const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;

  // If the API URL points to localhost, use password auth; otherwise Fabric.
  const apiHost = new URL(apiUrl).hostname;
  const useFabric = apiHost !== 'localhost' && apiHost !== '127.0.0.1';

  if (!publishableKey && useFabric) {
    throw new Error(
      'VITE_RAYFIN_PUBLISHABLE_KEY environment variable is required'
    );
  }

  const client = initRayfinClient({
    baseUrl: apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    publishableKey: publishableKey ?? 'local-dev-key',
    functionsBaseUrl: import.meta.env.VITE_RAYFIN_FUNCTIONS_URL,
    localDev: false,
  });

  if (useFabric) {
    return new RayfinAuthService(client, {
      mode: 'fabric',
      fabricOptions: {
        workspaceId: workspaceId ?? '',
        projectId: projectId ?? '',
        fabricPortalUrl: fabricPortalUrl ?? '',
        returnOrigin: window.location.origin,
      },
    });
  }

  return new RayfinAuthService(client, { mode: 'password' });
}
