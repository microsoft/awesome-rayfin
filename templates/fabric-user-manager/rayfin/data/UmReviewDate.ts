import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * A reminder to review one membership by a date.
 *
 * It is a reminder, not an expiry: nothing is removed automatically. One row
 * per group and user; the pair is stored as `member_key` so the database can
 * keep it unique.
 *
 * Like the other tables of this app it is written from the browser and is
 * advisory. It holds no member list, only the pairs that carry a date.
 */
@entity()
@role('authenticated', ['create', 'read', 'update', 'delete'])
export class UmReviewDate {
  @uuid() id!: string;

  /** `<group object id>|<user object id>`, lower case. */
  @text({ max: 80, unique: true }) member_key!: string;

  @text({ max: 36 }) group_id!: string;
  @text({ max: 36 }) user_id!: string;

  /** The day by which the membership should be looked at again. */
  @date() review_on!: Date;

  @text({ max: 256 }) set_by_upn!: string;
  @date() set_at!: Date;
}
