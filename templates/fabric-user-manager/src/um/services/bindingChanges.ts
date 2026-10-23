/**
 * Carrying out one change of a workspace role binding.
 *
 * Same order as a member change, for the same reasons: read live, decide,
 * record the intent, send exactly one write, record the outcome, read again.
 * A refusal sends nothing. An unclear answer is never reported as failed or
 * retried: the assignments are read again and the real state is reported.
 */
import { planBinding, samePlan, type BindingContext, type BindingPlan, type BindingRefusal, type BindingRequest, type PreviewedBinding } from '@/um/domain/bindingChange';
import { notReadable, ok, type DirectoryMember, type GraphIdentity, type GroupFacts, type Readable, type RoleAssignment } from '@/um/domain/types';

import { resolveAppAdminIds } from './discoveryRunner';
import type { RoleChange, RoleWriteOutcome } from './fabricWrite';
import type { DirectoryGateway, FabricGateway } from './gateways';
import { boundedJson, type AuditEntry, type UmStore } from './store';

/** Setting: binding changes are switched on. Advisory; the build flag is the real off state. */
export const SETTING_BINDING_CHANGES = 'um.changes.bindings';

/** Sends one role assignment write. Fabric in a deployment, fixtures in the demo. */
export interface BindingWriter {
  /** `actorObjectId` is the person shown and logged as acting; the writer refuses if its token belongs to someone else. */
  write(change: RoleChange, actorObjectId: string): Promise<RoleWriteOutcome>;
}

export interface BindingDeps {
  store: UmStore;
  directory: DirectoryGateway;
  fabric: FabricGateway;
  writer: BindingWriter;
  actor: GraphIdentity;
  isAppAdmin: boolean;
  armed: boolean;
  adminGroupId?: string;
  adminUserIds: readonly string[];
}

export type BindingResult =
  | { status: 'refused'; refusals: BindingRefusal[] }
  | { status: 'noop' }
  | { status: 'done'; confirmed: boolean }
  | { status: 'failed'; code: Exclude<RoleWriteOutcome, { ok: true }>['code'] };

export interface BindingPreview {
  plan: BindingPlan;
  groupName: string;
  /** The workspace's name as read now, or `null` when it could not be read. */
  workspaceName: string | null;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
}

interface Live {
  assignments: Readable<RoleAssignment[]>;
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
  appAdminIds: Readable<string[]>;
  actorGroupIds: Readable<string[]>;
  workspaceName: Readable<string>;
}

async function readLive(deps: BindingDeps, request: BindingRequest): Promise<Live> {
  const [workspaces, assignments, facts, owners, members, appAdminIds, actorGroupIds] = await Promise.all([
    deps.fabric.listWorkspaces(),
    deps.fabric.listRoleAssignments(request.workspaceId),
    deps.directory.getGroup(request.groupId),
    deps.directory.listOwners(request.groupId),
    deps.directory.listMembers(request.groupId),
    resolveAppAdminIds(deps.directory, { adminGroupId: deps.adminGroupId, adminUserIds: deps.adminUserIds }),
    // Through other groups too: Admin held by a group inside the changed group is still a path.
    deps.directory.myTransitiveGroupIds(),
  ]);
  const workspace = workspaces.state === 'ok' ? workspaces.value.find((w) => w.id.toLowerCase() === request.workspaceId.toLowerCase()) : undefined;
  const workspaceName: Readable<string> = workspace ? ok(workspace.displayName) : workspaces.state === 'ok' ? notReadable('failed', 'workspace-not-listed') : notReadable(workspaces.reason);
  return { assignments, facts, owners, members, appAdminIds, actorGroupIds, workspaceName };
}

function contextOf(deps: BindingDeps, live: Live, armed: boolean): BindingContext {
  return { armed, isAppAdmin: deps.isAppAdmin, actor: deps.actor, adminGroupId: deps.adminGroupId, ...live };
}

/** What would happen, from live reads. Sends nothing and logs nothing. */
export async function previewBinding(deps: BindingDeps, request: BindingRequest): Promise<BindingPreview> {
  const live = await readLive(deps, request);
  return {
    plan: planBinding(request, contextOf(deps, live, deps.armed)),
    groupName: live.facts.state === 'ok' ? live.facts.value.displayName : request.groupId,
    workspaceName: live.workspaceName.state === 'ok' ? live.workspaceName.value : null,
    owners: live.owners,
    members: live.members,
  };
}

