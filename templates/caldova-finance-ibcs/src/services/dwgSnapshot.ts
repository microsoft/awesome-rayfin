/**
 * The original P&L visual's data: every query its three pages can send, answered in advance by the model
 * `caldova-finance` and baked into `public/data/dwg-snapshot.json` (tools/bake-snapshot.mjs), keyed by the EXACT
 * query text. The texts come from the app's own builders (src/domain/dwgPeriod.ts), so a baked answer and the
 * query a page asks for cannot drift apart; `bake:check` re-runs every one against the model before a deploy.
 *
 * ⚠️ Why not the connector: a deployed `fabric-semanticmodel` connector makes the app open only for its owner.
 */
export interface QueryColumn {
  name: string;
  dataType: string;
}
export interface QueryTable {
  columns: QueryColumn[];
  rows: unknown[][];
}
export interface QueryError {
  category: 'query' | 'overflow' | 'api' | 'network';
  message: string;
}
/** The connector's normalised result shape, copied so the connector package never enters the bundle. */
export type SemanticModelQueryResult =
  | { status: 'success'; table: QueryTable; requestId: string }
  | { status: 'error'; error: QueryError; requestId: string };

export interface DwgSnapshot {
  bakedAt: string;
  results: Record<string, QueryTable>;
}

export const DWG_SNAPSHOT_URL = 'data/dwg-snapshot.json';

let pending: Promise<DwgSnapshot> | null = null;

/** One fetch per page load; a failure is not cached, so the next caller tries again. */
export function loadDwgSnapshot(): Promise<DwgSnapshot> {
  pending ??= fetch(DWG_SNAPSHOT_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`The visual's data did not load (${res.status})`);
      return res.json() as Promise<DwgSnapshot>;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** Normalise line endings: generated DAX may carry CRLF on Windows checkouts. Same rule in the bake. */
export function queryKey(query: string): string {
  return query.replace(/\r\n/g, '\n').trim();
}

/** The baked answer for one query, or an `error` result that names the gap (never silent empty data). */
export function answer(snapshot: DwgSnapshot, query: string): SemanticModelQueryResult {
  const table = snapshot.results[queryKey(query)];
  if (!table) {
    return {
      status: 'error',
      requestId: 'snapshot',
      error: { category: 'query', message: 'This query is not in the baked snapshot (run npm run bake).' },
    };
  }
  return { status: 'success', requestId: 'snapshot', table };
}
