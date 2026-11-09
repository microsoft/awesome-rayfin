import type { RecordStore } from '@/domain/records';

import { portalInTenant } from './fabricPortal';
import type { AuthUser, IAuthService } from './IAuthService';
import { MockAuthService } from './MockAuthService';
import { RayfinAuthService } from './RayfinAuthService';
import { initRayfinClient } from './rayfinClient';
import { MemoryRecordStore, RayfinRecordStore } from './store';

/** The offline demo: no tenant, no backend; records live in this browser. */
export const OFFLINE = import.meta.env.VITE_OFFLINE === 'true' || import.meta.env.MODE === 'offline';

const DEMO_USER: AuthUser = { id: 'demo', email: 'controller@contoso.com', name: 'Demo controller' };

class OfflineAuthService implements IAuthService {
  readonly fabricAuthEnabled = false;
  async signIn() {
    return DEMO_USER;
  }
  async signOut() {}
  async getCurrentUser() {
    return DEMO_USER;
  }
  async initEmbeddedAuth() {
    return DEMO_USER;
  }
}

function isLocalBackendUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Pick the auth service for the target: offline demo, local Rayfin backend, or Fabric. */
export function bootstrapAuth(): IAuthService {
  if (OFFLINE) return new OfflineAuthService();

  const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
  const localDev = isLocalBackendUrl(apiUrl);
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;
  if (!publishableKey && !localDev) throw new Error('VITE_RAYFIN_PUBLISHABLE_KEY environment variable is required');

  const client = initRayfinClient({
    baseUrl: apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    publishableKey: publishableKey ?? 'local-dev-key',
    functionsBaseUrl: import.meta.env.VITE_RAYFIN_FUNCTIONS_URL,
    localDev,
  });
  if (localDev) return new MockAuthService(client);

  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;
  if (!workspaceId || !projectId || !fabricPortalUrl) {
    throw new Error('Missing required Fabric config. Set VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID, and VITE_FABRIC_PORTAL_URL.');
  }
  return new RayfinAuthService(client, {
    workspaceId,
    projectId,
    // In the app's tenant, so a guest's sign-in window does not open in their home tenant.
    fabricPortalUrl: portalInTenant(fabricPortalUrl, import.meta.env.VITE_FABRIC_TENANT_ID),
    returnOrigin: window.location.origin,
  });
}

/** The record store for the signed-in person. */
export function storeFor(user: AuthUser): RecordStore {
  return OFFLINE ? new MemoryRecordStore(user, 'caldova-finance.offline-records') : new RayfinRecordStore(user);
}

/**
 * Who may sign a close off. The data API enforces the same list (rayfin/data/controllers.ts); this copy only
 * decides whether the app shows the button. Offline, the demo user is a controller.
 */
export function isController(user: AuthUser): boolean {
  if (OFFLINE) return true;
  const list = (import.meta.env.VITE_CONTROLLER_EMAILS ?? '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(user.email.toLowerCase());
}
