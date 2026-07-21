import { useCallback, useEffect, useRef, useState } from "react";
import type { DataTable } from "../lib/types";
import type { DataQuery, DataSource } from "./data-source";
import { QueryCache, InFlightRegistry, type QueryCacheOptions } from "./query-cache";

export interface UseDataQueryResult {
  data: DataTable | null;
  loading: boolean;
  error: Error | null;
  /** True while a background stale-while-revalidate refresh is in flight (cache hit shown). */
  revalidating: boolean;
  /** Re-run the query (also used by the standardized error-state Retry button). */
  refetch: () => void;
}

export interface UseDataQueryOptions {
  /** Poll interval in ms. Omit to disable. */
  refreshMs?: number;
  /**
   * Stale-while-revalidate caching. `true` (default) uses a shared in-memory cache;
   * pass options to tune size/TTL or enable cross-session `persist`. `false` opts out.
   */
  cache?: boolean | QueryCacheOptions;
  /** Coalesce concurrent identical in-flight queries into one request. Default true. */
  coalesce?: boolean;
  /** Debounce rapid query changes (e.g. fast filter clicks) by this many ms. Default 0. */
  debounceMs?: number;
}

/** Process-wide shared registries so independent components asking for the SAME
 *  query share cache entries and in-flight requests (e.g. an insight banner and a
 *  data grid on the same filter selection). */
const sharedCache = new QueryCache();
const sharedInFlight = new InFlightRegistry();

const namedCaches = new Map<string, QueryCache>();
function resolveCache(cache: UseDataQueryOptions["cache"]): QueryCache | null {
  if (cache === false) return null;
  if (cache === undefined || cache === true) return sharedCache;
  // Tuned/persisted caches are memoized per-namespace so they persist across renders.
  const ns = cache.namespace ?? "default";
  let c = namedCaches.get(ns);
  if (!c) {
    c = new QueryCache(cache);
    namedCaches.set(ns, c);
  }
  return c;
}

/** Standardized data fetching: runs a query against any DataSource, manages
 *  loading/error state, cancels in-flight requests on change/unmount, and adds
 *  stale-while-revalidate caching + request coalescing by default. Apps never
 *  hand-roll fetch logic — and get the shared performance behavior for free. */
export function useDataQuery(
  source: DataSource,
  query: DataQuery,
  opts: UseDataQueryOptions = {},
): UseDataQueryResult {
  const cache = resolveCache(opts.cache);
  const coalesce = opts.coalesce !== false;
  const debounceMs = opts.debounceMs ?? 0;

  const qid = query.id ?? query.query;

  const [data, setData] = useState<DataTable | null>(() => cache?.get(qid) ?? null);
  const [loading, setLoading] = useState(() => !cache?.get(qid));
  const [error, setError] = useState<Error | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  // Keep the latest query object in a ref so the effect can read fresh text
  // without re-subscribing on every render (the effect keys off `qid`).
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const cached = cache?.get(qid) ?? null;
    const forced = tick > 0;
    if (cached) {
      // SWR: show cache instantly; only revalidate if stale or explicitly refetched.
      setData(cached);
      setLoading(false);
      setError(null);
      const needsRevalidate = forced || (cache?.isStale(qid) ?? true);
      if (!needsRevalidate) return () => { active = false; controller.abort(); };
      setRevalidating(true);
    } else {
      setLoading(true);
      setError(null);
    }

    const runFetch = () => {
      const doFetch = () => source.fetch(queryRef.current, controller.signal);
      const p = coalesce ? sharedInFlight.run(qid, doFetch) : doFetch();
      p.then((table) => {
        if (!active) return;
        cache?.set(qid, table);
        setData(table);
        setLoading(false);
        setRevalidating(false);
      }).catch((e: unknown) => {
        if (!active || (e as Error)?.name === "AbortError") return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
        setRevalidating(false);
      });
    };

    // Debounce only the network trigger; cached paint above is always immediate.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (debounceMs > 0 && !cached) {
      timer = setTimeout(runFetch, debounceMs);
    } else {
      runFetch();
    }

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, qid, tick, coalesce, debounceMs]);

  useEffect(() => {
    if (!opts.refreshMs) return;
    const h = setInterval(refetch, opts.refreshMs);
    return () => clearInterval(h);
  }, [opts.refreshMs, refetch]);

  return { data, loading, error, revalidating, refetch };
}
