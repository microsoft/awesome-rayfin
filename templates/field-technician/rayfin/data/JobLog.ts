import { entity, role, text, uuid, date, set, one } from '@microsoft/rayfin-core';
import { Job } from './Job.js';

export type JobLogType = 'note' | 'status_change' | 'assignment' | 'help_request';

@entity()
@role('authenticated', '*')
export class JobLog {
  @uuid() id!: string;

  @set('note', 'status_change', 'assignment', 'help_request')
  type!: JobLogType;

  @text() message!: string;
  @text({ optional: true }) imageUrl?: string;
  @text() actor_id!: string;
  @date() createdAt!: Date;

  @one(() => Job) job!: Job;
}
