import { entity, role, text, uuid } from '@microsoft/rayfin-core';

@entity()
@role('authenticated', '*')
export class Region {
  @uuid() id!: string;
  @text() name!: string;
  @text({ optional: true }) description?: string;
}
