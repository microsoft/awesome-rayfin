import {
  entity,
  role,
  text,
  date,
  uuid,
} from '@microsoft/rayfin-core';

@entity()
@role('authenticated', 'read')
@role('authenticated', ['create', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Image {
  @uuid() id!: string;
  @text({ max: 200 }) filename!: string;
  @text({ max: 100 }) mimeType!: string;
  /** base64-encoded image data */
  @text() data!: string;
  @date() createdAt!: Date;
  @text({ max: 200 }) user_id!: string;
}
