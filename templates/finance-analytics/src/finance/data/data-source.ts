import type { DataTable } from "../lib/types";

export interface DataQuery {
  /** DAX (or adapter-specific) query text. */
  query: string;
  /** Optional stable id for caching/telemetry; defaults to the query text. */
  id?: string;
}

/** The contract every data source implements. Apps pick an adapter once, then all
 *  standardized features (grid, pivot, charts, export) consume the result uniformly. */
export interface DataSource {
  /** Human label shown in the shell header/footer, e.g. "Live · Sample model". */
  label: string;
  fetch(query: DataQuery, signal?: AbortSignal): Promise<DataTable>;
  /**
   * Optional batched fetch: resolve several queries together. `staticDataSource`
   * implements it trivially; `fabricDataSource` relies on the SDK's built-in LRU cache
   * instead (the Rayfin SDK runs one `EVALUATE` per query, so there is no true
   * multi-query round-trip to collapse). `fetchQueries` falls back to parallel single
   * fetches when a source doesn't implement it.
   */
  fetchMany?(queries: DataQuery[], signal?: AbortSignal): Promise<DataTable[]>;
}

/** Run several queries against a source, using its batched path when available and
 *  falling back to parallel single fetches otherwise. Prefer this over hand-rolling
 *  a Promise.all so apps automatically benefit from single-round-trip batching. */
export function fetchQueries(
  source: DataSource,
  queries: DataQuery[],
  signal?: AbortSignal,
): Promise<DataTable[]> {
  if (source.fetchMany) return source.fetchMany(queries, signal);
  return Promise.all(queries.map((q) => source.fetch(q, signal)));
}

/** In-memory source for demos, tests, and offline dev. Optional latency exercises
 *  the standardized loading/skeleton states. */
export function staticDataSource(
  table: DataTable,
  opts: { label?: string; latencyMs?: number } = {},
): DataSource {
  return {
    label: opts.label ?? "Sample (static)",
    async fetch() {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      return table;
    },
    async fetchMany(queries) {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      return queries.map(() => table);
    },
  };
}
