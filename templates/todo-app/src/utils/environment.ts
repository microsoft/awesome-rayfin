/**
 * Environment utilities for service mode detection.
 *
 * Auth method availability is now fetched from the backend via
 * the AuthSettingsContext, which calls auth.getAuthSettings().
 * This file only provides service mode detection utilities.
 */

export type ServiceMode = 'mock' | 'rayfin';

/**
 * Get the current service mode from VITE_SERVICE_MODE.
 * Defaults to 'rayfin' if not set.
 */
export function getServiceMode(): ServiceMode {
  const mode = import.meta.env.VITE_SERVICE_MODE;
  if (mode === 'mock') {
    return 'mock';
  }
  return 'rayfin';
}

/**
 * Check if running in mock mode.
 */
export function isMockMode(): boolean {
  return getServiceMode() === 'mock';
}

/**
 * Check if running in rayfin mode.
 */
export function isRayfinMode(): boolean {
  return getServiceMode() === 'rayfin';
}

/**
 * Get Fabric brokered authentication configuration from environment.
 */
export function getFabricConfig(): {
  workspaceId: string | undefined;
  projectId: string | undefined;
  fabricPortalUrl: string | undefined;
} {
  return {
    workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID || undefined,
    projectId: import.meta.env.VITE_FABRIC_ITEM_ID || undefined,
    fabricPortalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL || undefined,
  };
}

/**
 * Check if all required Fabric auth environment variables are configured.
 */
export function isFabricAuthConfigured(): boolean {
  return !!(
    import.meta.env.VITE_FABRIC_WORKSPACE_ID &&
    import.meta.env.VITE_FABRIC_ITEM_ID &&
    import.meta.env.VITE_FABRIC_PORTAL_URL
  );
}
