/**
 * Requests and decisions.
 *
 * Submitting writes one row and, if possible, sends one notice. Approving
 * runs the ordinary member change (`performChange`) with the approver's own
 * token: every live check of that path applies, including that the approver
 * is an owner in Entra right now. Only when that change is done, or the
 * person turns out to be a member already, is the request marked approved.
 */
import {
  accessFingerprint,
  canWithdraw,
  checkDecision,
  checkRequest,
  sameDomainOnly,
  sameRequester,
  type AccessRequest,
  type DecisionRefusal,
  type RequestRefusal,
} from '@/um/domain/accessRequest';
import { describeBindings } from '@/um/domain/sheet';
import type { GraphIdentity } from '@/um/domain/types';
import type { RowView } from '@/um/domain/views';

import type { DirectoryGateway } from './gateways';
import type { MailOutcome, Notice } from './graphMail';
import { performChange, type ChangeDeps, type ChangeResult } from './memberChanges';
import { contactOf } from './operations';
import type { UmStore } from './store';

/** Sends the notice to the owners. Graph in a deployment, a recorder in the demo. */
export interface NoticeSender {
  send(notice: Notice): Promise<MailOutcome>;
}

export interface RequestDeps {
  store: UmStore;
  actor: GraphIdentity;
  sender: NoticeSender | null;
  /** For reading the owners live. Without it, or without the permission, the stored addresses are used. */
  directory?: Pick<DirectoryGateway, 'listOwners'>;
  /** Address of the app, for the link in the notice. */
  appUrl: string;
}

export type SubmitResult =
  | { status: 'refused'; refusals: RequestRefusal[] }
  | { status: 'submitted'; request: AccessRequest; notice: 'sent' | 'not-sent' | 'no-recipients' };

function noticeFor(deps: RequestDeps, row: RowView, reason: string, reviewOn?: string): Omit<Notice, 'to'> {
  const lines = [
    `${deps.actor.displayName} (${deps.actor.userPrincipalName}) asks to be added to the group "${row.group.nameSnapshot}".`,
    '',
    `Reason: ${reason}`,
    reviewOn ? `Suggested review date: ${reviewOn}` : '',
    '',
    `The group opens: ${describeBindings(row.bindings) || 'nothing known'}`,
    '',
    `Decide in the Fabric User Manager: ${deps.appUrl}`,
    '',
    'This notice was sent by the requester through the Fabric User Manager. Nothing has been changed.',
  ];
  return { subject: `Access request: ${row.group.nameSnapshot}`, body: lines.filter((line, i) => line !== '' || lines[i - 1] !== '').join('\n') };
}

/**
 * Who is told. The owners as the directory names them now, when the requester
 * can read them. Otherwise the addresses the app stored, and of those only
 * the ones in the requester's own domain.
 */
async function recipientsFor(deps: RequestDeps, groupId: string): Promise<string> {
  const owners = deps.directory ? await deps.directory.listOwners(groupId).catch(() => null) : null;
  if (owners && owners.state === 'ok') return contactOf(owners.value);
  const stored = await deps.store.getContact(groupId).catch(() => '');
  return sameDomainOnly(stored, deps.actor.userPrincipalName);
}

export async function submitRequest(
  deps: RequestDeps,
  row: RowView | undefined,
  input: { reason: string; reviewOn?: string },
  today: Date = new Date()
): Promise<SubmitResult> {
  // The pending list is read fresh, so a second tab cannot file a duplicate.
  const existing = await deps.store.listRequests();
  const refusals = checkRequest(row, input, { requesterOid: deps.actor.objectId, pending: existing, today });
  if (refusals.length > 0 || !row) return { status: 'refused', refusals: refusals.length > 0 ? refusals : ['not-requestable'] };

  const reason = input.reason.trim();
  const request = await deps.store.createRequest(
    {
      groupId: row.group.groupId,
      reason,
      reviewOn: input.reviewOn || undefined,
      rowVersion: row.group.version,
      accessFingerprint: accessFingerprint(row),
    },
    deps.actor
  );

  let notice: 'sent' | 'not-sent' | 'no-recipients' = 'not-sent';
  if (deps.sender) {
    const to = await recipientsFor(deps, row.group.groupId);
    const outcome = to ? await deps.sender.send({ to, ...noticeFor(deps, row, reason, input.reviewOn) }) : ({ ok: false, code: 'no-recipients' } as const);
    notice = outcome.ok ? 'sent' : outcome.code === 'no-recipients' ? 'no-recipients' : 'not-sent';
  }
  return { status: 'submitted', request, notice };
}

