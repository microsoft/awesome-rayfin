import { entity, role, text, date, set, uuid } from '@microsoft/rayfin-core';

export type ApiKeyStatus = 'active' | 'revoked';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.ownerUserId),
  exclude: ['keyHash'],
})
export class ApiKey {
  @uuid() id!: string;
  @text({ min: 1, max: 100 }) label!: string;
  @text({ max: 128 }) keyHash!: string;
  @text({ max: 200 }) ownerUserId!: string;
  @set('active', 'revoked') status!: ApiKeyStatus;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
  @date({ optional: true }) lastUsedAt?: Date;
  @date({ optional: true }) expiresAt?: Date;
  @text({ max: 32, optional: true }) prefix?: string;
}
