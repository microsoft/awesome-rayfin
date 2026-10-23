/**
 * The only Graph writes of the Fabric User Manager: add one existing user to
 * a group, remove one member from a group.
 *
 * This is the single file in the feature that may send anything but GET. A
 * structural test enforces that, and that nothing else here can be reached:
 *
 * - Both URLs are built in `memberRef` from two validated object ids.
 * - The remove path always ends in `/$ref`. Without it, the same DELETE
 *   addresses the directory object itself; with broader permissions that
 *   would delete the user, not the membership.
 * - One member per call. No batch, no PATCH, no other verb.
 *
 * Loaded only in builds made with member changes (`VITE_UM_WRITES=true`).
 */
import { isGuid } from '@/um/domain/types';

import { GRAPH_BASE, type GraphFetch } from './graphRead';

export interface MemberRef {
  method: 'POST' | 'DELETE';
  url: string;
  body?: string;
}

/** The exact request for one membership change, or `null` for anything that is not two object ids. */
export function memberRef(action: 'add' | 'remove', groupId: string, userId: string): MemberRef | null {
  if (!isGuid(groupId) || !isGuid(userId)) return null;
  const group = groupId.toLowerCase();
  const user = userId.toLowerCase();
  if (action === 'add') {
    return {
      method: 'POST',
      url: `${GRAPH_BASE}/groups/${group}/members/$ref`,
      body: JSON.stringify({ '@odata.id': `${GRAPH_BASE}/directoryObjects/${user}` }),
    };
  }
  return { method: 'DELETE', url: `${GRAPH_BASE}/groups/${group}/members/${user}/$ref` };
}

/**
 * `uncertain` means the request may or may not have been applied: no answer
 * arrived, or the service answered with a server error. The caller must look
 * at the group again before saying anything, and must not simply retry.
 */
export type WriteOutcome =
  | { ok: true }
  | {
      ok: false;
      code: 'bad-request' | 'denied' | 'actor-mismatch' | 'already-member' | 'not-member' | 'rate-limited' | 'uncertain' | 'failed';
      status?: number;
    };

export const WRITE_TIMEOUT_MS = 15_000;

export async function writeMember(
  action: 'add' | 'remove',
  groupId: string,
  userId: string,
  token: string,
  fetcher: GraphFetch = (url, init) => fetch(url, init)
): Promise<WriteOutcome> {
  const request = memberRef(action, groupId, userId);
  if (!request) return { ok: false, code: 'bad-request' };
  // Belt and braces for the one mistake that must never ship.
  if (request.method === 'DELETE' && !request.url.endsWith('/$ref')) return { ok: false, code: 'bad-request' };

  let response: Response;
  try {
    response = await fetcher(request.url, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
      body: request.body,
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch {
    // No answer: the change may have been applied all the same.
    return { ok: false, code: 'uncertain' };
  }

  if (response.status === 204 || response.ok) return { ok: true };
  if (response.status === 401 || response.status === 403) return { ok: false, code: 'denied', status: response.status };
  if (response.status === 429) return { ok: false, code: 'rate-limited', status: 429 };
  if (response.status === 404 && action === 'remove') return { ok: false, code: 'not-member', status: 404 };
  if (response.status === 400 && action === 'add') {
    // Graph answers 400 both for "already a member" and for real mistakes.
    const text = await response.text().catch(() => '');
    if (/already exist/i.test(text)) return { ok: false, code: 'already-member', status: 400 };
  }
  if (response.status >= 500) return { ok: false, code: 'uncertain', status: response.status };
  return { ok: false, code: 'failed', status: response.status };
}
