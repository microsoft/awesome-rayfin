import { entity, role, text, uuid, one } from '@microsoft/rayfin-core';
import { Job } from './Job.js';

@entity()
@role('authenticated', '*')
export class Equipment {
  @uuid() id!: string;
  @text() name!: string;
  @text({ optional: true }) serialNumber?: string;
  @text({ optional: true }) notes?: string;
  @one(() => Job) job!: Job;
}
