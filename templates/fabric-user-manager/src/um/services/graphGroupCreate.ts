/**
 * The one Graph call that creates a group.
 *
 * The fourth and last file in the feature that may send anything but GET, and
 * it can send exactly one thing: a POST to the fixed address of the groups
 * collection, for a security group without mail and without a membership
 * rule. A structural test enforces the verb and that nothing else imports
 * this file.
 *
 * - No group is ever changed or deleted here: there is no address with an id.
 * - The body is built from validated parts only. Owners are object ids.
 * - Never role-assignable, never mail-enabled, never dynamic: those are the
 *   kinds of group the app refuses to manage.
 *
 * Loaded only in builds made with changes (`VITE_UM_WRITES=true`).
 */
import { GROUP_LIMITS, isCleanText, isValidGroupName } from '@/um/domain/groupCreate';
import { isGuid } from '@/um/domain/types';

import { GRAPH_BASE, type GraphFetch } from './graphRead';

export const CREATE_GROUP_URL = `${GRAPH_BASE}/groups`;

export interface NewGroup {
  displayName: string;
  description: string;
  mailNickname: string;
  /** Owners besides the person who creates the group. */
  ownerIds: readonly string[];
}

/** The exact body for one new group, or `null` when a part is not what it must be. */
export function groupBody(group: NewGroup): string | null {
  const name = group.displayName;
  // Checked here again, not only where the plan is made: this is the last place before it leaves.
  if (!isValidGroupName(name) || name !== name.trim()) return null;
  if (group.description.length > GROUP_LIMITS.description || !isCleanText(group.description)) return null;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(group.mailNickname)) return null;
  if (group.ownerIds.length > GROUP_LIMITS.owners || group.ownerIds.some((id) => !isGuid(id))) return null;
  return JSON.stringify({
    displayName: name,
    ...(group.description ? { description: group.description } : {}),
    mailEnabled: false,
    mailNickname: group.mailNickname,
    securityEnabled: true,
    ...(group.ownerIds.length > 0 ? { 'owners@odata.bind': group.ownerIds.map((id) => `${GRAPH_BASE}/users/${id.toLowerCase()}`) } : {}),
  });
}

/**
 * `uncertain` means the group may or may not exist now: no answer arrived, the
 * service answered with a server error, or it answered without a usable id.
 * The caller looks for the group by name and never simply sends again, since
 * a second POST would create a second group.
 */
export type CreateOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'bad-request' | 'denied' | 'actor-mismatch' | 'rate-limited' | 'uncertain' | 'failed'; status?: number };

export const CREATE_TIMEOUT_MS = 20_000;

export async function createGroup(group: NewGroup, token: string, fetcher: GraphFetch = (url, init) => fetch(url, init)): Promise<CreateOutcome> {
  const body = groupBody(group);
  if (!body) return { ok: false, code: 'bad-request' };

  let response: Response;
  try {
    response = await fetcher(CREATE_GROUP_URL, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: 'uncertain' };
  }

  if (response.status === 201 || response.status === 200) {
    const created: unknown = await response.json().catch(() => null);
    const id = created && typeof created === 'object' ? (created as { id?: unknown }).id : undefined;
    return isGuid(id) ? { ok: true, id: id.toLowerCase() } : { ok: false, code: 'uncertain', status: response.status };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, code: 'denied', status: response.status };
  if (response.status === 429) return { ok: false, code: 'rate-limited', status: 429 };
  if (response.status === 0 || response.status >= 500) return { ok: false, code: 'uncertain', status: response.status };
  return { ok: false, code: 'failed', status: response.status };
}
