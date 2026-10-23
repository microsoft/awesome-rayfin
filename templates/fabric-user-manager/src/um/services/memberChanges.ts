/**
 * Carrying out one member change.
 *
 * The order is fixed and is the point of this file:
 *
 * 1. Read the group, its owners, its members live. The page's copy is not used.
 * 2. Decide (`planChange`). A refusal is logged and nothing is sent.
 * 3. Nothing to do? Say so; that is not a change.
 * 4. Log the intent, then send exactly one Graph write, then log the outcome.
 *    An intent without an outcome is visible and gets reconciled later.
 * 5. Read the members again and report "confirmed" or "accepted, not yet
 *    visible". Whether the person can already open something in Fabric is
 *    never claimed.
 *
 * The log is advisory (written from the browser). Entra's audit log is the
 * authoritative record of the change itself.
 */
import { planChange, type ChangeContext, type ChangePlan, type ChangeRequest, type Refusal } from '@/um/domain/memberChange';
import type { DirectoryMember, GraphIdentity, GroupFacts, Readable } from '@/um/domain/types';
import type { RowView } from '@/um/domain/views';

import type { DirectoryGateway, FabricGateway } from './gateways';
import type { WriteOutcome } from './graphWrite';
import { SETTING_MEMBER_CHANGES, boundedJson, type AuditEntry, type UmStore } from './store';

/** Sends one membership write. Implemented by Graph in a deployment and by fixtures in the demo. */
export interface MemberWriter {
  /** `actorObjectId` is the person shown and logged as acting; the writer refuses if its token belongs to someone else. */
  write(action: 'add' | 'remove', groupId: string, userId: string, actorObjectId: string): Promise<WriteOutcome>;
}

export interface ChangeDeps {
  store: UmStore;
  directory: DirectoryGateway;
  writer: MemberWriter;
  actor: GraphIdentity;
  isAppAdmin: boolean;
  armed: boolean;
  adminGroupId?: string;
}

export type ChangeResult =
  | { status: 'refused'; refusals: Refusal[] }
  | { status: 'noop'; noop: NonNullable<ChangePlan['noop']> }
  | { status: 'done'; confirmed: boolean }
  | { status: 'failed'; code: Exclude<WriteOutcome, { ok: true }>['code'] };

interface LiveState {
  facts: Readable<GroupFacts>;
  owners: Readable<DirectoryMember[]>;
  members: Readable<DirectoryMember[]>;
}

async function readLive(directory: DirectoryGateway, groupId: string): Promise<LiveState> {
  const [facts, owners, members] = await Promise.all([directory.getGroup(groupId), directory.listOwners(groupId), directory.listMembers(groupId)]);
  return { facts, owners, members };
}

function contextOf(deps: ChangeDeps, row: RowView | undefined, live: LiveState): ChangeContext {
  return { armed: deps.armed, row, ...live, actor: deps.actor, isAppAdmin: deps.isAppAdmin, adminGroupId: deps.adminGroupId };
}

/** What would happen, from live reads. Sends nothing and logs nothing. */
export async function previewChange(deps: ChangeDeps, request: ChangeRequest, row: RowView | undefined): Promise<ChangePlan> {
  return planChange(request, contextOf(deps, row, await readLive(deps.directory, request.groupId)));
}

/** Write one log entry. Returns false when it could not be written. */
async function log(deps: ChangeDeps, entry: Pick<AuditEntry, 'action' | 'outcome' | 'groupId'>, detail: unknown): Promise<boolean> {
  try {
    await deps.store.audit({ ...entry, actorOid: deps.actor.objectId, actorUpn: deps.actor.userPrincipalName, detail: boundedJson(detail) });
    return true;
  } catch {
    return false;
  }
}

