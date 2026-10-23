/**
 * Deciding whether one member change may be offered. Pure, so every refusal
 * is testable offline.
 *
 * These checks decide what the *app* does. Entra decides what actually
 * happens: a change the app allows can still be refused there, and a person
 * who bypasses the app is bound only by Entra.
 *
 * Everything is judged from live reads taken right before the change: group
 * properties, owners, members and the target user. Nothing is taken from the
 * stored records except which groups are activated and what they open.
 */
import { assessGroup } from './eligibility';
import type { DirectoryMember, GraphIdentity, GroupFacts, Readable } from './types';
import type { RowView } from './views';

export type ChangeAction = 'add' | 'remove';

export interface ChangeRequest {
  action: ChangeAction;
  groupId: string;
  /** The person, as resolved live from Graph. */
  user: DirectoryMember;
}

export interface ChangeContext {
  /** Member changes are switched on (advisory setting) and present in this build. */
  armed: boolean;
  /** The activated group as the acting person sees it, if any. */
  row: RowView | undefined;
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
  actor: GraphIdentity;
  isAppAdmin: boolean;
  /** The Entra group whose members are app admins, if the build names one. */
  adminGroupId?: string;
}

export type Refusal =
  | 'not-armed'
  | 'app-admin-group'
  | 'log-unavailable'
  | 'not-activated'
  | 'inactive'
  | 'group-not-readable'
  | 'group-ineligible'
  | 'owners-not-readable'
  | 'not-owner'
  | 'high-role-admin-only'
  | 'members-not-readable'
  | 'self-add'
  | 'not-a-user'
  | 'guest'
  | 'disabled'
  | 'user-unknown'
  | 'last-admin-member';

export interface ChangePlan {
  ok: boolean;
  refusals: Refusal[];
  /** Nothing to do: the person already is, or already is not, a direct member. */
  noop?: 'already-member' | 'not-member';
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function planChange(request: ChangeRequest, context: ChangeContext): ChangePlan {
  const refusals: Refusal[] = [];
  const { row, actor } = context;

  if (!context.armed) refusals.push('not-armed');
  // Adding someone to the admin group would make an app admin. Not through this app.
  if (context.adminGroupId && same(context.adminGroupId, request.groupId)) refusals.push('app-admin-group');
  if (!row || !same(row.group.groupId, request.groupId)) refusals.push('not-activated');
  else if (!row.group.active) refusals.push('inactive');

  if (context.facts.state !== 'ok' || !same(context.facts.value.id, request.groupId)) refusals.push('group-not-readable');
  else if (!assessGroup(context.facts.value).eligible) refusals.push('group-ineligible');

  // Who may act: an app admin, or a person Entra lists as owner right now.
  if (!context.isAppAdmin) {
    if (context.owners.state !== 'ok') refusals.push('owners-not-readable');
    else if (!context.owners.value.some((o) => same(o.id, actor.objectId))) refusals.push('not-owner');
    // Groups that carry the workspace Member or Admin role: app admins only.
    if (row?.highRole) refusals.push('high-role-admin-only');
  }

  const user = request.user;
  if (user.type !== 'user') refusals.push('not-a-user');

  if (request.action === 'add') {
    // Nobody adds themselves, whatever their role in the app.
    if (same(user.id, actor.objectId)) refusals.push('self-add');
    if (user.type === 'user') {
      const kind = (user.userType ?? '').toLowerCase();
      // What Graph did not say is unknown, and unknown is refused.
      if (kind === 'guest') refusals.push('guest');
      else if (kind !== 'member') refusals.push('user-unknown');
      if (user.accountEnabled === false) refusals.push('disabled');
      else if (user.accountEnabled !== true && !refusals.includes('user-unknown')) refusals.push('user-unknown');
    }
  }

  let noop: ChangePlan['noop'];
  if (context.members.state !== 'ok') {
    refusals.push('members-not-readable');
  } else {
    const isMember = context.members.value.some((m) => same(m.id, user.id));
    if (request.action === 'add' && isMember) noop = 'already-member';
    if (request.action === 'remove' && !isMember) noop = 'not-member';
    // Best effort: do not empty a group that carries a workspace Admin role.
    const carriesAdmin = !!row?.bindings.some((b) => b.kind === 'Workspace' && b.label === 'Admin');
    if (request.action === 'remove' && isMember && carriesAdmin && context.members.value.length <= 1) {
      refusals.push('last-admin-member');
    }
  }

  return { ok: refusals.length === 0, refusals, noop };
}

export const BULK_LIMIT = 100;

/** Split pasted text into distinct, plausible user principal names. */
export function parseBulk(text: string): { names: string[]; overLimit: number } {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const name = part.trim();
    if (!name || !name.includes('@')) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names: names.slice(0, BULK_LIMIT), overLimit: Math.max(0, names.length - BULK_LIMIT) };
}

/** A review date is a reminder. It must lie in the future and within the group's limit. */
export function checkReviewDate(isoDate: string, maxDays: number, today: Date): 'ok' | 'invalid' | 'past' | 'too-far' {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 'invalid';
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'invalid';
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((date.getTime() - start) / 86_400_000);
  if (days < 1) return 'past';
  if (maxDays > 0 && days > maxDays) return 'too-far';
  return 'ok';
}
