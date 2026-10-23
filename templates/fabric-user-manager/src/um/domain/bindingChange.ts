/**
 * Deciding a change of which group holds which workspace role. Pure.
 *
 * This is the larger lever: adding one person to a group affects one person;
 * binding a group gives every member that role at once, and removing a
 * binding cuts them all off. Fabric decides whether the caller may do it
 * (workspace Member or higher, Admin to grant Admin). These rules decide what
 * the app offers on top of that, from live reads taken right before the
 * change. The Admin protections here are best effort: the check and the
 * change are two separate calls.
 */
import { assessGroup } from './eligibility';
import { WORKSPACE_ROLES, type DirectoryMember, type GraphIdentity, type GroupFacts, type Readable, type RoleAssignment, type WorkspaceRole } from './types';

export type BindingAction = 'add' | 'change' | 'remove';

export interface BindingRequest {
  action: BindingAction;
  workspaceId: string;
  groupId: string;
  /** The role to grant or change to. Not used for a removal. */
  role?: string;
  /** What the admin typed to confirm a high-impact change: the workspace name. */
  confirmation?: string;
}

export interface BindingContext {
  armed: boolean;
  isAppAdmin: boolean;
  actor: GraphIdentity;
  adminGroupId?: string;
  /** Everyone who counts as an app admin, for the owner rule. */
  appAdminIds: Readable<string[]>;
  /** The workspace's role assignments, read live. */
  assignments: Readable<RoleAssignment[]>;
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
  /** Groups the acting person is in, directly or through other groups. */
  actorGroupIds: Readable<string[]>;
  /** The workspace's name as Fabric returns it now. The typed confirmation is compared with this. */
  workspaceName: Readable<string>;
}

export type BindingRefusal =
  | 'not-armed'
  | 'not-app-admin'
  | 'log-unavailable'
  | 'bad-role'
  | 'roles-not-readable'
  | 'no-binding'
  | 'group-not-readable'
  | 'group-ineligible'
  | 'app-admin-group'
  | 'owners-not-readable'
  | 'owners-not-admins'
  | 'confirmation-missing'
  | 'workspace-not-readable'
  | 'changed-since-preview'
  | 'last-admin'
  | 'own-admin-path';

