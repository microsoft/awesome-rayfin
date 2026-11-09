import { entity, role, uuid, text, date, int } from '@microsoft/rayfin-core';

/**
 * A request by one person to be added to one activated group.
 *
 * The request is a note to the owners, not an authorization. Approving it
 * performs a normal member change with the approver's own token, with every
 * live check of that path. Every signed-in user can create and edit rows
 * here, so a row can be forged, and a decided one can be set back to pending.
 * What that achieves is limited to putting a request in front of an owner:
 * on approval the person is looked up by object id in the directory, and
 * nobody is added unless the directory gives the same name and address as
 * the row. The owner's own decision remains the gate.
 *
 * Readable by every signed-in user of the app (row policies cannot yet tie a
 * row to its requester): it holds who asked for which group and why.
 * No delete: a request ends as approved, denied, withdrawn or failed.
 */
@entity()
@role('authenticated', ['create', 'read', 'update'])
export class UmRequest {
  @uuid() id!: string;

  @text({ max: 36 }) group_id!: string;

  /** Entra object id of the requester, from Graph `/me` at request time. */
  @text({ max: 36 }) requester_oid!: string;
  @text({ max: 256 }) requester_upn!: string;
  @text({ max: 256 }) requester_name!: string;

  @text({ max: 1000 }) reason!: string;

  /** Review date the requester suggests, `YYYY-MM-DD`. */
  @text({ max: 10, optional: true }) review_on?: string;

  /** Version of the activated group and a fingerprint of what it opened, at request time. */
  @int() row_version!: number;
  @text({ max: 64 }) access_fingerprint!: string;

  /** Pending | Approved | Denied | Withdrawn */
  @text({ max: 16 }) status!: string;

  @date() created_at!: Date;

  @text({ max: 36, optional: true }) decided_by_oid?: string;
  @date({ optional: true }) decided_at?: Date;
  @text({ max: 500, optional: true }) decision_note?: string;
}
