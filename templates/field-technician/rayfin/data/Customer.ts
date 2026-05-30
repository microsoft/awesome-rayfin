import { entity, role, text, uuid, email } from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*')
export class Customer {
  @uuid() id!: string;
  @text() name!: string;
  @text() phone!: string;
  @email({ optional: true }) email?: string;
  @text({ optional: true }) address?: string;
}
