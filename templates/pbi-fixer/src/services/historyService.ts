// historyService — stateful change log, undo snapshots and scan-quality trend.
//
// PKG-18. Makes the fixer remember what it changed, lets a fix be reverted, and
// records BPA scan results so quality-over-time can be charted.
//
// 🚦 HARD CONSTRAINT — every write is OFF the critical path. `logFix`,
// `saveSnapshot` and `recordScan` are fire-and-forget: they return `void`
// synchronously and persist in the background. A failed write is swallowed with
// a quiet console warning; the fix/scan that triggered it always succeeds. Reads
// (`listFixLog`, `listScans`, `getSnapshot`, …) are awaited and only ever run
// from the lazy-loaded History tab — never on the hot fix/scan path.
//
// Storage seam: the backend is an interface (`HistoryStore`). Today it is backed
// by the browser's IndexedDB (`idbStore`), which needs no server provisioning and
// is fully self-contained. When the Rayfin-managed database (DAB) becomes
// available for this app, drop in a second `HistoryStore` implementation that
// POSTs to the auto-generated REST entities — no caller changes required.

export type HistoryItemKind = 'model' | 'report';

/** One row per applied fix (DB-1, append-only audit trail). */
export interface FixLogEntry {
  id: string;
  ts: number;
  user: string;
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  fixer: string;
  rule?: string;
  objectPath?: string;
  result: 'ok' | 'fail';
  changed: number;
  message?: string;
  /** Link to a DB-2 snapshot that can revert this fix, when one was captured. */
  snapshotId?: string;
  reverted?: boolean;
}

/** Pre-fix definition part kept so a fix can be rolled back (DB-2). */
export interface SnapshotEntry {
  id: string;
  ts: number;
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  fixer: string;
  partPath: string;
  /** gzip-compressed UTF-8 of the pre-fix part, or the raw string as a fallback. */
  before: Uint8Array | string;
  /** Uncompressed byte length, for the retention/size display. */
  size: number;
}

/** One persisted BPA scan result (DB-3, quality trend). */
export interface ScanRecord {
  id: string;
  ts: number;
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  ruleSetVersion: string;
  error: number;
  warning: number;
  info: number;
  total: number;
}

export interface FixLogFilter {
  workspaceId?: string;
  itemId?: string;
  fixer?: string;
  result?: 'ok' | 'fail';
}

interface HistoryStore {
  putFix(e: FixLogEntry): Promise<void>;
  putSnapshot(s: SnapshotEntry): Promise<void>;
  putScan(r: ScanRecord): Promise<void>;
  listFix(): Promise<FixLogEntry[]>;
  listScans(): Promise<ScanRecord[]>;
  getSnapshot(id: string): Promise<SnapshotEntry | undefined>;
  updateFix(id: string, patch: Partial<FixLogEntry>): Promise<void>;
  pruneSnapshots(keep: number): Promise<void>;
  clear(): Promise<void>;
}

// --------------------------------------------------------------------------- //
// Retention / size policy
// --------------------------------------------------------------------------- //

/** Skip persisting snapshots whose pre-fix text exceeds this (avoids bloating
 *  IndexedDB with huge report definitions). Fix still succeeds; only undo is
 *  unavailable for that one entry. */
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024; // 2 MB uncompressed
/** Keep at most this many snapshots; oldest are pruned after each new one. */
const MAX_SNAPSHOTS = 100;

// --------------------------------------------------------------------------- //
// Compression helpers (gzip via CompressionStream, raw-string fallback)
// --------------------------------------------------------------------------- //

async function gzip(text: string): Promise<Uint8Array | string> {
  try {
    const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
    if (!CS) return text;
    const stream = new CS('gzip');
    const writer = stream.writable.getWriter();
    const src = new TextEncoder().encode(text);
    const chunk = new Uint8Array(src.length);
    chunk.set(src);
    void writer.write(chunk);
    void writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return text;
  }
}