function toChange(request: BindingRequest, plan: BindingPlan): RoleChange | null {
  if (plan.effective === 'remove') return plan.assignmentId ? { action: 'remove', workspaceId: request.workspaceId, assignmentId: plan.assignmentId } : null;
  if (!plan.toRole) return null;
  if (plan.effective === 'change') return plan.assignmentId ? { action: 'change', workspaceId: request.workspaceId, assignmentId: plan.assignmentId, role: plan.toRole } : null;
  return { action: 'add', workspaceId: request.workspaceId, groupId: request.groupId, role: plan.toRole };
}

/** Does the workspace now show what the change wanted? `null` when it cannot be read. */
function reached(assignments: Readable<RoleAssignment[]>, request: BindingRequest, plan: BindingPlan): boolean | null {
  if (assignments.state !== 'ok') return null;
  const now = assignments.value.find((a) => a.principalType === 'Group' && a.principalId.toLowerCase() === request.groupId.toLowerCase());
  return plan.effective === 'remove' ? !now : !!now && now.role === plan.toRole;
}

/**
 * `shown` is the plan the admin saw and confirmed. If a fresh read gives a
 * different one (another role, another assignment, another number of members),
 * nothing is sent and the admin has to look again.
 */
export async function performBinding(deps: BindingDeps, request: BindingRequest, shown: PreviewedBinding): Promise<BindingResult> {
  const action: AuditEntry['action'] = `binding-${request.action}`;
  const groupId = request.groupId.toLowerCase();
  // Object ids and role names only: this log is readable by every signed-in user.
  const about = { changeId: crypto.randomUUID(), workspaceId: request.workspaceId.toLowerCase(), role: request.role };
  const log = async (outcome: AuditEntry['outcome'], detail: unknown): Promise<boolean> => {
    try {
      await deps.store.audit({ action, outcome, groupId, actorOid: deps.actor.objectId, actorUpn: deps.actor.userPrincipalName, detail: boundedJson(detail) });
      return true;
    } catch {
      return false;
    }
  };

  // The switch as stored right now. Unreadable means off.
  const armedNow = deps.armed && (await deps.store.getSetting(SETTING_BINDING_CHANGES).catch(() => undefined)) === true;
  const plan = planBinding(request, contextOf(deps, await readLive(deps, request), armedNow));
  if (!plan.ok) {
    await log('refused', { ...about, refusals: plan.refusals });
    return { status: 'refused', refusals: plan.refusals };
  }
  if (plan.noop) return { status: 'noop' };
  if (!samePlan(shown, plan)) {
    await log('refused', { ...about, refusals: ['changed-since-preview'] });
    return { status: 'refused', refusals: ['changed-since-preview'] };
  }

  const change = toChange(request, plan);
  if (!change) return { status: 'refused', refusals: ['no-binding'] };

  const intent = { ...about, sent: plan.effective, fromRole: plan.fromRole, toRole: plan.toRole, members: plan.affectedMembers };
  // No intent on record, no change.
  if (!(await log('pending', intent))) return { status: 'refused', refusals: ['log-unavailable'] };

  const outcome = await deps.writer.write(change, deps.actor.objectId);
  const after = async () => reached(await deps.fabric.listRoleAssignments(request.workspaceId), request, plan);

  if (!outcome.ok) {
    if (outcome.code === 'uncertain') {
      const state = await after();
      if (state === true) {
        await log('ok', { ...intent, result: 'confirmed-after-unclear-answer', status: outcome.status });
        return { status: 'done', confirmed: true };
      }
      // Not readable either: the intent stays open and is settled later from a fresh read.
      if (state !== null) await log('failed', { ...intent, result: 'unclear-not-applied', status: outcome.status });
      return { status: 'failed', code: 'uncertain' };
    }
    await log('failed', { ...intent, result: outcome.code, status: outcome.status });
    return { status: 'failed', code: outcome.code };
  }

  const confirmed = (await after()) === true;
  await log('ok', { ...intent, result: confirmed ? 'confirmed' : 'accepted-not-visible' });
  return { status: 'done', confirmed };
}
