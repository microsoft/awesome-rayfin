import {
  entity,
  role,
  text,
  boolean,
  int,
  date,
  uuid,
} from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Session {
  @uuid() id!: string;
  @text({ max: 200 }) slideshowId!: string;
  @text({ max: 200 }) title!: string;
  @int() currentSlide!: number;
  @boolean() isActive!: boolean;
  @text({ max: 10 }) joinCode!: string;
  @date() createdAt!: Date;
  @text({ max: 200 }) user_id!: string;
}
