import { entity, role, text, date, uuid } from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Timestamp {
  @uuid() id!: string;
  @date() timestamp!: Date;
  @date() createdAt!: Date;
  @text() user_id!: string;
}
