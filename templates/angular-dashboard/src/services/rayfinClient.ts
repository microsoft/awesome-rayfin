import { RayfinClient } from '@microsoft/rayfin-client';

import type { DashboardSchema } from '../../rayfin/data/schema';

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  /**
   * Optional local function host URL (e.g. `http://localhost:7071`).
   * Populated from `VITE_RAYFIN_FUNCTIONS_URL` when the CLI runs
   * `rayfin dev functions apply`. When set, `client.functions.X.invoke()`
   * routes to `${functionsBaseUrl}/api/<name>` (the Azure Functions Core
   * Tools convention) instead of the deployed item's
   * `/functions/<name>/invoke` path, so the browser hits the locally
   * running UDF runtime while data calls still go to Fabric.
   */
  functionsBaseUrl?: string;
  /** True when the API URL points at localhost. Exposed via {@link isLocalBackend}. */
  localDev: boolean;
}

let client: RayfinClient<DashboardSchema> | null = null;
let localDev = false;

export function initRayfinClient(
  config: RayfinClientConfig
): RayfinClient<DashboardSchema> {
  if (client) {
    throw new Error('Rayfin client is already initialized.');
  }
  // TODO: Pass `functionsBaseUrl` directly once the published SDK includes it in the config type.
  client = new RayfinClient<DashboardSchema>({
    baseUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    useProxy: false,
    authStorage: true,
    ...(config.functionsBaseUrl
      ? { functionsBaseUrl: config.functionsBaseUrl }
      : {}),
  });
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<DashboardSchema> {
  if (!client) {
    throw new Error(
      'Rayfin client not initialized. Call bootstrapAuth() first.'
    );
  }
  return client;
}

/** True when the app was bootstrapped against a localhost backend. */
export function isLocalBackend(): boolean {
  return localDev;
}