export async function performChange(deps: ChangeDeps, request: ChangeRequest, row: RowView | undefined): Promise<ChangeResult> {
  const groupId = request.groupId.toLowerCase();
  const userId = request.user.id.toLowerCase();
  const action = request.action === 'add' ? 'member-add' : 'member-remove';
  // Object ids only: this log is readable by every signed-in user of the app,
  // so it must not become a directory of who is in which group by name.
  const about = { changeId: crypto.randomUUID(), userId };

  // The switch is read again here, so switching off in another tab or in the
  // middle of a bulk run takes effect. Unreadable means off.
  const armedNow = deps.armed && (await deps.store.getSetting(SETTING_MEMBER_CHANGES).catch(() => undefined)) === true;

  const plan = planChange(request, { ...contextOf(deps, row, await readLive(deps.directory, groupId)), armed: armedNow });
  if (!plan.ok) {
    await log(deps, { action, outcome: 'refused', groupId }, { ...about, refusals: plan.refusals });
    return { status: 'refused', refusals: plan.refusals };
  }
  if (plan.noop) return { status: 'noop', noop: plan.noop };

  // No intent on record, no change: otherwise a write could happen that the
  // app's own log never knew was attempted.
  if (!(await log(deps, { action, outcome: 'pending', groupId }, about))) {
    return { status: 'refused', refusals: ['log-unavailable'] };
  }

  const outcome = await deps.writer.write(request.action, groupId, userId, deps.actor.objectId);

  const isMemberNow = async (): Promise<boolean | null> => {
    const after = await deps.directory.listMembers(groupId);
    return after.state === 'ok' ? after.value.some((m) => m.id.toLowerCase() === userId) : null;
  };
  const wanted = request.action === 'add';

  if (!outcome.ok) {
    if (outcome.code === 'already-member' || outcome.code === 'not-member') {
      // The wanted state already held when the write arrived: someone else
      // got there first. Nothing was changed by this person.
      await log(deps, { action, outcome: 'ok', groupId }, { ...about, result: 'nothing-changed', state: outcome.code });
      return { status: 'noop', noop: outcome.code };
    }
    if (outcome.code === 'uncertain') {
      // No definite answer. Look, do not guess, and do not retry.
      const present = await isMemberNow();
      if (present === wanted) {
        await log(deps, { action, outcome: 'ok', groupId }, { ...about, result: 'confirmed-after-unclear-answer', status: outcome.status });
        return { status: 'done', confirmed: true };
      }
      await log(deps, { action, outcome: 'failed', groupId }, { ...about, result: present === null ? 'unclear-not-readable' : 'unclear-not-applied', status: outcome.status });
      return { status: 'failed', code: 'uncertain' };
    }
    await log(deps, { action, outcome: 'failed', groupId }, { ...about, result: outcome.code, status: outcome.status });
    return { status: 'failed', code: outcome.code };
  }

  const confirmed = (await isMemberNow()) === wanted;
  await log(deps, { action, outcome: 'ok', groupId }, { ...about, result: confirmed ? 'confirmed' : 'accepted-not-visible' });
  return { status: 'done', confirmed };
}

interface ChangeDetail {
  changeId?: string;
  userId?: string;
  /** Binding intents: the workspace, what was sent, and the role wanted. */
  workspaceId?: string;
  sent?: string;
  toRole?: string;
  /** Group creation: the name that was asked for and the mail alias of that attempt. */
  name?: string;
  alias?: string;
}

const MEMBER_INTENTS: readonly AuditEntry['action'][] = ['member-add', 'member-remove'];
const BINDING_INTENTS: readonly AuditEntry['action'][] = ['binding-add', 'binding-change', 'binding-remove'];

function detailOf(entry: AuditEntry): ChangeDetail {
  try {
    return entry.detail ? (JSON.parse(entry.detail) as ChangeDetail) : {};
  } catch {
    return {};
  }
}

/** An intent younger than this may still be in flight in another tab. */
export const RECONCILE_MIN_AGE_MS = 10 * 60_000;

