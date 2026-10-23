/**
 * Fabric User Manager: the closed list of Fabric API calls.
 *
 * The Fabric API answers browser calls from the app's address, so these
 * operations run in the browser with the signed-in person's own delegated
 * token. No backend function and no proxy are involved.
 *
 * This module is the only place a Fabric URL is built:
 *
 * - A closed set of operations. No free path, method, header or body.
 * - Every URL is assembled here, from a constant origin and validated ids.
 * - The token is forwarded as an opaque credential. It is never decoded,
 *   logged, stored or echoed.
 * - It adds no authority and removes none: Fabric decides what the caller
 *   may read.
 *
 * Read operations only. Role-assignment writes are in `fabricWrite.ts`.
 *
 * `fetch` and the clock are injected, so all of this is tested offline.
 */

export const FABRIC_API_ORIGIN = 'https://api.fabric.microsoft.com';

export const FABRIC_OP_LIMITS = {
  pages: 20,
  items: 5000,
  bytes: 4_000_000,
  durationMs: 30_000,
  pageTimeoutMs: 10_000,
} as const;

export const ITEM_TYPES = ['OrgApp', 'OrgAppAudience', 'SemanticModel'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type FabricOpRequest =
  | { op: 'listWorkspaces' }
  | { op: 'listRoleAssignments'; workspaceId: string }
  | { op: 'listItems'; workspaceId: string; itemType: ItemType }
  /** Who can access one item. A Fabric administrator API (preview, 200 calls per hour). */
  | { op: 'listItemAccess'; workspaceId: string; itemId: string };

export type FabricOpCode =
  | 'AUTH_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'ACCESS_DENIED'
  | 'RATE_LIMITED'
  | 'READ_FAILED'
  | 'INVALID_RESPONSE'
  | 'LIMIT_EXCEEDED';

export interface WorkspaceRecord {
  id: string;
  displayName: string;
  type: string;
}
export interface RoleAssignmentRecord {
  id: string;
  principalId: string;
  principalType: string;
  principalName: string;
  role: string;
}
export interface ItemRecord {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}

/** One access entry of an item. The same principal can appear more than once. */
export interface ItemAccessRecord {
  principalId: string;
  principalType: string;
  principalName: string;
  permissions: string[];
}

export type FabricOpResult =
  | { ok: true; op: 'listItemAccess'; value: ItemAccessRecord[]; observedAt: string }
  | { ok: true; op: 'listWorkspaces'; value: WorkspaceRecord[]; observedAt: string }
  | { ok: true; op: 'listRoleAssignments'; value: RoleAssignmentRecord[]; observedAt: string }
  | { ok: true; op: 'listItems'; value: ItemRecord[]; observedAt: string }
  | { ok: false; code: FabricOpCode };

const GUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const NIL_GUID = /^0{8}(-0{4}){3}-0{12}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;

function isGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID.test(value) && !NIL_GUID.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Printable, trimmed, bounded text. Provider strings are data, never markup. */
function isText(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

class OpError extends Error {
  constructor(readonly code: FabricOpCode) {
    super(code);
  }
}

/**
 * Validate a request against the closed operation list. Anything else,
 * including an extra property, is refused before a single network call.
 */
export function parseRequest(raw: unknown): FabricOpRequest | null {
  if (!isObject(raw) || typeof raw.op !== 'string') return null;
  switch (raw.op) {
    case 'listWorkspaces':
      return hasExactKeys(raw, ['op']) ? { op: 'listWorkspaces' } : null;
    case 'listRoleAssignments':
      return hasExactKeys(raw, ['op', 'workspaceId']) && isGuid(raw.workspaceId)
        ? { op: 'listRoleAssignments', workspaceId: raw.workspaceId.toLowerCase() }
        : null;
    case 'listItems':
      return hasExactKeys(raw, ['op', 'workspaceId', 'itemType']) &&
        isGuid(raw.workspaceId) &&
        (ITEM_TYPES as readonly unknown[]).includes(raw.itemType)
        ? { op: 'listItems', workspaceId: raw.workspaceId.toLowerCase(), itemType: raw.itemType as ItemType }
        : null;
    case 'listItemAccess':
      return hasExactKeys(raw, ['op', 'workspaceId', 'itemId']) && isGuid(raw.workspaceId) && isGuid(raw.itemId)
        ? { op: 'listItemAccess', workspaceId: raw.workspaceId.toLowerCase(), itemId: raw.itemId.toLowerCase() }
        : null;
    default:
      return null;
  }
}

/** The only place a Fabric URL is assembled. */
export function pathFor(request: FabricOpRequest): string {
  switch (request.op) {
    case 'listWorkspaces':
      return '/v1/workspaces';
    case 'listRoleAssignments':
      return `/v1/workspaces/${request.workspaceId}/roleAssignments`;
    case 'listItems':
      return `/v1/workspaces/${request.workspaceId}/items?type=${request.itemType}`;
    case 'listItemAccess':
      return `/v1/admin/workspaces/${request.workspaceId}/items/${request.itemId}/users`;
  }
}

function shapeWorkspace(raw: unknown): WorkspaceRecord {
  if (!isObject(raw) || !isGuid(raw.id) || !isText(raw.displayName, 512)) throw new OpError('INVALID_RESPONSE');
  const type = isText(raw.type, 64) && IDENTIFIER.test(raw.type) ? raw.type : 'Workspace';
  return { id: raw.id.toLowerCase(), displayName: raw.displayName, type };
}

function shapeRoleAssignment(raw: unknown): RoleAssignmentRecord {
  if (!isObject(raw) || !isGuid(raw.id) || !isObject(raw.principal)) throw new OpError('INVALID_RESPONSE');
  const principal = raw.principal;
  if (!isGuid(principal.id)) throw new OpError('INVALID_RESPONSE');
  if (!isText(principal.type, 64) || !IDENTIFIER.test(principal.type)) throw new OpError('INVALID_RESPONSE');
  if (!isText(raw.role, 64) || !IDENTIFIER.test(raw.role)) throw new OpError('INVALID_RESPONSE');
  return {
    id: raw.id.toLowerCase(),
    principalId: principal.id.toLowerCase(),
    principalType: principal.type,
    // A missing display name is normal for some principals; it is not an error.
    principalName: isText(principal.displayName, 512) ? principal.displayName : '',
    role: raw.role,
  };
}

function shapeItem(raw: unknown, workspaceId: string): ItemRecord {
  if (!isObject(raw) || !isGuid(raw.id) || !isText(raw.displayName, 512)) throw new OpError('INVALID_RESPONSE');
  if (!isText(raw.type, 128) || !IDENTIFIER.test(raw.type)) throw new OpError('INVALID_RESPONSE');
  if (raw.workspaceId !== undefined) {
    if (typeof raw.workspaceId !== 'string' || raw.workspaceId.toLowerCase() !== workspaceId) {
      throw new OpError('INVALID_RESPONSE');
    }
  }
  return { id: raw.id.toLowerCase(), displayName: raw.displayName, type: raw.type, workspaceId };
}

function shapeAccess(raw: unknown): ItemAccessRecord {
  if (!isObject(raw) || !isObject(raw.principal) || !isObject(raw.itemAccessDetails)) throw new OpError('INVALID_RESPONSE');
  const principal = raw.principal;
  if (!isGuid(principal.id)) throw new OpError('INVALID_RESPONSE');
  if (!isText(principal.type, 64) || !IDENTIFIER.test(principal.type)) throw new OpError('INVALID_RESPONSE');
  const names = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => isText(v, 64) && IDENTIFIER.test(v)) : [];
  return {
    principalId: principal.id.toLowerCase(),
    principalType: principal.type,
    principalName: isText(principal.displayName, 512) ? principal.displayName : '',
    permissions: [...names(raw.itemAccessDetails.permissions), ...names(raw.itemAccessDetails.additionalPermissions)],
  };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function validToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 32_000 && !/[\r\n\s]/.test(token);
}

/**
 * Run one operation with the caller's delegated Fabric token.
 *
 * A failed page yields no partial result: a truncated role list would read as
 * "nobody else has access".
 */
export async function runFabricOp(
  token: unknown,
  rawRequest: unknown,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<FabricOpResult> {
  if (!validToken(token)) return { ok: false, code: 'AUTH_UNAVAILABLE' };
  const request = parseRequest(rawRequest);
  if (!request) return { ok: false, code: 'BAD_REQUEST' };

  try {
    const base = FABRIC_API_ORIGIN + pathFor(request);
    const joiner = base.includes('?') ? '&' : '?';
    const deadline = now() + FABRIC_OP_LIMITS.durationMs;
    const seenCursors = new Set<string>();
    const seenIds = new Set<string>();
    const records: unknown[] = [];
    let cursor = '';
    let totalBytes = 0;
    let complete = false;

    for (let page = 0; page < FABRIC_OP_LIMITS.pages; page++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new OpError('LIMIT_EXCEEDED');

      const url = cursor ? `${base}${joiner}continuationToken=${encodeURIComponent(cursor)}` : base;
      const response = await fetcher(url, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.max(1, Math.min(FABRIC_OP_LIMITS.pageTimeoutMs, remaining))),
      });

      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) throw new OpError('RATE_LIMITED');
        throw new OpError(response.status === 401 || response.status === 403 ? 'ACCESS_DENIED' : 'READ_FAILED');
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!response.body || !contentType.includes('application/json')) {
        await response.body?.cancel().catch(() => {});
        throw new OpError('INVALID_RESPONSE');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let pageBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (now() >= deadline) throw new OpError('LIMIT_EXCEEDED');
          if (chunk.done) break;
          pageBytes += chunk.value.length;
          totalBytes += chunk.value.length;
          if (totalBytes > FABRIC_OP_LIMITS.bytes) throw new OpError('LIMIT_EXCEEDED');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }

      let body: unknown;
      try {
        const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks, pageBytes));
        if (bodyText.includes(token)) throw new OpError('INVALID_RESPONSE');
        body = JSON.parse(bodyText);
      } catch {
        throw new OpError('INVALID_RESPONSE');
      }
      if (!isObject(body)) throw new OpError('INVALID_RESPONSE');
      const list = request.op === 'listItemAccess' ? body.accessDetails : body.value;
      if (!Array.isArray(list)) throw new OpError('INVALID_RESPONSE');

      for (const raw of list) {
        if (request.op === 'listItemAccess') {
          // Entries have no id of their own, and a principal legitimately
          // appears once per route of access.
          records.push(shapeAccess(raw));
        } else {
          const record =
            request.op === 'listWorkspaces'
              ? shapeWorkspace(raw)
              : request.op === 'listRoleAssignments'
                ? shapeRoleAssignment(raw)
                : shapeItem(raw, request.workspaceId);
          if (seenIds.has(record.id)) throw new OpError('INVALID_RESPONSE');
          seenIds.add(record.id);
          records.push(record);
        }
        if (records.length > FABRIC_OP_LIMITS.items) throw new OpError('LIMIT_EXCEEDED');
      }

      const next = body.continuationToken;
      if (next === undefined || next === null || next === '') {
        complete = true;
        break;
      }
      // The continuation *token* is used; a continuation URI is never followed,
      // so the destination stays the one built above.
      if (typeof next !== 'string' || next.length > 4096 || seenCursors.has(next)) {
        throw new OpError('INVALID_RESPONSE');
      }
      seenCursors.add(next);
      cursor = next;
    }

    if (!complete) throw new OpError('LIMIT_EXCEEDED');

    const observedAt = new Date(now()).toISOString();
    switch (request.op) {
      case 'listWorkspaces':
        return { ok: true, op: request.op, value: records as WorkspaceRecord[], observedAt };
      case 'listRoleAssignments':
        return { ok: true, op: request.op, value: records as RoleAssignmentRecord[], observedAt };
      case 'listItems':
        return { ok: true, op: request.op, value: records as ItemRecord[], observedAt };
      case 'listItemAccess':
        return { ok: true, op: request.op, value: records as ItemAccessRecord[], observedAt };
    }
  } catch (error) {
    if (error instanceof OpError) return { ok: false, code: error.code };
    // Anything unexpected (network, timeout, malformed JSON) is one sanitized
    // code. The underlying message could carry the URL or provider text.
    return { ok: false, code: 'READ_FAILED' };
  }
}
