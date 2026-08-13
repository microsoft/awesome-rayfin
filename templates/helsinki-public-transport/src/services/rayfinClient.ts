import { ConnectorsRayfinClient } from '@microsoft/rayfin-client/experimental';

import type { DataAppSchema } from '../../rayfin/data/schema';
import type { AppConnectorsSchema } from '../../rayfin/connectors/schema';

let client: ConnectorsRayfinClient<
  DataAppSchema,
  Record<string, never>,
  AppConnectorsSchema
> | null = null;

export interface RayfinBootstrapConfig {
  baseUrl: string;
  publishableKey: string;
}

export function initRayfinClient(config: RayfinBootstrapConfig) {
  if (!client) {
    client = new ConnectorsRayfinClient<
      DataAppSchema,
      Record<string, never>,
      AppConnectorsSchema
    >({
      baseUrl: config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`,
      publishableKey: config.publishableKey,
      useProxy: false,
      authStorage: true,
    });
  }
  return client;
}

export function getRayfinClient() {
  if (!client) {
    throw new Error('Rayfin client not initialized - call initRayfinClient() first.');
  }
  return client;
}
