import { RayfinClient } from '@microsoft/rayfin-client';
import type { OpaqueSession } from '@microsoft/rayfin-auth';
import { initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';

import type { RestockRequest } from '../../rayfin/data/RestockRequest';
import { dateOf } from '../reorder/queries/model-row';

/**
 * The LIVE half of the Reorder tab: who is signed in, and the reorders in the app's own SQL
 * database. Everything else on the tab comes from the baked snapshot.
 *
 * ⚠️ NO FUNCTIONS, NO CONNECTOR. Both run through Fabric's delegated Functions Service, which makes
 * the deployed app open only for its owner. The data API with a Fabric-brokered session does not.
 *
 * ⚠️ READS USE `select([...]).execute()`, NEVER `findMany`: findMany answers only `id` (measured on
 * this Rayfin line), and every column would read as undefined.
 */
export type AppSchema = { RestockRequest: RestockRequest };
export type LiveClient = RayfinClient<AppSchema>;

/** Fabric portal of the public cloud. */
const FABRIC_PORTAL_URL = 'https://app.fabric.microsoft.com';

let client: LiveClient | null = null;

/** Null when this build carries no Rayfin deployment (local dev without `rayfin up`). */
export function liveClient(): LiveClient | null {
  const baseUrl = import.meta.env.VITE_RAYFIN_API_URL;
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;
  if (!baseUrl || !publishableKey) return null;
  client ??= new RayfinClient<AppSchema>({ baseUrl, publishableKey, authStorage: true });
  return client;
}

/** Inside the Fabric portal the app runs in an iframe; opened directly or from the launcher it does not. */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent throws on access: that IS an embedding
  }
}

export type SignIn =
  | { kind: 'signed-in'; user: { id: string; email: string } }
  | { kind: 'read-only'; reason: 'not-embedded' | 'offline' | 'not-deployed' | 'failed'; detail?: string };

/**
 * Fabric embedded sign-in, never a popup. Anything but a session leaves the tab read-only: the
 * snapshot figures still show, the reorder actions say why they are off.
 */
export async function signIn(): Promise<SignIn> {
  const c = liveClient();
  if (!c) return { kind: 'read-only', reason: 'not-deployed' };
  if (!isEmbedded()) return { kind: 'read-only', reason: 'not-embedded' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'read-only', reason: 'offline' };
  const workspaceId = import.meta.env.VITE_RAYFIN_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_RAYFIN_PROJECT_ID;
  if (!workspaceId || !projectId) return { kind: 'read-only', reason: 'not-deployed' };
  try {
    const session: OpaqueSession | null = await initEmbeddedAuth(c.auth, {
      workspaceId,
      projectId,
      fabricPortalUrl: FABRIC_PORTAL_URL,
      returnOrigin: window.location.origin,
      // Declared, not sniffed: the gate's sign-in redirect drops `?fabricEmbedded=true`.
      fabricEmbedded: true,
    });
    const user = session?.isAuthenticated ? session.user : null;
    if (!user?.id || !user.email) {
      console.warn('[reorder] Fabric sign-in returned no user id or email');
      return { kind: 'read-only', reason: 'failed', detail: 'no user on the session' };
    }
    return { kind: 'signed-in', user: { id: user.id, email: user.email } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // The message only, never a token: so a presenter can see WHY inside Fabric.
    console.warn('[reorder] Fabric sign-in failed:', detail);
    return { kind: 'read-only', reason: 'failed', detail };
  }
}

/** A reorder as the tab shows it. Names are resolved from the snapshot's dimension maps. */
export interface LiveReorder {
  id: string;
  storeId: string;
  sku: string;
  units: number;
  requestedBy: string;
  requestedById: string;
  requestedAt: Date;
  status: 'submitted' | 'fulfilled';
}

const COLUMNS = ['id', 'store_id', 'sku', 'qty', 'requested_by', 'requested_by_id', 'requested_at', 'status'] as const;

/**
 * The data client converts ISO texts to Date on the way out (measured); accept both. A NAKED
 * datetime text (no offset) is UTC in the database and must not be read as local time:
 * `dateOf` appends the `Z`, as it does for the model's datetimes.
 */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : dateOf(value);
}

