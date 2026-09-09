import type { DataTable } from "../lib/types";

/**
 * Standardized query caching + request coalescing for the data layer.
 *
 * Two model-agnostic performance levers every data-driven app benefits from,
 * regardless of the semantic model behind it:
 *
 *  - **Stale-while-revalidate (SWR) cache** — a repeated query (same id) renders
 *    instantly from cache while a fresh copy is fetched in the background. Kills
 *    the "return to a visited page re-runs a multi-second query" symptom.
 *  - **In-flight coalescing** — concurrent identical queries share ONE network
 *    request instead of stacking duplicates (e.g. an insight banner and a table
 *    both asking for the same data on the same filter change).
 *
 * Zero dependencies. In-memory by default; opt into cross-session persistence
 * with `persist: true` (localStorage), guarded so a full/again unavailable store
 * degrades to memory-only rather than throwing.
 */

/** A cached result plus the time it was stored (for TTL + freshness checks). */
interface CacheEntry {
  table: DataTable;
  storedAt: number;
}

export interface QueryCacheOptions {
  /** Max distinct query results held in memory (LRU eviction). Default 50. */
  maxEntries?: number;
  /** Entries older than this are treated as stale (still served, then revalidated).
   *  0 / undefined = never auto-stale by age. Default 5 min. */
  ttlMs?: number;
  /** Persist across sessions via localStorage, keyed by query id. Default false. */
  persist?: boolean;
  /** Namespace for persisted keys, so multiple apps on one origin don't collide. */
  namespace?: string;
}

const DEFAULTS: Required<Omit<QueryCacheOptions, "persist" | "namespace">> = {
  maxEntries: 50,
  ttlMs: 5 * 60 * 1000,
};

/** SWR cache with LRU eviction and optional localStorage persistence. */
export class QueryCache {
  private mem = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly persist: boolean;
  private readonly prefix: string;

  constructor(opts: QueryCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULTS.maxEntries;
    this.ttlMs = opts.ttlMs ?? DEFAULTS.ttlMs;
    this.persist = Boolean(opts.persist) && hasLocalStorage();
    this.prefix = `fabric-qcache:${opts.namespace ?? "default"}:`;
  }

  /** Read a cached table (memory first, then persisted store). Touches LRU order. */
  get(key: string): DataTable | undefined {
    const entry = this.mem.get(key) ?? this.readPersisted(key);
    if (!entry) return undefined;
    // Re-insert to mark as most-recently-used.
    this.mem.delete(key);
    this.mem.set(key, entry);
    return entry.table;
  }

  /** True when a cached entry is missing or older than the TTL. */
  isStale(key: string): boolean {
    const entry = this.mem.get(key) ?? this.readPersisted(key);
    if (!entry) return true;
    if (!this.ttlMs) return false;
    return Date.now() - entry.storedAt > this.ttlMs;
  }

  set(key: string, table: DataTable): void {
    const entry: CacheEntry = { table, storedAt: Date.now() };
    this.mem.set(key, entry);
    this.evict();
    this.writePersisted(key, entry);
  }

  clear(): void {
    this.mem.clear();
    if (!this.persist) return;
    try {
      const store = window.localStorage;
      for (let i = store.length - 1; i >= 0; i -= 1) {
        const k = store.key(i);
        if (k && k.startsWith(this.prefix)) store.removeItem(k);
      }
    } catch {
      /* storage unavailable — memory already cleared */
    }
  }

  private evict(): void {
    while (this.mem.size > this.maxEntries) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
  }

  private readPersisted(key: string): CacheEntry | undefined {
    if (!this.persist) return undefined;
    try {
      const raw = window.localStorage.getItem(this.prefix + key);
      if (!raw) return undefined;
      const entry = JSON.parse(raw) as CacheEntry;
      this.mem.set(key, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  private writePersisted(key: string, entry: CacheEntry): void {
    if (!this.persist) return;
    try {
      window.localStorage.setItem(this.prefix + key, JSON.stringify(entry));
    } catch {
      /* quota exceeded / unavailable — memory cache still holds the entry */
    }
  }
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * In-flight request registry. Deduplicates concurrent fetches for the same key so
 * N identical simultaneous queries resolve from ONE underlying promise.
 */
export class InFlightRegistry {
  private pending = new Map<string, Promise<DataTable>>();

  /** Run `factory` for `key`, or attach to an already-running one. */
  run(key: string, factory: () => Promise<DataTable>): Promise<DataTable> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const p = factory().finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, p);
    return p;
  }
}
