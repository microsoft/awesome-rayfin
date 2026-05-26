import {
  entity,
  role,
  text,
  date,
  uuid,
} from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class ChatMessage {
  @uuid() id!: string;
  @text({ max: 200 }) sessionId!: string;
  @text({ max: 100 }) authorName!: string;
  @text({ max: 2000 }) content!: string;
  @date() createdAt!: Date;
  @text({ max: 200 }) user_id!: string;
}