export interface BindingPlan {
  ok: boolean;
  refusals: BindingRefusal[];
  /** Nothing to do: the group already holds exactly this role. */
  noop?: 'same-role';
  /** What will actually be sent. An "add" for a group that already holds another role is a change. */
  effective: BindingAction;
  /** The existing assignment of this group in this workspace, if any. */
  assignmentId?: string;
  fromRole?: string;
  toRole?: WorkspaceRole;
  /** Direct members who gain or lose this path. `null` when the members could not be read. */
  affectedMembers: number | null;
  /** True when the admin must type the workspace name. */
  needsConfirmation: boolean;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isRole = (value: unknown): value is WorkspaceRole => (WORKSPACE_ROLES as readonly unknown[]).includes(value);

export function planBinding(request: BindingRequest, context: BindingContext): BindingPlan {
  const refusals: BindingRefusal[] = [];
  const affectedMembers = context.members.state === 'ok' ? context.members.value.length : null;
  const base = { affectedMembers, effective: request.action, needsConfirmation: false };

  if (!context.armed) refusals.push('not-armed');
  if (!context.isAppAdmin) refusals.push('not-app-admin');
  if (context.assignments.state !== 'ok') {
    // Without the live roles nothing about the change can be judged.
    return { ...base, ok: false, refusals: [...refusals, 'roles-not-readable'] };
  }

  const assignments = context.assignments.value;
  const existing = assignments.find((a) => a.principalType === 'Group' && same(a.principalId, request.groupId));
  const removing = request.action === 'remove';

  let toRole: WorkspaceRole | undefined;
  if (!removing) {
    if (isRole(request.role)) toRole = request.role;
    else refusals.push('bad-role');
  }

  let effective: BindingAction = request.action;
  if (request.action === 'add' && existing) effective = 'change';
  if ((request.action === 'change' || removing) && !existing) refusals.push('no-binding');

  const noop = !removing && existing && toRole && existing.role === toRole ? ('same-role' as const) : undefined;

  if (!removing) {
    // Binding gives access to everyone in the group, so the group must be one the app manages.
    if (context.facts.state !== 'ok' || !same(context.facts.value.id, request.groupId)) refusals.push('group-not-readable');
    else if (!assessGroup(context.facts.value).eligible) refusals.push('group-ineligible');
    if (context.adminGroupId && same(context.adminGroupId, request.groupId)) refusals.push('app-admin-group');

    // Whoever owns a group bound to Member or Admin can grant that role in
    // Entra without this app. Such a group may only have app admins as owners.
    if (toRole === 'Member' || toRole === 'Admin') {
      if (context.owners.state !== 'ok' || context.appAdminIds.state !== 'ok') refusals.push('owners-not-readable');
      else {
        const admins = new Set(context.appAdminIds.value.map((id) => id.toLowerCase()));
        if (context.owners.value.some((o) => !admins.has(o.id.toLowerCase()))) refusals.push('owners-not-admins');
      }
    }
  }

  // Leaving the Admin role, by removal or by lowering.
  const leavesAdmin = !!existing && existing.role === 'Admin' && (removing || (!!toRole && toRole !== 'Admin'));
  if (leavesAdmin && existing) {
    const otherAdmins = assignments.filter((a) => a.role === 'Admin' && a.id !== existing.id);
    // Only a person named directly counts: another group may be empty, and a
    // service principal is nobody who could repair the workspace by hand.
    if (!otherAdmins.some((a) => a.principalType === 'User')) refusals.push('last-admin');
    else if (context.actorGroupIds.state !== 'ok') {
      // Whether the acting person would lock themselves out cannot be told.
      refusals.push('own-admin-path');
    } else {
      const mine = new Set(context.actorGroupIds.value.map((id) => id.toLowerCase()));
      const viaThisGroup = mine.has(request.groupId.toLowerCase());
      const otherPath = otherAdmins.some(
        (a) => (a.principalType === 'User' && same(a.principalId, context.actor.objectId)) || (a.principalType === 'Group' && mine.has(a.principalId.toLowerCase()))
      );
      if (viaThisGroup && !otherPath) refusals.push('own-admin-path');
    }
  }

  // High impact: granting Admin, removing any binding, lowering from Admin.
  const needsConfirmation = !noop && (toRole === 'Admin' || removing || leavesAdmin);
  if (needsConfirmation) {
    if (context.workspaceName.state !== 'ok') refusals.push('workspace-not-readable');
    else if ((request.confirmation ?? '').trim().toLowerCase() !== context.workspaceName.value.trim().toLowerCase()) refusals.push('confirmation-missing');
  }

  return {
    ok: refusals.length === 0,
    refusals,
    noop,
    effective,
    assignmentId: existing?.id,
    fromRole: existing?.role,
    toRole,
    affectedMembers,
    needsConfirmation,
  };
}

/** What the admin saw and confirmed. The change is only sent if this still holds. */
export type PreviewedBinding = Pick<BindingPlan, 'effective' | 'assignmentId' | 'fromRole' | 'toRole' | 'affectedMembers'>;

export function samePlan(shown: PreviewedBinding, now: PreviewedBinding): boolean {
  return (
    shown.effective === now.effective &&
    (shown.assignmentId ?? '').toLowerCase() === (now.assignmentId ?? '').toLowerCase() &&
    (shown.fromRole ?? '') === (now.fromRole ?? '') &&
    (shown.toRole ?? '') === (now.toRole ?? '') &&
    shown.affectedMembers === now.affectedMembers
  );
}
