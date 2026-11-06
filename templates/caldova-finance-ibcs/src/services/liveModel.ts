import { toQueryResult, type FabricSemanticModelTabularResponse } from '@microsoft/rayfin-connector-fabric-semanticmodel';

import { assembleSnapshot, QUERIES } from '@/domain/assemble';
import type { Snapshot } from '@/domain/types';

import { getRayfinClient } from './rayfinClient';

/** The connector name declared by `npm run live:enable` (tools/live-mode.mjs) in rayfin/rayfin.yml. */
export const LIVE_CONNECTOR = 'statements';

interface ExecuteQueryClient {
  executeQuery(input: { query: string }): Promise<FabricSemanticModelTabularResponse>;
}

async function rows(query: string): Promise<Record<string, unknown>[]> {
  const connectors = (getRayfinClient() as unknown as { connectors?: Record<string, ExecuteQueryClient> }).connectors;
  const statements = connectors?.[LIVE_CONNECTOR];
  if (!statements) throw new Error(`No connector "${LIVE_CONNECTOR}": run npm run live:enable and redeploy.`);
  const result = toQueryResult(await statements.executeQuery({ query }));
  if (result.status === 'error') throw new Error(`${result.error.category}: ${result.error.message}`);
  const names = result.table.columns.map((c) => c.name);
  return result.table.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
}

/**
 * Live mode (`VITE_LIVE_MODEL=true`): the statements come straight from the semantic model through Rayfin's
 * `fabric-semanticmodel` connector. The forecast drivers still come from the shipped file, they are
 * configuration, not data.
 *
 * ⚠️ The connector runs as a delegated User Data Function: a deployed app with it opens only for its owner
 * (Rayfin 1.36, measured 19 Oct 2026). That is why the default is the baked snapshot.
 */
export async function loadLiveSnapshot(): Promise<Snapshot> {
  const shipped = (await (await fetch(`${import.meta.env.BASE_URL}data/statements.json`, { cache: 'no-cache' })).json()) as Snapshot;
  const [accounts, months, values] = await Promise.all([rows(QUERIES.accounts), rows(QUERIES.months), rows(QUERIES.values)]);
  return assembleSnapshot({ accounts, months, values }, shipped.drivers, 'semantic model (live connector)');
}
