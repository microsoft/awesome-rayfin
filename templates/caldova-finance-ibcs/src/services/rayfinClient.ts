import { ConnectorsRayfinClient, RayfinClient } from '@microsoft/rayfin-client';
import { fabricSemanticModel, type FabricSemanticModel } from '@microsoft/rayfin-connector-fabric-semanticmodel';

import type { DataAppSchema } from '../../rayfin/data/schema';

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  /** Optional local function host URL, from `VITE_RAYFIN_FUNCTIONS_URL` (rayfin dev functions apply). */
  functionsBaseUrl?: string;
  /** True when the API URL points at localhost. Exposed via {@link isLocalBackend}. */
  localDev: boolean;
}

/** The optional live connector (README "Live connector mode"); declared in rayfin.yml only in live builds. */
type AppConnectorsSchema = { statements: FabricSemanticModel<'executeQuery'> };

let client: RayfinClient<DataAppSchema> | null = null;
let localDev = false;

export function initRayfinClient(config: RayfinClientConfig): RayfinClient<DataAppSchema> {
  if (client) throw new Error('Rayfin client is already initialized.');
  const base = {
    baseUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    functionsBaseUrl: config.functionsBaseUrl,
    useProxy: false,
    authStorage: true,
  };
  // Live builds need `client.connectors`; the default build stays on the plain client.
  client =
    import.meta.env.VITE_LIVE_MODEL === 'true'
      ? new ConnectorsRayfinClient<DataAppSchema, Record<string, never>, AppConnectorsSchema>(
          { ...base, connectors: { statements: { connector: 'fabric-semanticmodel' } } },
          { statements: fabricSemanticModel() }
        )
      : new RayfinClient<DataAppSchema>(base);
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<DataAppSchema> {
  if (!client) throw new Error('Rayfin client not initialized. Call bootstrapAuth() first.');
  return client;
}

/** True when the app was bootstrapped against a localhost backend. */
export function isLocalBackend(): boolean {
  return localDev;
}
