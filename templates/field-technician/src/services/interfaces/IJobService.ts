import type { Job, JobStatus } from '../../../rayfin/data/Job';
import type { Equipment } from '../../../rayfin/data/Equipment';
import type { TaskItem } from '../../../rayfin/data/TaskItem';
import type { JobLog, JobLogType } from '../../../rayfin/data/JobLog';

export interface CreateJobData {
  title: string;
  description?: string;
  customerId: string;
  regionId: string;
  technicianId?: string;
  scheduledAt?: Date;
}

export interface IJobService {
  // Job CRUD
  createJob(data: CreateJobData): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  updateJobStatus(id: string, status: JobStatus): Promise<Job>;
  scheduleJob(id: string, scheduledAt: Date | null): Promise<Job>;
  assignTechnician(jobId: string, technicianId: string): Promise<Job>;
  setOnSite(jobId: string, isOnSite: boolean): Promise<Job>;
  requestHelp(jobId: string, description: string): Promise<Job>;
  clearHelpRequest(jobId: string): Promise<Job>;

  // Job queries
  getJobsForTechnician(technicianId: string): Promise<Job[]>;
  getUnscheduledJobs(): Promise<Job[]>;
  getInProgressJobs(): Promise<Job[]>;
  getOverdueJobs(): Promise<Job[]>;
  getHelpRequestJobs(): Promise<Job[]>;

  // Equipment
  addEquipment(
    jobId: string,
    data: { name: string; serialNumber?: string; notes?: string }
  ): Promise<Equipment>;
  getEquipment(jobId: string): Promise<Equipment[]>;
  updateEquipment(
    id: string,
    data: Partial<Pick<Equipment, 'name' | 'serialNumber' | 'notes'>>
  ): Promise<Equipment>;
  deleteEquipment(id: string): Promise<void>;

  // Task items
  addTaskItem(
    jobId: string,
    data: { description: string; sortOrder: number }
  ): Promise<TaskItem>;
  getTaskItems(jobId: string): Promise<TaskItem[]>;
  toggleTaskItem(id: string, isComplete: boolean): Promise<TaskItem>;
  deleteTaskItem(id: string): Promise<void>;

  // Job logs
  addJobLog(
    jobId: string,
    data: { type: JobLogType; message: string; imageUrl?: string }
  ): Promise<JobLog>;
  getJobLogs(jobId: string): Promise<JobLog[]>;
}