export type DecisionResult =
  | { status: 'refused'; refusals: DecisionRefusal[] }
  | { status: 'approved'; change: ChangeResult }
  | { status: 'not-approved'; change: ChangeResult }
  | { status: 'denied' }
  | { status: 'conflict' };

/**
 * Approve: add the requester through the member change path, then mark the
 * request. If the change is refused or fails, the request stays pending and
 * the reason is returned.
 */
export async function approveRequest(deps: ChangeDeps, request: AccessRequest, row: RowView | undefined): Promise<DecisionResult> {
  // The request as stored now, not as the page remembers it.
  const current = (await deps.store.listRequests()).find((r) => r.id === request.id);
  if (!current) return { status: 'conflict' };
  const refusals = checkDecision(current, 'approve', { actorOid: deps.actor.objectId, row });
  if (refusals.length > 0) return { status: 'refused', refusals };

  // The activated group as stored now. The page's row may be minutes old:
  // deactivated, closed for requests or edited since.
  const stored = await deps.store.load().catch(() => null);
  const fresh = stored?.reachable ? stored.groups.find((g) => g.groupId.toLowerCase() === current.groupId.toLowerCase()) : undefined;
  if (!row || !fresh || fresh.version !== row.group.version) return { status: 'refused', refusals: ['group-changed'] };
  if (!fresh.active || !fresh.requestable) return { status: 'refused', refusals: ['not-requestable-anymore'] };

  // The person is looked up by the object id on the request, live, with type
  // and state. A name on the request is never used to find them.
  const user = await deps.directory.resolveUser(current.requesterOid);
  if (user.state !== 'ok' || !user.value) {
    return { status: 'not-approved', change: { status: 'refused', refusals: ['user-unknown'] } };
  }
  // The approver read a name and an address on the request. If the directory
  // names someone else for that object id, nobody is added.
  if (!sameRequester(current, user.value)) return { status: 'refused', refusals: ['requester-mismatch'] };

  const change = await performChange(deps, { action: 'add', groupId: current.groupId, user: user.value }, row);
  const granted = change.status === 'done' || (change.status === 'noop' && change.noop === 'already-member');
  if (!granted) return { status: 'not-approved', change };

  const updated = await deps.store.decideRequest(current.id, 'Approved', deps.actor).catch(() => null);
  if (change.status === 'done' && current.reviewOn) {
    await deps.store.setReviewDate(current.groupId, current.requesterOid, current.reviewOn, deps.actor).catch(() => undefined);
  }
  return updated ? { status: 'approved', change } : { status: 'conflict' };
}

export async function denyRequest(deps: Pick<ChangeDeps, 'store' | 'actor'>, request: AccessRequest, row: RowView | undefined, note: string): Promise<DecisionResult> {
  const current = (await deps.store.listRequests()).find((r) => r.id === request.id);
  if (!current) return { status: 'conflict' };
  const refusals = checkDecision(current, 'deny', { actorOid: deps.actor.objectId, row });
  if (refusals.length > 0) return { status: 'refused', refusals };
  const updated = await deps.store.decideRequest(current.id, 'Denied', deps.actor, note.trim()).catch(() => null);
  return updated ? { status: 'denied' } : { status: 'conflict' };
}

export async function withdrawRequest(deps: Pick<RequestDeps, 'store' | 'actor'>, request: AccessRequest): Promise<boolean> {
  const current = (await deps.store.listRequests()).find((r) => r.id === request.id);
  if (!current || !canWithdraw(current, deps.actor.objectId)) return false;
  return (await deps.store.decideRequest(current.id, 'Withdrawn', deps.actor).catch(() => null)) !== null;
}
