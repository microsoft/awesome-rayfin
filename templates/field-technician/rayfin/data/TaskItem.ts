import { entity, role, text, uuid, int, boolean, one } from '@microsoft/rayfin-core';
import { Job } from './Job.js';

@entity()
@role('authenticated', '*')
export class TaskItem {
  @uuid() id!: string;
  @text() description!: string;
  @boolean({ default: false }) isComplete!: boolean;
  @int() sortOrder!: number;
  @one(() => Job) job!: Job;
}