export function toLiveReorder(row: Record<string, unknown>): LiveReorder {
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    sku: String(row.sku),
    units: Number(row.qty),
    requestedBy: String(row.requested_by ?? ''),
    requestedById: String(row.requested_by_id ?? ''),
    requestedAt: toDate(row.requested_at),
    status: row.status === 'fulfilled' ? 'fulfilled' : 'submitted',
  };
}

/**
 * Every reorder, newest first. ⚠️ `execute()` answers ONE page of 100 rows by default and truncates
 * silently; the demo table stays far below 1,000, and the order puts the newest first
 * if it ever does not.
 */
export const READ_LIMIT = 1000;
export async function readReorders(c: LiveClient): Promise<LiveReorder[]> {
  const rows = await c.data.RestockRequest.select([...COLUMNS])
    .orderBy({ requested_at: 'desc' })
    .first(READ_LIMIT)
    .execute();
  return (rows as unknown as Record<string, unknown>[])
    .map(toLiveReorder)
    .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}

/** Units on order per `storeId:sku` — the model's "open" rule: sent and not yet fulfilled. */
export function unitsOnOrder(reorders: LiveReorder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of reorders) {
    if (r.status !== 'submitted') continue;
    const key = `${r.storeId}:${r.sku}`;
    out.set(key, (out.get(key) ?? 0) + r.units);
  }
  return out;
}

/** Requests made today, in UTC — the model's `Reorders Sent Today` rule. */
export function sentToday(reorders: LiveReorder[], now: Date = new Date()): number {
  const today = now.toISOString().slice(0, 10);
  return reorders.filter((r) => r.requestedAt.toISOString().slice(0, 10) === today).length;
}

/** A purchase-order number the stand-in purchasing system would have returned. */
export function purchaseOrderId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/\D/g, '').slice(2, 14);
  const random = Math.floor(Math.random() * 46656).toString(36).toUpperCase().padStart(3, '0');
  return `PO-${stamp}-${random}`;
}

/**
 * Send one reorder. ⚠️ The requester is CLIENT-ASSERTED from the session (PLAN 5a item 3): the
 * server no longer stamps it, as `sendReorder` used to. Accepted for the demo.
 */
export async function sendReorder(
  c: LiveClient,
  user: { id: string; email: string },
  item: { storeId: string; sku: string },
  units: number,
): Promise<{ id: string; purchaseOrderId: string }> {
  requireIdentity(user);
  if (!Number.isInteger(units) || units <= 0) throw new Error(`invalid units ${units}`);
  const po = purchaseOrderId();
  const created = await c.data.RestockRequest.create({
    store_id: item.storeId,
    sku: item.sku,
    qty: units,
    requested_by: user.email,
    requested_by_id: user.id,
    requested_at: new Date(),
    status: 'submitted',
    note: `From the twin (Reorder tab) against ${po}.`,
  } as Omit<RestockRequest, 'id'> as RestockRequest);
  return { id: String((created as { id?: unknown }).id ?? ''), purchaseOrderId: po };
}

/**
 * ⚠️ A session without a subject would write `requested_by_id = ""`, and a
 * reset matching on "" would then delete every such row by ANYONE. No identity, no write, no delete.
 */
export function requireIdentity(user: { id: string; email: string }): void {
  if (typeof user.id !== 'string' || user.id.trim() === '' || typeof user.email !== 'string' || user.email.trim() === '') {
    throw new Error('the Fabric session carries no user id or email; nothing was written');
  }
}

/**
 * Demo reset: delete only the caller's own reorders; the seeded history stays.
 *
 * ⚠️ The data API itself would let any signed-in user delete any row (role `authenticated` with
 * `delete`, no policy possible on this session token). This scoping is the app's, not the server's.
 */
export async function resetMine(c: LiveClient, userId: string, reorders: LiveReorder[]): Promise<number> {
  requireIdentity({ id: userId, email: 'x' });
  const mine = reorders.filter((r) => r.requestedById === userId);
  for (const r of mine) await c.data.RestockRequest.delete({ id: r.id });
  return mine.length;
}