/** Intents that never got an outcome: the tab was closed or the log write failed in between. */
export function unresolvedIntents(entries: readonly AuditEntry[], now: number = Date.now()): AuditEntry[] {
  const settled = new Set(entries.filter((e) => e.outcome !== 'pending').map((e) => detailOf(e).changeId).filter(Boolean));
  return entries.filter(
    (e) =>
      e.outcome === 'pending' &&
      (MEMBER_INTENTS.includes(e.action) || BINDING_INTENTS.includes(e.action) || e.action === 'group-create') &&
      !settled.has(detailOf(e).changeId) &&
      now - new Date(e.at).getTime() >= RECONCILE_MIN_AGE_MS
  );
}

/**
 * Close old open intents by looking at what is true in Entra or Fabric now.
 * The entry is its own kind (`reconcile`), names who looked, and never claims
 * who made the change or that the intent caused the state. An intent whose
 * state cannot be read stays open.
 */
export async function reconcilePending(
  deps: Pick<ChangeDeps, 'store' | 'directory' | 'actor'> & { fabric?: Pick<FabricGateway, 'listRoleAssignments'> },
  entries: readonly AuditEntry[],
  now: number = Date.now()
): Promise<number> {
  let closed = 0;
  for (const entry of unresolvedIntents(entries, now)) {
    const detail = detailOf(entry);
    if (!detail.changeId) continue;
    if (entry.action === 'group-create') {
      // The intent was logged before any id existed: look for the name.
      if (!detail.name || !detail.alias) continue;
      const found = await deps.directory.findGroupsByName(detail.name);
      if (found.state !== 'ok') continue;
      // Only the group that carries the alias of that attempt counts as its result.
      const ours = found.value.find((g) => g.mailNickname === detail.alias);
      try {
        await deps.store.audit({
          action: 'reconcile',
          outcome: ours ? 'ok' : 'failed',
          groupId: ours?.id,
          actorOid: deps.actor.objectId,
          actorUpn: deps.actor.userPrincipalName,
          detail: boundedJson({ changeId: detail.changeId, name: detail.name, intent: entry.action, intentByOid: entry.actorOid, result: ours ? 'state-present-now' : 'state-not-present-now', sameName: found.value.length }),
        });
        closed += 1;
      } catch {
        /* advisory */
      }
      continue;
    }
    if (!entry.groupId) continue;
    const groupId = entry.groupId;
    let reached: boolean;
    let about: Record<string, unknown>;
    if (BINDING_INTENTS.includes(entry.action)) {
      if (!deps.fabric || !detail.workspaceId || !detail.sent) continue;
      const assignments = await deps.fabric.listRoleAssignments(detail.workspaceId);
      if (assignments.state !== 'ok') continue;
      const held = assignments.value.find((a) => a.principalType === 'Group' && a.principalId.toLowerCase() === groupId.toLowerCase());
      reached = detail.sent === 'remove' ? !held : !!held && held.role === detail.toRole;
      about = { workspaceId: detail.workspaceId, toRole: detail.toRole };
    } else {
      if (!detail.userId) continue;
      const userId = detail.userId;
      const members = await deps.directory.listMembers(groupId);
      if (members.state !== 'ok') continue;
      const present = members.value.some((m) => m.id.toLowerCase() === userId.toLowerCase());
      reached = present === (entry.action === 'member-add');
      about = { userId };
    }
    try {
      await deps.store.audit({
        action: 'reconcile',
        outcome: reached ? 'ok' : 'failed',
        groupId,
        actorOid: deps.actor.objectId,
        actorUpn: deps.actor.userPrincipalName,
        detail: boundedJson({ changeId: detail.changeId, ...about, intent: entry.action, intentByOid: entry.actorOid, result: reached ? 'state-present-now' : 'state-not-present-now' }),
      });
      closed += 1;
    } catch {
      /* advisory */
    }
  }
  return closed;
}
