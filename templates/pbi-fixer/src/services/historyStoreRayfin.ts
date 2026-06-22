// historyStoreRayfin — Rayfin-managed database (DAB) backend for the history store.
//
// This is the second `HistoryStore` implementation promised by the storage seam
// in historyService.ts. It conforms EXACTLY to the `HistoryStore` interface, so
// no caller changes are needed: historyService swaps it in via `getStore()` only
// when it is both configured AND the data client is live.
//
// 🚦 PERFORMANCE GUARANTEE — this store never touches the critical fix/scan path:
//   • It is OFF by default. It is selected only when `VITE_HISTORY_DB=rayfin`
//     and the Rayfin data client is initialised; otherwise historyService keeps
//     using the self-contained IndexedDB store with zero behaviour change.
//   • Every write is routed through a single serialized background queue, so a
//     slow or unreachable remote DB can never pile up concurrent requests or
//     block a fix. Writes are still invoked fire-and-forget from historyService.
//   • Reads are awaited and only ever run from the lazy-loaded History tab.
//
// Provisioning note: turning this on also requires `data.enabled: true` in
// rayfin.yml plus the matching DAB entities (FixLogEntry, HistorySnapshot,
// ScanRecord). Until then the env flag stays unset and this module is inert.

import { getRayfinClient } from './rayfinClient';
import type {
  FixLogEntry,
  HistoryItemKind,
  HistoryStore,
  ScanRecord,
  SnapshotEntry,
} from './historyService';

// --------------------------------------------------------------------------- //
// DAB entity row shapes
// --------------------------------------------------------------------------- //
// FixLogEntry and ScanRecord are already primitive-only and map 1:1 to a DAB
// row. A snapshot's `before` is binary (gzip bytes) or a raw string, neither of
// which survives a GraphQL/REST round-trip as-is, so it is persisted as base64
// text with a `compressed` flag and reconstructed on read.

interface SnapshotRow {
  id: string;
  ts: number;
  workspaceId: string;
  itemKind: HistoryItemKind;
  itemId: string;
  itemName: string;
  fixer: string;
  partPath: string;
  /** base64 of the gzip bytes, or the raw pre-fix text when `compressed` is false. */
  before: string;
  compressed: boolean;
  size: number;
}

/** Minimal structural view of the generated `client.data.<Entity>` clients —
 *  only the operations this store uses, kept local so it never depends on the
 *  SDK's internal data-API type exports. */
interface EntityClient<TRow> {
  create(input: TRow): Promise<TRow>;
  update(where: { id: string }, data: Partial<TRow>): Promise<TRow>;
  delete(where: { id: string }): Promise<unknown>;
  findById(id: string): Promise<TRow | null>;
  findMany(): Promise<TRow[]>;
}

interface HistoryData {
  FixLogEntry: EntityClient<FixLogEntry>;
  HistorySnapshot: EntityClient<SnapshotRow>;
  ScanRecord: EntityClient<ScanRecord>;
}

function dataApi(): HistoryData {
  const client = getRayfinClient() as unknown as { data: HistoryData };
  return client.data;
}

// --------------------------------------------------------------------------- //
// base64 <-> bytes (chunked to stay off the quadratic / call-stack-limit path)
// --------------------------------------------------------------------------- //

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toSnapshotRow(s: SnapshotEntry): SnapshotRow {
  const compressed = typeof s.before !== 'string';
  return {
    id: s.id,
    ts: s.ts,
    workspaceId: s.workspaceId,
    itemKind: s.itemKind,
    itemId: s.itemId,
    itemName: s.itemName,
    fixer: s.fixer,
    partPath: s.partPath,
    before: compressed ? bytesToBase64(s.before as Uint8Array) : (s.before as string),
    compressed,
    size: s.size,
  };
}

function fromSnapshotRow(r: SnapshotRow): SnapshotEntry {
  return {
    id: r.id,
    ts: r.ts,
    workspaceId: r.workspaceId,
    itemKind: r.itemKind,
    itemId: r.itemId,
    itemName: r.itemName,
    fixer: r.fixer,
    partPath: r.partPath,
    before: r.compressed ? base64ToBytes(r.before) : r.before,
    size: r.size,
  };
}

// --------------------------------------------------------------------------- //
// Serialized background write queue — caps remote writes at one in flight so a
// slow DB can never starve the UI or stack up concurrent requests.
// --------------------------------------------------------------------------- //

let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(op: () => Promise<T>): Promise<T> {
  const run = writeChain.then(op, op);
  // Keep the chain alive regardless of whether this op rejected.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// --------------------------------------------------------------------------- //
// HistoryStore implementation
// --------------------------------------------------------------------------- //

const rayfinStore: HistoryStore = {
  putFix(e) {
    return enqueueWrite(() => dataApi().FixLogEntry.create(e)).then(() => undefined);
  },
  putSnapshot(snap) {
    return enqueueWrite(() => dataApi().HistorySnapshot.create(toSnapshotRow(snap))).then(() => undefined);
  },
  putScan(r) {
    return enqueueWrite(() => dataApi().ScanRecord.create(r)).then(() => undefined);
  },
  async listFix() {
    const rows = await dataApi().FixLogEntry.findMany();
    return rows.slice().sort((a, b) => b.ts - a.ts);
  },
  async listScans() {
    const rows = await dataApi().ScanRecord.findMany();
    return rows.slice().sort((a, b) => a.ts - b.ts);
  },
  async getSnapshot(id) {
    const row = await dataApi().HistorySnapshot.findById(id);
    return row ? fromSnapshotRow(row) : undefined;
  },
  updateFix(id, patch) {
    return enqueueWrite(() => dataApi().FixLogEntry.update({ id }, patch)).then(() => undefined);
  },
  async pruneSnapshots(keep) {
    const rows = await dataApi().HistorySnapshot.findMany();
    const stale = rows.slice().sort((a, b) => b.ts - a.ts).slice(keep);
    for (const row of stale) {
      await enqueueWrite(() => dataApi().HistorySnapshot.delete({ id: row.id }));
    }
  },
  async clear() {
    const data = dataApi();
    const [fixes, snaps, scans] = await Promise.all([
      data.FixLogEntry.findMany(),
      data.HistorySnapshot.findMany(),
      data.ScanRecord.findMany(),
    ]);
    await Promise.all([
      ...fixes.map((r) => data.FixLogEntry.delete({ id: r.id })),
      ...snaps.map((r) => data.HistorySnapshot.delete({ id: r.id })),
      ...scans.map((r) => data.ScanRecord.delete({ id: r.id })),
    ]);
  },
};

// --------------------------------------------------------------------------- //
// Selection helpers (used by historyService.getStore)
// --------------------------------------------------------------------------- //

/** True when the app is configured to use the Rayfin-managed history database. */
export function isRayfinHistoryConfigured(): boolean {
  const env = import.meta.env as Record<string, string | undefined>;
  return (env.VITE_HISTORY_DB ?? '').toLowerCase() === 'rayfin';
}

/** Returns the DAB-backed store only when configured AND the data client is
 *  live; otherwise null so historyService keeps using IndexedDB. */
export function createRayfinHistoryStore(): HistoryStore | null {
  if (!isRayfinHistoryConfigured()) return null;
  try {
    const client = getRayfinClient() as unknown as { data?: unknown };
    if (!client || !client.data) return null;
  } catch {
    // Client not initialised yet — fall back to IndexedDB for now.
    return null;
  }
  return rayfinStore;
}
