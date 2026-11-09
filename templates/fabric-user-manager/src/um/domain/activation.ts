/**
 * Activation: a discovered group becomes manageable by its owners only after
 * an app admin activates it.
 *
 * Owners are never stored. They are the group's owners in Entra, read live.
 */
import { assessGroup, type IneligibleReason } from './eligibility';
import { isGuid, type GroupFacts, type ManagedGroup, type Readable } from './types';

export const LIMITS = { description: 1000, name: 256, maxDays: 3650 } as const;

export interface ActivationInput {
  groupId: string;
  requestable: boolean;
  description: string;
  maxDays: number;
}

export type ActivationError =
  | 'bad-group-id'
  | 'app-admin-group'
  | 'already-activated'
  | 'group-not-readable'
  | 'description-too-long'
  | 'bad-max-days'
  | 'high-role-requestable'
  | { ineligible: IneligibleReason[] };

export interface ActivationCheck {
  ok: boolean;
  errors: ActivationError[];
}

export interface ActivationContext {
  facts: Readable<GroupFacts>;
  alreadyManaged: boolean;
  /** Bound to the workspace Admin or Member role, as far as known. */
  highRole: boolean;
  /** The Entra group whose members are app admins, if the build names one. */
  adminGroupId?: string;
}

/** Validate the editable fields shared by activation, in-app edit and import. */
export function checkEditable(
  fields: Pick<ActivationInput, 'requestable' | 'description' | 'maxDays'>,
  highRole: boolean
): ActivationError[] {
  const errors: ActivationError[] = [];
  if (fields.description.length > LIMITS.description) errors.push('description-too-long');
  if (!Number.isInteger(fields.maxDays) || fields.maxDays < 0 || fields.maxDays > LIMITS.maxDays) {
    errors.push('bad-max-days');
  }
  // Groups that carry the Member or Admin role are never requestable.
  if (highRole && fields.requestable) errors.push('high-role-requestable');
  return errors;
}

export function checkActivation(input: ActivationInput, context: ActivationContext): ActivationCheck {
  const errors: ActivationError[] = [];
  if (!isGuid(input.groupId)) errors.push('bad-group-id');
  if (context.alreadyManaged) errors.push('already-activated');
  // The group that makes app admins is never managed through the app itself.
  if (context.adminGroupId && context.adminGroupId.toLowerCase() === input.groupId.toLowerCase()) errors.push('app-admin-group');

  if (context.facts.state !== 'ok') {
    // Eligibility cannot be established, so the group cannot be activated.
    errors.push('group-not-readable');
  } else {
    const assessment = assessGroup(context.facts.value);
    if (!assessment.eligible) errors.push({ ineligible: assessment.reasons });
  }

  errors.push(...checkEditable(input, context.highRole));
  return { ok: errors.length === 0, errors };
}

/** What the viewer may do with one managed group. Advisory: Entra decides. */
export interface ViewerRelation {
  isAppAdmin: boolean;
  isOwner: boolean;
  isMember: boolean;
}

export type RowAccess = 'manage' | 'request-view' | 'hidden';

export function rowAccess(row: ManagedGroup, relation: ViewerRelation, highRole: boolean): RowAccess {
  if (relation.isAppAdmin) return 'manage';
  if (!row.active) return 'hidden';
  // Owners manage their groups, except Member and Admin role groups.
  if (relation.isOwner && !highRole) return 'manage';
  if (row.requestable && !highRole) return 'request-view';
  // A member can always see that they are in an activated group.
  if (relation.isMember) return 'request-view';
  return 'hidden';
}
