import { RayfinClient } from '@microsoft/rayfin-client';
import type { SlideDeckSchema } from '../../rayfin/data/schema';

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  functionsBaseUrl?: string;
  localDev: boolean;
}

let client: RayfinClient<SlideDeckSchema> | null = null;
let localDev = false;

export function initRayfinClient(config: RayfinClientConfig): RayfinClient<SlideDeckSchema> {
  if (client) throw new Error('Rayfin client is already initialized.');
  client = new RayfinClient<SlideDeckSchema>({
    baseUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    functionsBaseUrl: config.functionsBaseUrl,
    useProxy: false,
    authStorage: true,
  });
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<SlideDeckSchema> {
  if (!client) throw new Error('Rayfin client not initialized. Call bootstrapAuth() first.');
  return client;
}

export function isLocalBackend(): boolean {
  return localDev;
}
