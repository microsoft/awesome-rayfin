import { Customer } from './Customer.js';
import { Equipment } from './Equipment.js';
import { Job } from './Job.js';
import { JobLog } from './JobLog.js';
import { Region } from './Region.js';
import { TaskItem } from './TaskItem.js';
import { UserProfile } from './UserProfile.js';
import { UserRegion } from './UserRegion.js';

/**
 * Schema type definition for the Field Technician App
 *
 * This type maps entity names to their corresponding model types,
 * enabling full type safety throughout the application when using
 * the RayfinClient and DataApi.
 */
export type FieldTechSchema = {
  Customer: Customer;
  Equipment: Equipment;
  Job: Job;
  JobLog: JobLog;
  Region: Region;
  TaskItem: TaskItem;
  UserProfile: UserProfile;
  UserRegion: UserRegion;
};

export const schema = [
  Customer,
  Equipment,
  Job,
  JobLog,
  Region,
  TaskItem,
  UserProfile,
  UserRegion,
];
