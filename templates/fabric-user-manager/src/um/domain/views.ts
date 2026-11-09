/**
 * What one signed-in person sees. Pure.
 *
 * The relation to a group (owner, member, app admin) decides what the app
 * *offers*. It is advisory: Entra decides what a person can actually read or
 * change.
 */
import { rowAccess, type RowAccess } from './activation';
import { isHighRoleGroup, mergeBindings } from './discovery';
import { describeBindings, type MemberExportRow } from './sheet';
import type { Binding, DirectoryMember, ManagedGroup, Readable, TargetKind } from './types';

export interface RowView {
  group: ManagedGroup;
  bindings: Binding[];
  /** Bound to the workspace Member or Admin role, as far as known. */
  highRole: boolean;
  access: Exclude<RowAccess, 'hidden'>;
  isOwner: boolean;
  isMember: boolean;
}

export interface ViewerFacts {
  isAppAdmin: boolean;
  ownedGroupIds: readonly string[];
  memberGroupIds: readonly string[];
}

/** All activated groups the viewer may see, with what they give access to. */
export function buildRows(
  managed: readonly ManagedGroup[],
  storedBindings: readonly Binding[],
  discoveredBindings: readonly Binding[],
  viewer: ViewerFacts
): RowView[] {
  const owned = new Set(viewer.ownedGroupIds.map((id) => id.toLowerCase()));
  const member = new Set(viewer.memberGroupIds.map((id) => id.toLowerCase()));
  const rows: RowView[] = [];

  for (const group of managed) {
    const id = group.groupId.toLowerCase();
    const stored = storedBindings.filter((b) => b.groupId.toLowerCase() === id);
    const read = discoveredBindings.filter((b) => b.groupId.toLowerCase() === id);
    const bindings = mergeBindings(read, stored);
    const highRole = isHighRoleGroup(bindings);
    const isOwner = owned.has(id);
    const isMember = member.has(id);
    const access = rowAccess(group, { isAppAdmin: viewer.isAppAdmin, isOwner, isMember }, highRole);
    if (access === 'hidden') continue;
    rows.push({ group, bindings, highRole, access, isOwner, isMember });
  }
  return rows.sort((a, b) => a.group.nameSnapshot.localeCompare(b.group.nameSnapshot));
}

/** Rows that belong on one tab: those with at least one binding of that kind. */
export function rowsForKind(rows: readonly RowView[], kind: TargetKind): RowView[] {
  return rows.filter((r) => r.bindings.some((b) => b.kind === kind));
}

export type MembershipState = 'member' | 'not-member' | 'not-readable';

export interface PersonMatch {
  row: RowView;
  state: MembershipState;
}

/**
 * Where one person is a direct member, across the rows the viewer manages.
 * Rows the viewer does not manage are not consulted at all: the lookup must
 * not reveal memberships of groups the viewer has no say over.
 */
export function personMatches(
  userId: string,
  rows: readonly RowView[],
  membersByGroup: Readonly<Record<string, Readable<DirectoryMember[]>>>
): PersonMatch[] {
  const id = userId.toLowerCase();
  return rows
    .filter((r) => r.access === 'manage')
    .map((row) => {
      const members = membersByGroup[row.group.groupId.toLowerCase()];
      if (!members || members.state !== 'ok') return { row, state: 'not-readable' as const };
      return { row, state: members.value.some((m) => m.id.toLowerCase() === id) ? ('member' as const) : ('not-member' as const) };
    });
}

/** One line per manageable group and member, for access reviews. */
export function memberExportRows(
  rows: readonly RowView[],
  membersByGroup: Readonly<Record<string, Readable<DirectoryMember[]>>>
): MemberExportRow[] {
  const out: MemberExportRow[] = [];
  for (const row of rows.filter((r) => r.access === 'manage')) {
    const members = membersByGroup[row.group.groupId.toLowerCase()];
    const base = { 'Group name': row.group.nameSnapshot, 'Group ID': row.group.groupId, Access: describeBindings(row.bindings) };
    if (!members || members.state !== 'ok') {
      // An unreadable group gets a line that says so, not zero lines.
      out.push({ ...base, Member: 'NOT READABLE', 'User principal name': '', Type: '' });
      continue;
    }
    if (members.value.length === 0) {
      out.push({ ...base, Member: '(no members)', 'User principal name': '', Type: '' });
      continue;
    }
    for (const m of members.value) {
      const type = m.type === 'user' ? ((m.userType ?? '').toLowerCase() === 'guest' ? 'Guest' : 'User') : m.type === 'group' ? 'Nested group' : m.type;
      out.push({ ...base, Member: m.displayName ?? m.id, 'User principal name': m.userPrincipalName ?? '', Type: type });
    }
  }
  return out;
}
