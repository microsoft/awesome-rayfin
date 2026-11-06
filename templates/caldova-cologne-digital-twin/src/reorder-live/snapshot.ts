import { useEffect, useState } from 'react';

import type { ModelRow } from '../reorder/queries/model-row';

/**
 * The Reorder tab's stock figures, baked from the live Cologne model by
 * `tools/fabric/bake_reorder_snapshot.py`.
 *
 * ⚠️ WHY NOT THE CONNECTOR. The `fabric-semanticmodel` connector runs through a delegated User Data
 * Function, and Fabric then opens the deployed app ONLY for its owner (an OWNER-ONLY
 * LOCK). The snapshot holds what the app's own `.dax` files return, in the model's own column names,
 * so the original parsers read it unchanged; the deploy gate re-runs the queries and refuses a
 * snapshot the model no longer gives. Reorders are NOT in here: they are live (see live.ts).
 */
export interface Snapshot {
  version: string;
  modelId: string;
  latestSalesDate: string;
  stores: Record<string, { name: string; region: string }>;
  products: Record<string, { name: string }>;
  bakedAt: string;
  queries: Record<string, SnapshotTable>;
}

/**
 * A baked query result. Text columns are dictionary-encoded (`dict[column]` holds the values, the
 * row holds the index) because store names and dates repeat tens of thousands of times.
 */
export interface SnapshotTable {
  columns: string[];
  rows: unknown[][];
  dict?: Record<string, string[]>;
}

export type SnapshotKey =
  | 'headlineTiles'
  | 'lowStockQueue'
  | 'demandTrend'
  | 'lowStockTrend'
  | 'productDemand'
  | `stockByStore|${string}`
  | `salesRate|${string}|${string}`;

export const SNAPSHOT_URL = 'data/reorder/snapshot.json';

let pending: Promise<Snapshot> | null = null;

/** One fetch per page; a failure is not cached, so the next caller tries again. */
export function loadSnapshot(): Promise<Snapshot> {
  pending ??= fetch(SNAPSHOT_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`snapshot ${res.status}`);
      return res.json() as Promise<Snapshot>;
    })
    .catch((err: unknown) => {
      pending = null;
      throw err;
    });
  return pending;
}

function decoded(table: SnapshotTable): unknown[][] {
  const dicts = table.columns.map((c) => table.dict?.[c]);
  return table.rows.map((row) => row.map((v, i) => (dicts[i] ? dicts[i][v as number] : v)));
}

/**
 * Rows of one baked query, keyed by column name exactly as the model returned them.
 *
 * `salesRate|<sku>|<store>` is answered from ONE combined table (7,200 pairs) whose first two
 * columns are the key; the row comes back without them, exactly as the per-pair DAX returns it.
 */
export function rowsOf(snapshot: Snapshot, key: SnapshotKey): ModelRow[] {
  if (key.startsWith('salesRate|')) {
    const [, sku, store] = key.split('|');
    const table = snapshot.queries.salesRate;
    if (!table) throw new Error('snapshot has no salesRate');
    const columns = table.columns.slice(2);
    return decoded(table)
      .filter((r) => r[0] === sku && r[1] === store)
      .map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i + 2]])));
  }
  const table = snapshot.queries[key];
  if (!table) throw new Error(`snapshot has no ${key}`);
  return decoded(table).map((values) => Object.fromEntries(table.columns.map((c, i) => [c, values[i]])));
}

export interface SnapshotQueryState<T> {
  rows: T[];
  isLoading: boolean;
  error: string | null;
}

/**
 * `useModelQuery` for the snapshot: same `{rows, isLoading, error}` shape, same `parse` mappers from
 * src/reorder/queries, no network after the first load (and none at all once the offline cache holds
 * the file).
 */
export function useSnapshotQuery<T>(key: SnapshotKey | null, parse: (row: ModelRow) => T): SnapshotQueryState<T> {
  const [state, setState] = useState<SnapshotQueryState<T>>({ rows: [], isLoading: key !== null, error: null });

  useEffect(() => {
    if (key === null) {
      setState({ rows: [], isLoading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true }));
    loadSnapshot()
      .then((snapshot) => {
        if (!cancelled) setState({ rows: rowsOf(snapshot, key).map(parse), isLoading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ rows: [], isLoading: false, error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // `parse` is a stable pure mapper from a query factory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** The snapshot itself, for the dimension maps (store and product names of live reorders). */
export function useSnapshot(): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadSnapshot()
      .then((s) => !cancelled && setSnapshot(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return snapshot;
}
