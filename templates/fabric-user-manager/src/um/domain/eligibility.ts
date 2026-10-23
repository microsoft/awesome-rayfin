/**
 * Which groups may be activated.
 *
 * Only cloud security groups with assigned membership. A property Graph did
 * not return is "unknown", and unknown is never treated as eligible: the
 * read scope may simply not cover it.
 */
import type { DirectoryMember, GroupFacts } from './types';

export type IneligibleReason =
  | 'not-security'
  | 'mail-enabled'
  | 'dynamic'
  | 'role-assignable'
  | 'synced'
  | 'unknown-properties';

export interface Eligibility {
  eligible: boolean;
  reasons: IneligibleReason[];
}

export function assessGroup(group: GroupFacts): Eligibility {
  const reasons: IneligibleReason[] = [];

  if (group.securityEnabled === false) reasons.push('not-security');
  if (group.mailEnabled === true) reasons.push('mail-enabled');
  if ((group.groupTypes ?? []).includes('DynamicMembership') || !!group.membershipRule) {
    reasons.push('dynamic');
  }
  if (group.isAssignableToRole === true) reasons.push('role-assignable');
  if (group.onPremisesSyncEnabled === true) reasons.push('synced');

  // `null` is a real Graph answer for "not set"; only `undefined` is unknown.
  const unknown =
    group.securityEnabled === undefined ||
    group.mailEnabled === undefined ||
    group.groupTypes === undefined ||
    group.isAssignableToRole === undefined ||
    group.onPremisesSyncEnabled === undefined;
  if (unknown && reasons.length === 0) reasons.push('unknown-properties');

  return { eligible: reasons.length === 0, reasons };
}

export interface MemberCounts {
  users: number;
  guests: number;
  nestedGroups: number;
  servicePrincipals: number;
  other: number;
}

/** Count member kinds instead of dropping the ones the app does not manage. */
export function countMembers(members: readonly DirectoryMember[]): MemberCounts {
  const counts: MemberCounts = { users: 0, guests: 0, nestedGroups: 0, servicePrincipals: 0, other: 0 };
  for (const m of members) {
    if (m.type === 'user') {
      if ((m.userType ?? '').toLowerCase() === 'guest') counts.guests += 1;
      else counts.users += 1;
    } else if (m.type === 'group') counts.nestedGroups += 1;
    else if (m.type === 'servicePrincipal') counts.servicePrincipals += 1;
    else counts.other += 1;
  }
  return counts;
}
