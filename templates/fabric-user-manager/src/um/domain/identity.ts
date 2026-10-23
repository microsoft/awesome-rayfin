/**
 * Who is acting.
 *
 * The Rayfin app session and the Graph sign-in are two separate sign-ins and
 * can belong to two different people. Every decision therefore uses only the
 * Entra object id that Graph `/me` returned for the token in hand.
 *
 * Whether a Rayfin session claim carries that same object id is unproven.
 * Until it is, a comparison by name can only ever warn: an e-mail
 * match is not proof of identity, and a mismatch is not proof of misuse
 * (aliases, guest addresses).
 */
import { isGuid, type GraphIdentity } from './types';

export type SessionMatch = 'match' | 'mismatch' | 'unknown';

export function shapeIdentity(raw: unknown): GraphIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const me = raw as Record<string, unknown>;
  if (!isGuid(me.id)) return null;
  const upn = typeof me.userPrincipalName === 'string' ? me.userPrincipalName : '';
  if (!upn) return null;
  return {
    objectId: me.id.toLowerCase(),
    userPrincipalName: upn,
    displayName: typeof me.displayName === 'string' && me.displayName ? me.displayName : upn,
    mail: typeof me.mail === 'string' ? me.mail : null,
  };
}

/** Compare the Graph identity with the app session's e-mail. Advisory only. */
export function compareWithSession(identity: GraphIdentity, sessionEmail: string | undefined): SessionMatch {
  const session = sessionEmail?.trim().toLowerCase();
  if (!session) return 'unknown';
  const names = [identity.userPrincipalName, identity.mail ?? '']
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
  return names.includes(session) ? 'match' : 'mismatch';
}

export function sameObject(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
