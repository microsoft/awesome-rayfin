import { entity, role, uuid, one } from '@microsoft/rayfin-core';
import { UserProfile } from './UserProfile.js';
import { Region } from './Region.js';

@entity()
@role('authenticated', '*')
export class UserRegion {
  @uuid() id!: string;
  @one(() => UserProfile) userProfile!: UserProfile;
  @one(() => Region) region!: Region;
}
