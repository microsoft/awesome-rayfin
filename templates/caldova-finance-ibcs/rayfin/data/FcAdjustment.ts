import { authenticated, date, decimal, entity, text, uuid } from '@microsoft/rayfin-core';

/**
 * One forecast adjustment of a P&L account in an open or future month.
 *
 * Append-only: the API grants create and read, never update or delete. A correction is a new row with the
 * opposite amount. `amount` is in the account's natural orientation: +1000 on a cost account means more cost.
 *
 * Row policy on create: `author_email` must be the caller's own sign-in address, so nobody can write in
 * someone else's name. Whether an adjustment counts is decided at read time against the sign-offs of its
 * close period (src/domain/lock.ts): a row created after that period was signed off is shown, never applied.
 */
@entity()
@authenticated(['read'])
@authenticated(['create'], { policy: (claims, item) => claims.email.eq(item.author_email) })
export class FcAdjustment {
  @uuid() id!: string;

  @text({ max: 32 }) account_id!: string;

  /** `YYYY-MM` as text: a full date would come back as a Date. */
  @text({ max: 7 }) month!: string;

  @decimal({ precision: 18, scale: 2 }) amount!: number;

  /** The month-end close it belongs to: the last closed month when it was written, `YYYY-MM`. */
  @text({ max: 7 }) period!: string;

  @text({ max: 500 }) reason!: string;

  @text({ max: 256 }) author_email!: string;
  @text({ max: 256 }) author_name!: string;

  @date() created_at!: Date;
}