async function gunzip(data: Uint8Array | string): Promise<string> {
  if (typeof data === 'string') return data;
  try {
    const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
    if (!DS) return new TextDecoder().decode(data);
    const stream = new DS('gzip');
    const writer = stream.writable.getWriter();
    const chunk = new Uint8Array(data.length);
    chunk.set(data);
    void writer.write(chunk);
    void writer.close();
    const buf = await new Response(stream.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  } catch {
    return new TextDecoder().decode(data);
  }
}

// --------------------------------------------------------------------------- //
// IndexedDB-backed store
// --------------------------------------------------------------------------- //

const DB_NAME = 'pbi-fixer-history';
const DB_VERSION = 1;
const STORE_FIX = 'fixLog';
const STORE_SNAP = 'snapshots';
const STORE_SCAN = 'scans';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FIX)) {
        db.createObjectStore(STORE_FIX, { keyPath: 'id' }).createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(STORE_SNAP)) {
        db.createObjectStore(STORE_SNAP, { keyPath: 'id' }).createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(STORE_SCAN)) {
        db.createObjectStore(STORE_SCAN, { keyPath: 'id' }).createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open history database.'));
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = body(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${mode} on ${store} failed.`));
  });
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return tx<T[]>(db, store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

const idbStore: HistoryStore = {
  async putFix(e) {
    const db = await openDb();
    await tx(db, STORE_FIX, 'readwrite', (s) => s.put(e));
    db.close();
  },
  async putSnapshot(snap) {
    const db = await openDb();
    await tx(db, STORE_SNAP, 'readwrite', (s) => s.put(snap));
    db.close();
  },
  async putScan(r) {
    const db = await openDb();
    await tx(db, STORE_SCAN, 'readwrite', (s) => s.put(r));
    db.close();
  },
  async listFix() {
    const db = await openDb();
    const rows = await getAll<FixLogEntry>(db, STORE_FIX);
    db.close();
    return rows.sort((a, b) => b.ts - a.ts);
  },
  async listScans() {
    const db = await openDb();
    const rows = await getAll<ScanRecord>(db, STORE_SCAN);
    db.close();
    return rows.sort((a, b) => a.ts - b.ts);
  },
  async getSnapshot(id) {
    const db = await openDb();
    const row = await tx<SnapshotEntry | undefined>(db, STORE_SNAP, 'readonly', (s) => s.get(id) as IDBRequest<SnapshotEntry | undefined>);
    db.close();
    return row;
  },
  async updateFix(id, patch) {
    const db = await openDb();
    const existing = await tx<FixLogEntry | undefined>(db, STORE_FIX, 'readonly', (s) => s.get(id) as IDBRequest<FixLogEntry | undefined>);
    if (existing) {
      await tx(db, STORE_FIX, 'readwrite', (s) => s.put({ ...existing, ...patch }));
    }
    db.close();
  },
  async pruneSnapshots(keep) {
    const db = await openDb();
    const rows = await getAll<SnapshotEntry>(db, STORE_SNAP);
    const stale = rows.sort((a, b) => b.ts - a.ts).slice(keep);
    if (stale.length) {
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE_SNAP, 'readwrite');
        const s = t.objectStore(STORE_SNAP);
        for (const row of stale) s.delete(row.id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('Prune failed.'));
      });
    }
    db.close();
  },
  async clear() {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([STORE_FIX, STORE_SNAP, STORE_SCAN], 'readwrite');
      t.objectStore(STORE_FIX).clear();
      t.objectStore(STORE_SNAP).clear();
      t.objectStore(STORE_SCAN).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('Clear failed.'));
    });
    db.close();
  },
};

const store: HistoryStore = idbStore;

// --------------------------------------------------------------------------- //
// Current user (set once from the app shell so write hooks stay dependency-free)
// --------------------------------------------------------------------------- //

let currentUser = 'unknown';
export function setCurrentUser(name: string | null | undefined): void {
  if (name) currentUser = name;
}

function uid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function warn(scope: string, err: unknown): void {
  // Quiet, non-blocking — history is best-effort and must never disrupt a fix.
  console.warn(`[history] ${scope} skipped:`, err);
}

// --------------------------------------------------------------------------- //
// Fire-and-forget write API (called WITHOUT await from fix/scan handlers)
// --------------------------------------------------------------------------- //

export interface LogFixInput {
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  fixer: string;
  rule?: string;
  objectPath?: string;
  result: 'ok' | 'fail';
  changed: number;
  message?: string;
  snapshotId?: string;
}

export interface SaveSnapshotInput {
  id: string;
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  fixer: string;
  partPath: string;
  before: string;
}

export interface RecordScanInput {
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  ruleSetVersion: string;
  error: number;
  warning: number;
  info: number;
}

/** DB-1 — append a change-log row. Fire-and-forget. */
export function logFix(input: LogFixInput): void {
  void (async () => {
    try {
      await store.putFix({ id: uid(), ts: Date.now(), user: currentUser, ...input });
    } catch (e) {
      warn('logFix', e);
    }
  })();
}

/** DB-2 — persist a pre-fix snapshot under the caller-supplied `id` so a
 *  matching change-log row can link to it. Fire-and-forget. */
export function saveSnapshot(input: SaveSnapshotInput): void {
  void (async () => {
    try {
      const size = input.before.length;
      if (size > MAX_SNAPSHOT_BYTES) {
        warn('saveSnapshot', `part ${input.partPath} (${size} bytes) exceeds the ${MAX_SNAPSHOT_BYTES} byte cap`);
        return;
      }
      const before = await gzip(input.before);
      await store.putSnapshot({
        id: input.id,
        ts: Date.now(),
        workspaceId: input.workspaceId,
        itemKind: input.itemKind,
        itemId: input.itemId,
        itemName: input.itemName,
        fixer: input.fixer,
        partPath: input.partPath,
        before,
        size,
      });
      await store.pruneSnapshots(MAX_SNAPSHOTS);
    } catch (e) {
      warn('saveSnapshot', e);
    }
  })();
}

/** DB-3 — record a scan result for the quality trend. Fire-and-forget. */
export function recordScan(input: RecordScanInput): void {
  void (async () => {
    try {
      await store.putScan({
        id: uid(),
        ts: Date.now(),
        total: input.error + input.warning + input.info,
        ...input,
      });
    } catch (e) {
      warn('recordScan', e);
    }
  })();
}

// --------------------------------------------------------------------------- //
// Read API (awaited — only the lazy-loaded History tab calls these)
// --------------------------------------------------------------------------- //

export async function listFixLog(filter: FixLogFilter = {}): Promise<FixLogEntry[]> {
  const rows = await store.listFix();
  return rows.filter(
    (r) =>
      (!filter.workspaceId || r.workspaceId === filter.workspaceId) &&
      (!filter.itemId || r.itemId === filter.itemId) &&
      (!filter.fixer || r.fixer === filter.fixer) &&
      (!filter.result || r.result === filter.result)
  );
}

export async function listScans(filter: { workspaceId?: string; itemId?: string } = {}): Promise<ScanRecord[]> {
  const rows = await store.listScans();
  return rows.filter(
    (r) => (!filter.workspaceId || r.workspaceId === filter.workspaceId) && (!filter.itemId || r.itemId === filter.itemId)
  );
}

/** Resolve a snapshot and return its decompressed pre-fix text, ready to write
 *  back through the existing surgical patch path. */
export async function getSnapshotText(id: string): Promise<{ snapshot: SnapshotEntry; text: string } | undefined> {
  const snapshot = await store.getSnapshot(id);
  if (!snapshot) return undefined;
  const text = await gunzip(snapshot.before);
  return { snapshot, text };
}

export function markReverted(fixId: string): void {
  void (async () => {
    try {
      await store.updateFix(fixId, { reverted: true });
    } catch (e) {
      warn('markReverted', e);
    }
  })();
}

export async function clearHistory(): Promise<void> {
  await store.clear();
}
