/**
 * Requests: one person asks to be added to one activated group, an owner
 * decides. Pure.
 *
 * A request never grants anything. Approving it runs the ordinary member
 * change with the approver's own token and all its live checks; these rules
 * only decide what the app offers and when it refuses to go on.
 */
import { checkReviewDate } from './memberChange';
import { bindingKey } from './types';
import type { RowView } from './views';

export type RequestStatus = 'Pending' | 'Approved' | 'Denied' | 'Withdrawn';

export interface AccessRequest {
  id: string;
  groupId: string;
  requesterOid: string;
  requesterUpn: string;
  requesterName: string;
  reason: string;
  /** `YYYY-MM-DD`, optional. */
  reviewOn?: string;
  rowVersion: number;
  accessFingerprint: string;
  status: RequestStatus;
  createdAt: string;
  decidedByOid?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export const REQUEST_LIMITS = { reasonMin: 10, reasonMax: 1000, note: 500 } as const;

/** A short, stable mark of what a group opened when the request was made. */
export function accessFingerprint(row: Pick<RowView, 'bindings'>): string {
  const text = row.bindings.map(bindingKey).sort().join('\n');
  // FNV-1a, 32 bit. Not a security hash: it only detects that something changed.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${row.bindings.length}:${hash.toString(16).padStart(8, '0')}`;
}

export type RequestRefusal =
  | 'not-requestable'
  | 'already-member'
  | 'already-pending'
  | 'reason-too-short'
  | 'reason-too-long'
  | 'review-invalid'
  | 'review-past'
  | 'review-too-far';

/** May this person ask for this group, with this text? */
export function checkRequest(
  row: RowView | undefined,
  input: { reason: string; reviewOn?: string },
  context: { requesterOid: string; pending: readonly AccessRequest[]; today: Date }
): RequestRefusal[] {
  const refusals: RequestRefusal[] = [];
  // Groups that carry the workspace Member or Admin role are never requestable.
  // Neither is a group of which nothing is known: nobody could say what is being asked for.
  if (!row || !row.group.active || !row.group.requestable || row.highRole || row.bindings.length === 0) refusals.push('not-requestable');
  if (row?.isMember) refusals.push('already-member');
  if (row && context.pending.some((r) => r.status === 'Pending' && same(r.groupId, row.group.groupId) && same(r.requesterOid, context.requesterOid))) {
    refusals.push('already-pending');
  }
  const reason = input.reason.trim();
  if (reason.length < REQUEST_LIMITS.reasonMin) refusals.push('reason-too-short');
  if (reason.length > REQUEST_LIMITS.reasonMax) refusals.push('reason-too-long');
  if (input.reviewOn) {
    const verdict = checkReviewDate(input.reviewOn, row?.group.maxDays ?? 0, context.today);
    if (verdict === 'invalid') refusals.push('review-invalid');
    if (verdict === 'past') refusals.push('review-past');
    if (verdict === 'too-far') refusals.push('review-too-far');
  }
  return refusals;
}

export type DecisionRefusal = 'not-pending' | 'own-request' | 'not-manager' | 'group-changed' | 'not-requestable-anymore' | 'requester-mismatch';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * May this person decide this request, as the app sees it? Whether an
 * approval then succeeds is decided again from live reads by the member
 * change itself.
 */
export function checkDecision(
  request: AccessRequest,
  decision: 'approve' | 'deny',
  context: { actorOid: string; row: RowView | undefined }
): DecisionRefusal[] {
  const refusals: DecisionRefusal[] = [];
  if (request.status !== 'Pending') refusals.push('not-pending');
  // Nobody decides their own request, in either direction.
  if (same(request.requesterOid, context.actorOid)) refusals.push('own-request');
  const row = context.row;
  if (!row || !same(row.group.groupId, request.groupId) || row.access !== 'manage') refusals.push('not-manager');
  if (decision === 'approve' && row) {
    // The requester asked for what the group opened then. If that changed,
    // the request no longer says what would be granted.
    if (row.group.version !== request.rowVersion || accessFingerprint(row) !== request.accessFingerprint) refusals.push('group-changed');
    if (!row.group.active || !row.group.requestable || row.highRole || row.bindings.length === 0) refusals.push('not-requestable-anymore');
  }
  return refusals;
}

/**
 * Is the person behind the object id the one the request names? A request row
 * is written from the browser: its name and address are only believed when
 * the directory says the same about that object id.
 */
export function sameRequester(request: Pick<AccessRequest, 'requesterUpn' | 'requesterName'>, live: { userPrincipalName?: string; displayName?: string }): boolean {
  const upn = (live.userPrincipalName ?? '').trim().toLowerCase();
  if (!upn || upn !== request.requesterUpn.trim().toLowerCase()) return false;
  return (live.displayName ?? '').trim() === request.requesterName.trim();
}

/** A requester may take back their own pending request. */
export function canWithdraw(request: AccessRequest, actorOid: string): boolean {
  return request.status === 'Pending' && same(request.requesterOid, actorOid);
}

/**
 * Stored owner addresses come from a table every signed-in user can write.
 * Only those in the requester's own domain are used, so a forged entry cannot
 * make a requester's mailbox send their request to an outside address.
 */
export function sameDomainOnly(mails: string, requesterUpn: string): string {
  const domain = requesterUpn.split('@')[1]?.trim().toLowerCase();
  if (!domain) return '';
  return noticeRecipients(mails)
    .filter((mail) => mail.split('@')[1]?.toLowerCase() === domain)
    .join(';');
}

/** Addresses a notice may go to: plausible, distinct, at most ten. */
export function noticeRecipients(mails: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of mails.split(/[;,\s]+/)) {
    const mail = part.trim();
    if (!/^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{3,255}$/.test(mail)) continue;
    const key = mail.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mail);
  }
  return out.slice(0, 10);
}
