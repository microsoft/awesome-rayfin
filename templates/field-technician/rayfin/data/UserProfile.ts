import { entity, role, text, uuid, set } from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*')
export class UserProfile {
  @uuid() id!: string;
  @uuid({ unique: true }) user_id!: string;
  @text() displayName!: string;
  @text({ optional: true }) phone?: string;
  @set('technician', 'dispatcher')
  role!: 'technician' | 'dispatcher';
}
