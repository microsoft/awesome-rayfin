import type { DaxRow } from '@/data/model';
import { getRayfinClient } from '@/services/rayfinClient';
import {
  acquirePowerBiToken,
  executeQueriesDirect,
} from '@/services/powerBiDirect';
import { executeDaxViaHost, hasFabricHost } from '@/services/fabricHostBridge';

/**
 * Single entry point for running DAX, with automatic transport selection.
 *
 * The three transports, in the order they are tried:
 *
 * 1. **host** - the Fabric portal's own semantic-model plugin over the postMessage bridge. Tried
 *    first whenever the app is embedded, because it runs the query as the portal's signed-in user
 *    and so needs **no sign-in at all**. This is what the shipped reference app in MSIT uses.
 *
 * 2. **connector** - the Rayfin `fabric-semanticmodel` connector. Ids stay server-side and there
 *    is no second sign-in either, but it is an unreleased experimental API and currently returns
 *    "ConnectorFunction invocation is not enabled for this workspace".
 *
 * 3. **powerbi** - a delegated Power BI token acquired with MSAL, calling `executeQueries`
 *    straight from the browser. Only reachable in a standalone tab, and costs one extra sign-in;
 *    an interactive sign-in cannot complete inside the portal frame (see fabricHostBridge.ts).
 *
 * The choice is made once per session on the first query and then reused, so when the connector
 * preview does light up the app silently goes back to it on the next load - no code change.
 */

export type DaxTransport = 'connector' | 'host' | 'powerbi';

const WORKSPACE_ID = import.meta.env.VITE_FABRIC_WORKSPACE_ID as string;
/** The semantic model to query. Set `VITE_PBI_DATASET_ID` - see `.env.example`. */
const DATASET_ID = (import.meta.env.VITE_PBI_DATASET_ID as string | undefined) ?? '';

/** Thrown when the Power BI fallback needs an interactive sign-in that only a click may trigger. */
export class NeedsPowerBiSignIn extends Error {
  constructor() {
    super('Sign in to Power BI to load live data.');
    this.name = 'NeedsPowerBiSignIn';
  }
}

let transport: DaxTransport | null = null;
let token: string | null = null;

const listeners = new Set<() => void>();

export function subscribeToGateway(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce() {
  for (const listener of listeners) listener();
}

export function getTransport(): DaxTransport | null {
  return transport;
}

export function isPowerBiConnected(): boolean {
  return token !== null;
}

/** True when the app is on the MSAL fallback and still has no token. */
export function needsPowerBiSignIn(): boolean {
  return transport === 'powerbi' && token === null;
}

function isConnectorUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connectorfunction|not enabled|not found|404|501/i.test(message);
}

async function runViaConnector(query: string): Promise<DaxRow[]> {
  const response = await getRayfinClient().connectors.transitModel.executeQuery({ query });
  const failure = response.output?.queryError ?? response.output?.responseError;
  if (failure) throw new Error(failure.message);
  return response.output?.tables?.[0]?.rows ?? [];
}

async function runViaHost(query: string): Promise<DaxRow[]> {
  return executeDaxViaHost(WORKSPACE_ID, DATASET_ID, query);
}

async function runViaPowerBi(query: string): Promise<DaxRow[]> {
  token ??= await acquirePowerBiToken(false);
  if (!token) throw new NeedsPowerBiSignIn();

  try {
    const { rows } = await executeQueriesDirect(query, token);
    return rows;
  } catch (error) {
    // An expired token is the common case - drop it, take one silent retry, then ask for a click.
    if (error instanceof Error && /\((401|403)\)/.test(error.message)) {
      token = await acquirePowerBiToken(false);
      announce();
      if (!token) throw new NeedsPowerBiSignIn();
      const { rows } = await executeQueriesDirect(query, token);
      return rows;
    }
    throw error;
  }
}

/** Interactive Power BI sign-in. Must be called from a user gesture - it navigates or pops up. */
export async function connectPowerBi(options: { switchAccount?: boolean } = {}): Promise<void> {
  token = await acquirePowerBiToken(true, options.switchAccount ?? false);
  if (token) transport = 'powerbi';
  announce();
}

export async function runDax(query: string): Promise<DaxRow[]> {
  if (transport === 'host') return runViaHost(query);
  if (transport === 'powerbi') return runViaPowerBi(query);

  // Embedded in the portal, the host bridge is both the fastest and the only sign-in-free path,
  // so try it before the connector - otherwise every load starts with a failing `connector-invoke`
  // round trip and a red 404 in the console.
  if (transport === null && hasFabricHost()) {
    try {
      const rows = await runViaHost(query);
      console.info('[dax] using the Fabric host bridge (no sign-in needed).');
      transport = 'host';
      announce();
      return rows;
    } catch (hostError) {
      console.warn('[dax] Fabric host bridge unavailable, trying the connector:', hostError);
    }
  }

  try {
    const rows = await runViaConnector(query);
    if (transport !== 'connector') {
      transport = 'connector';
      announce();
    }
    return rows;
  } catch (error) {
    if (transport === 'connector' || !isConnectorUnavailable(error)) throw error;

    console.warn('[dax] falling back to a direct Power BI sign-in:', error);
    transport = 'powerbi';
    announce();
    return runViaPowerBi(query);
  }
}
