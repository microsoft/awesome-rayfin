/**
 * The Finance tab's data: every query the ported cockpit can send, answered in advance by the live
 * model `caldova-cologne-finance` and baked into `public/data/finance/snapshot.json`
 * (tools/fabric/bake_finance_snapshot.py), keyed by the EXACT query text.
 *
 * ⚠️ WHY NOT THE CONNECTOR. A deployed `fabric-semanticmodel` connector runs through a delegated User Data
 * Function, and Fabric then opens the app ONLY for its owner. The query texts come from
 * the app's own builders (tools/finance/query-manifest.ts), so a baked answer and the query the page
 * asks for cannot drift apart; the deploy gate re-runs every one against the model.
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

interface BakedTable {
  columns: QueryColumn[];
  rows: unknown[][];
  /** Text columns dictionary-encoded: `dict[column]` holds the values, the row their index. */
  dict?: Record<string, string[]>;
}
export interface FinanceSnapshot {
  version: string;
  modelId: string;
  bakedAt: string;
  lastActual: string;
  results: Record<string, BakedTable>;
}

export const FINANCE_SNAPSHOT_URL = 'data/finance/snapshot.json';

let pending: Promise<FinanceSnapshot> | null = null;

/** One fetch per page; a failure is not cached, so the next caller tries again. */
export function loadFinanceSnapshot(): Promise<FinanceSnapshot> {
  pending ??= fetch(FINANCE_SNAPSHOT_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Finance data not loaded (${res.status})`);
      return res.json() as Promise<FinanceSnapshot>;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

/** Normalise line endings: the DAX files are read with CRLF on Windows checkouts, LF elsewhere. */
export function queryKey(query: string): string {
  return query.replace(/\r\n/g, '\n').trim();
}

export function decodeTable(t: BakedTable): QueryTable {
  const dicts = t.columns.map((c) => t.dict?.[c.name]);
  return { columns: t.columns, rows: t.rows.map((r) => r.map((v, i) => (dicts[i] ? dicts[i][v as number] : v))) };
}

/** The baked answer for one query, or an `error` result that names the gap (never silent empty data). */
export function answer(snapshot: FinanceSnapshot, query: string): SemanticModelQueryResult {
  const t = snapshot.results[queryKey(query)];
  if (!t) {
    return {
      status: 'error',
      requestId: 'snapshot',
      error: { category: 'query', message: 'This query is not in the finance snapshot (add it to tools/finance/query-manifest.ts and bake again).' },
    };
  }
  return { status: 'success', requestId: 'snapshot', table: decodeTable(t) };
}
