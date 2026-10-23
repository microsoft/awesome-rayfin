/**
 * Deciding the creation of a new security group. Pure.
 *
 * Creating a group gives nobody access to anything: a new group is empty and
 * bound to nothing. What matters is who owns it, because owners decide who
 * gets in later. The creator is an owner: Entra adds the person who creates a
 * group with their own sign-in. Proven on 2026-10-10 on two throwaway groups,
 * with and without a further owner in the request, for an account without a
 * group administration role. For an administrator this is not certain, which
 * is why the owners are read back after creating and a missing creator is
 * reported loudly. Further owners are chosen by the admin and looked up live. An owner who is not an app admin is allowed and flagged: it
 * blocks the workspace Member and Admin roles for this group later.
 */
import { isGuid, type DirectoryMember, type GraphIdentity, type Readable } from './types';

export const GROUP_LIMITS = { nameMin: 3, nameMax: 120, description: 1000, owners: 10 } as const;

/** Letters, digits, space and a few separators. No control characters, no quotes. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._()&+-]*[\p{L}\p{N})]$/u;

/** The one rule for a group name, used by the plan and again by the file that sends. */
export function isValidGroupName(name: string): boolean {
  return name.length >= GROUP_LIMITS.nameMin && name.length <= GROUP_LIMITS.nameMax && NAME.test(name);
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** A description may hold line breaks and tabs, no other control characters. */
export function isCleanText(text: string): boolean {
  return !CONTROL.test(text);
}

function part(text: string): string {
  return text
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** `FAB-<Scope>-<Role>`, for example `FAB-Sales-Reporting-Viewer`. A suggestion; the admin may change it. */
export function suggestGroupName(scope: string, role: string): string {
  return ['FAB', part(scope), part(role)].filter(Boolean).join('-').slice(0, GROUP_LIMITS.nameMax);
}

/**
 * Entra wants a mail alias even for a group without mail. ASCII only, no
 * spaces, unique enough: the name's plain letters plus a random tail.
 */
export function mailNicknameFor(displayName: string, tail: string): string {
  const base = displayName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const end = tail.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return [base || 'group', end].filter(Boolean).join('-');
}

/** A group as a search by name returns it. The mail alias tells one creation attempt from another. */
export interface NamedGroup {
  id: string;
  displayName: string;
  mailNickname?: string;
}

export interface GroupCreateRequest {
  displayName: string;
  description: string;
  /** Owners in addition to the creator, by Entra object id. */
  ownerIds: readonly string[];
}

export interface GroupCreateContext {
  armed: boolean;
  isAppAdmin: boolean;
  actor: GraphIdentity;
  /** Groups that already carry this exact name, read live. */
  sameName: Readable<NamedGroup[]>;
  /** Each chosen owner, looked up live by object id. `null` inside means "no such person". */
  owners: Readable<(DirectoryMember | null)[]>;
  /** Everyone who counts as an app admin. */
  appAdminIds: Readable<string[]>;
}

export type GroupCreateRefusal =
  | 'not-armed'
  | 'not-app-admin'
  | 'log-unavailable'
  | 'bad-name'
  | 'description-too-long'
  | 'names-not-readable'
  | 'name-exists'
  | 'too-many-owners'
  | 'owners-not-readable'
  | 'owner-unknown'
  | 'owner-not-a-person'
  | 'owner-disabled'
  | 'changed-since-preview';

export type GroupCreateWarning = 'owner-not-app-admin' | 'owner-guest' | 'admins-not-readable';

export interface GroupCreatePlan {
  ok: boolean;
  refusals: GroupCreateRefusal[];
  warnings: GroupCreateWarning[];
  displayName: string;
  description: string;
  /** Chosen owners without the creator and without repeats, in lower case. */
  ownerIds: string[];
  /** The chosen owners as the directory names them, for the preview. */
  owners: DirectoryMember[];
}

export function planGroupCreate(request: GroupCreateRequest, context: GroupCreateContext): GroupCreatePlan {
  const refusals: GroupCreateRefusal[] = [];
  const warnings: GroupCreateWarning[] = [];
  const displayName = request.displayName.trim().replace(/\s+/g, ' ');
  const description = request.description.trim();
  const actorId = context.actor.objectId.toLowerCase();
  // The creator becomes an owner anyway; naming them again adds nothing.
  const ownerIds = [...new Set(request.ownerIds.map((id) => id.trim().toLowerCase()).filter((id) => id !== actorId))];

  if (!context.armed) refusals.push('not-armed');
  if (!context.isAppAdmin) refusals.push('not-app-admin');
  if (!isValidGroupName(displayName)) refusals.push('bad-name');
  if (description.length > GROUP_LIMITS.description || !isCleanText(description)) refusals.push('description-too-long');

  // Two groups with one name cannot be told apart in Fabric's pickers.
  if (context.sameName.state !== 'ok') refusals.push('names-not-readable');
  else if (context.sameName.value.some((g) => g.displayName.trim().toLowerCase() === displayName.toLowerCase())) refusals.push('name-exists');

  const owners: DirectoryMember[] = [];
  if (ownerIds.length > GROUP_LIMITS.owners || ownerIds.some((id) => !isGuid(id))) refusals.push('too-many-owners');
  else if (ownerIds.length > 0) {
    if (context.owners.state !== 'ok' || context.owners.value.length !== ownerIds.length) refusals.push('owners-not-readable');
    else {
      for (const [index, found] of context.owners.value.entries()) {
        // The answer must be about the very id that was asked for.
        if (!found || found.id.toLowerCase() !== ownerIds[index]) refusals.push('owner-unknown');
        else if (found.type !== 'user') refusals.push('owner-not-a-person');
        else if (found.accountEnabled === false) refusals.push('owner-disabled');
        else {
          owners.push(found);
          if (found.userType === 'Guest') warnings.push('owner-guest');
        }
      }
      if (context.appAdminIds.state !== 'ok') warnings.push('admins-not-readable');
      else {
        const admins = new Set(context.appAdminIds.value.map((id) => id.toLowerCase()));
        if (ownerIds.some((id) => !admins.has(id))) warnings.push('owner-not-app-admin');
      }
    }
  }

  return { ok: refusals.length === 0, refusals: [...new Set(refusals)], warnings: [...new Set(warnings)], displayName, description, ownerIds, owners };
}

/** What the admin saw and confirmed. The group is only created if this still holds. */
export type PreviewedGroup = Pick<GroupCreatePlan, 'displayName' | 'description' | 'ownerIds'>;

export function sameGroupPlan(shown: PreviewedGroup, now: PreviewedGroup): boolean {
  return shown.displayName === now.displayName && shown.description === now.description && shown.ownerIds.join(',') === now.ownerIds.join(',');
}
