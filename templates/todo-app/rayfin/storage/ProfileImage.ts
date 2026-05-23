import { blob, role } from '@microsoft/rayfin-core';

@blob()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.owner_id),
})
export class ProfileImage {
  // Storage folders are configured through decorators
  // Individual files will be managed through the storage API

  owner_id!: string;
}
