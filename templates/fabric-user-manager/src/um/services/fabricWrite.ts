/**
 * The only Fabric writes of the Fabric User Manager: give one group one
 * workspace role, change that role, remove that assignment.
 *
 * Next to `graphWrite.ts` and `graphMail.ts` this is the third and last file
 * that may send anything but a read, and it can reach exactly three requests:
 *
 * - All URLs are built in `roleRequest` from validated ids on a constant origin.
 * - An add always names a group, never a user or a service principal, and
 *   always one of the four workspace roles.
 * - One assignment per call. Nothing is retried.
 *
 * Loaded only in builds made with changes (`VITE_UM_WRITES=true`).
 */
import { WORKSPACE_ROLES, isGuid, type WorkspaceRole } from '@/um/domain/types';

import { FABRIC_API_ORIGIN } from './fabricOps';
import type { GraphFetch } from './graphRead';

export type RoleChange =
  | { action: 'add'; workspaceId: string; groupId: string; role: WorkspaceRole }
  | { action: 'change'; workspaceId: string; assignmentId: string; role: WorkspaceRole }
  | { action: 'remove'; workspaceId: string; assignmentId: string };

export interface RoleRequest {
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: string;
}

const isRole = (value: unknown): value is WorkspaceRole => (WORKSPACE_ROLES as readonly unknown[]).includes(value);

/** The exact request for one role assignment change, or `null` for anything not made of valid ids and a known role. */
export function roleRequest(change: RoleChange): RoleRequest | null {
  if (!isGuid(change.workspaceId)) return null;
  const base = `${FABRIC_API_ORIGIN}/v1/workspaces/${change.workspaceId.toLowerCase()}/roleAssignments`;
  switch (change.action) {
    case 'add':
      if (!isGuid(change.groupId) || !isRole(change.role)) return null;
      return { method: 'POST', url: base, body: JSON.stringify({ principal: { id: change.groupId.toLowerCase(), type: 'Group' }, role: change.role }) };
    case 'change':
      if (!isGuid(change.assignmentId) || !isRole(change.role)) return null;
      return { method: 'PATCH', url: `${base}/${change.assignmentId.toLowerCase()}`, body: JSON.stringify({ role: change.role }) };
    case 'remove':
      if (!isGuid(change.assignmentId)) return null;
      return { method: 'DELETE', url: `${base}/${change.assignmentId.toLowerCase()}` };
    default:
      return null;
  }
}

/**
 * `uncertain` means the request may or may not have been applied: no answer
 * arrived, or the service answered with a server error. The caller reads the
 * assignments again before saying anything, and does not retry.
 */
export type RoleWriteOutcome =
  | { ok: true }
  | { ok: false; code: 'bad-request' | 'denied' | 'actor-mismatch' | 'conflict' | 'not-found' | 'rate-limited' | 'uncertain' | 'failed'; status?: number };

export const ROLE_WRITE_TIMEOUT_MS = 20_000;

export async function writeRole(change: RoleChange, token: string, fetcher: GraphFetch = (url, init) => fetch(url, init)): Promise<RoleWriteOutcome> {
  const request = roleRequest(change);
  if (!request) return { ok: false, code: 'bad-request' };

  let response: Response;
  try {
    response = await fetcher(request.url, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
      body: request.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(ROLE_WRITE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'uncertain' };
  }

  if (response.ok) return { ok: true };
  const status = response.status;
  if (status === 401 || status === 403) return { ok: false, code: 'denied', status };
  if (status === 404) return { ok: false, code: 'not-found', status };
  if (status === 409) return { ok: false, code: 'conflict', status };
  if (status === 429) return { ok: false, code: 'rate-limited', status };
  // 0 is an opaque redirect; with a server error the change may have happened.
  if (status === 0 || status >= 500) return { ok: false, code: 'uncertain', status };
  return { ok: false, code: 'failed', status };
}
