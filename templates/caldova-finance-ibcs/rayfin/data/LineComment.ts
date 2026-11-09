import { authenticated, date, entity, text, uuid } from '@microsoft/rayfin-core';

/**
 * A comment on one line of a statement in one month, typically explaining a variance.
 *
 * Append-only (create and read). Row policy on create: the author is the caller.
 */
@entity()
@authenticated(['read'])
@authenticated(['create'], { policy: (claims, item) => claims.email.eq(item.author_email) })
export class LineComment {
  @uuid() id!: string;

  /** PL | BS | CF */
  @text({ max: 2 }) statement!: string;
  @text({ max: 32 }) account_id!: string;

  /** `YYYY-MM` as text. */
  @text({ max: 7 }) month!: string;

  @text({ max: 1000 }) body!: string;

  @text({ max: 256 }) author_email!: string;
  @text({ max: 256 }) author_name!: string;

  @date() created_at!: Date;
}
