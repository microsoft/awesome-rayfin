import {
  entity,
  role,
  text,
  uuid,
  date,
  boolean,
  set,
  one,
} from '@microsoft/rayfin-core';
import { Customer } from './Customer.js';
import { Region } from './Region.js';
import { UserProfile } from './UserProfile.js';

export type JobStatus =
  | 'new'
  | 'scheduled'
  | 'investigating'
  | 'in-progress'
  | 'blocked'
  | 'complete'
  | 'abandoned';

@entity()
@role('authenticated', '*')
export class Job {
  @uuid() id!: string;
  @text() title!: string;
  @text({ optional: true }) description?: string;

  @set('new', 'scheduled', 'investigating', 'in-progress', 'blocked', 'complete', 'abandoned')
  status!: JobStatus;

  @date({ optional: true }) scheduledAt?: Date;
  @date({ optional: true }) completedAt?: Date;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;

  @boolean({ default: false }) isOnSite!: boolean;
  @boolean({ default: false }) needsHelp!: boolean;
  @text({ optional: true }) helpDescription?: string;

  @one(() => Customer) customer!: Customer;
  @one(() => Region) region!: Region;
  @one(() => UserProfile, { optional: true }) technician?: UserProfile;
  @one(() => UserProfile) createdBy!: UserProfile;
}
