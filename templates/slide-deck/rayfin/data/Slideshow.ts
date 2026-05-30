import {
  entity,
  role,
  text,
  date,
  uuid,
} from '@microsoft/rayfin-core';

@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'update', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Slideshow {
  @uuid() id!: string;
  @text({ max: 200 }) title!: string;
  @text({ max: 500 }) description!: string;
  /** 'markdown' or 'html' */
  @text({ max: 20 }) format!: string;
  /** JSON-serialized array of slide objects: [{ content: string }] */
  @text() slides!: string;
  /** JSON-serialized theme object */
  @text() theme!: string;
  @date() createdAt!: Date;
  @text({ max: 200 }) user_id!: string;
}
