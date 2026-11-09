import { authenticated, date, entity, text, uuid, type PolicyExpression } from '@microsoft/rayfin-core';

import { CONTROLLER_EMAILS } from './controllers.js';

/**
 * Sign-off of one month-end close, or a reopen. A close is named by its last closed month (September 2026
 * close = actuals to September plus the forecast from October); signing it off freezes that forecast.
 *
 * Append-only (create and read); the latest row of a month decides its state. Row policy on create: the
 * author is the caller AND the caller is one of the controllers (controllers.ts), enforced by the data API.
 */
@entity()
@authenticated(['read'])
@authenticated(['create'], {
  policy: (claims, item) => {
    const isController = CONTROLLER_EMAILS.map((e) => claims.email.eq(e)).reduce(
      (acc: PolicyExpression | null, e) => (acc ? acc.or(e) : e),
      null
    );
    const isAuthor = claims.email.eq(item.author_email);
    return isController ? isAuthor.and(isController) : isAuthor.and(claims.email.eq('nobody@invalid'));
  },
})
export class MonthSignOff {
  @uuid() id!: string;

  /** `YYYY-MM` as text. */
  @text({ max: 7 }) month!: string;

  /** sign-off | reopen */
  @text({ max: 16 }) action!: string;

  @text({ max: 500, optional: true }) note?: string;

  /**
   * Sign-off only: the ids of the adjustments this sign-off freezes, comma-separated. While the close is signed
   * off exactly these apply (src/domain/lock.ts); only controllers can write this row.
   */
  @text({ max: 4000, optional: true }) frozen_ids?: string;

  @text({ max: 256 }) author_email!: string;
  @text({ max: 256 }) author_name!: string;

  @date() created_at!: Date;
}
