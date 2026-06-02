import type { Job, JobStatus } from '../../../rayfin/data/Job';
import type { Equipment } from '../../../rayfin/data/Equipment';
import type { TaskItem } from '../../../rayfin/data/TaskItem';
import type { JobLog, JobLogType } from '../../../rayfin/data/JobLog';
import { IJobService, CreateJobData } from '../interfaces/IJobService';
import { getRayfinClient } from './RayfinClientService';

export class RayfinJobService implements IJobService {
  private getUserId(): string {
    const client = getRayfinClient();
    const userId = client.auth.getSession().user?.id;
    if (!userId) throw new Error('User is not authenticated');
    return userId;
  }

  // --- Job CRUD ---

  async createJob(data: CreateJobData): Promise<Job> {
    const client = getRayfinClient();
    const userId = this.getUserId();

    const profiles = await client.data.UserProfile
      .select(['id'])
      .where({ user_id: { eq: userId } })
      .execute();
    if (profiles.length === 0) throw new Error('User profile not found');

    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin create payloads accept partial relation stubs that are not fully modeled in the generated types
    const jobData: any = {
      title: data.title,
      description: data.description,
      status: data.scheduledAt ? 'scheduled' : 'new',
      scheduledAt: data.scheduledAt,
      createdAt: now,
      updatedAt: now,
      isOnSite: false,
      needsHelp: false,
      customer: { id: data.customerId },
      region: { id: data.regionId },
      createdBy: { id: profiles[0].id },
    };

    if (data.technicianId) {
      jobData.technician = { id: data.technicianId };
    }

    return client.data.Job.create(jobData);
  }

  async getJob(id: string): Promise<Job | null> {
    const client = getRayfinClient();
    const results = await client.data.Job
      .select([
        'id', 'title', 'description', 'status',
        'scheduledAt', 'completedAt', 'createdAt', 'updatedAt',
        'isOnSite', 'needsHelp', 'helpDescription',
      ])
      .where({ id: { eq: id } })
      .execute();
    return results.length > 0 ? results[0] : null;
  }

  async updateJobStatus(id: string, status: JobStatus): Promise<Job> {
    const client = getRayfinClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin update payload typing does not model conditional completion timestamps cleanly
    const updateData: any = { status, updatedAt: new Date() };
    if (status === 'complete' || status === 'abandoned') {
      updateData.completedAt = new Date();
    }
    return client.data.Job.update({ id }, updateData);
  }

  async scheduleJob(id: string, scheduledAt: Date | null): Promise<Job> {
    const client = getRayfinClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin update payload typing does not model optional schedule transitions cleanly
    const updateData: any = { scheduledAt, updatedAt: new Date() };
    if (scheduledAt) {
      updateData.status = 'scheduled';
    }
    return client.data.Job.update({ id }, updateData);
  }

  async assignTechnician(jobId: string, technicianId: string): Promise<Job> {
    const client = getRayfinClient();
    return client.data.Job.update({ id: jobId }, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin relation updates accept id-only stubs that are not reflected in generated types
      technician: { id: technicianId } as any,
      updatedAt: new Date(),
    });
  }

  async setOnSite(jobId: string, isOnSite: boolean): Promise<Job> {
    const client = getRayfinClient();
    return client.data.Job.update({ id: jobId }, {
      isOnSite,
      updatedAt: new Date(),
    });
  }

  async requestHelp(jobId: string, description: string): Promise<Job> {
    const client = getRayfinClient();
    return client.data.Job.update({ id: jobId }, {
      needsHelp: true,
      helpDescription: description,
      updatedAt: new Date(),
    });
  }

  async clearHelpRequest(jobId: string): Promise<Job> {
    const client = getRayfinClient();
    return client.data.Job.update({ id: jobId }, {
      needsHelp: false,
      helpDescription: '',
      updatedAt: new Date(),
    });
  }

  // --- Job Queries ---

  async getJobsForTechnician(_technicianId: string): Promise<Job[]> {
    const client = getRayfinClient();
    // Note: filtering by relationship FK may need adjustment based on Rayfin's actual filter support
    return client.data.Job
      .select([
        'id', 'title', 'status', 'scheduledAt', 'updatedAt',
        'isOnSite', 'needsHelp',
      ])
      .orderBy({ updatedAt: 'desc' })
      .execute();
  }

  async getUnscheduledJobs(): Promise<Job[]> {
    const client = getRayfinClient();
    return client.data.Job
      .select([
        'id', 'title', 'status', 'createdAt', 'updatedAt', 'needsHelp',
      ])
      .where({ status: { eq: 'new' } })
      .orderBy({ createdAt: 'desc' })
      .execute();
  }

  async getInProgressJobs(): Promise<Job[]> {
    const client = getRayfinClient();
    return client.data.Job
      .select([
        'id', 'title', 'status', 'scheduledAt', 'createdAt', 'updatedAt',
        'isOnSite', 'needsHelp',
      ])
      .where({ status: { eq: 'in-progress' } })
      .orderBy({ updatedAt: 'desc' })
      .execute();
  }

  async getOverdueJobs(): Promise<Job[]> {
    const client = getRayfinClient();
    return client.data.Job
      .select([
        'id', 'title', 'status', 'scheduledAt', 'createdAt', 'updatedAt', 'needsHelp',
      ])
      .where({ status: { eq: 'scheduled' } })
      .orderBy({ scheduledAt: 'asc' })
      .execute();
  }

  async getHelpRequestJobs(): Promise<Job[]> {
    const client = getRayfinClient();
    return client.data.Job
      .select([
        'id', 'title', 'status', 'helpDescription', 'createdAt', 'updatedAt', 'needsHelp',
      ])
      .where({ needsHelp: { eq: true } })
      .orderBy({ updatedAt: 'desc' })
      .execute();
  }

  // --- Equipment ---

  async addEquipment(
    jobId: string,
    data: { name: string; serialNumber?: string; notes?: string }
  ): Promise<Equipment> {
    const client = getRayfinClient();
    return client.data.Equipment.create({
      name: data.name,
      serialNumber: data.serialNumber,
      notes: data.notes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin relation creates accept id-only stubs that are not reflected in generated types
      job: { id: jobId } as any,
    });
  }

  async getEquipment(_jobId: string): Promise<Equipment[]> {
    const client = getRayfinClient();
    return client.data.Equipment
      .select(['id', 'name', 'serialNumber', 'notes'])
      .execute();
  }

  async updateEquipment(
    id: string,
    data: Partial<Pick<Equipment, 'name' | 'serialNumber' | 'notes'>>
  ): Promise<Equipment> {
    const client = getRayfinClient();
    return client.data.Equipment.update({ id }, data);
  }

  async deleteEquipment(id: string): Promise<void> {
    const client = getRayfinClient();
    await client.data.Equipment.delete({ id });
  }

  // --- Task Items ---

  async addTaskItem(
    jobId: string,
    data: { description: string; sortOrder: number }
  ): Promise<TaskItem> {
    const client = getRayfinClient();
    return client.data.TaskItem.create({
      description: data.description,
      isComplete: false,
      sortOrder: data.sortOrder,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin relation creates accept id-only stubs that are not reflected in generated types
      job: { id: jobId } as any,
    });
  }

  async getTaskItems(_jobId: string): Promise<TaskItem[]> {
    const client = getRayfinClient();
    return client.data.TaskItem
      .select(['id', 'description', 'isComplete', 'sortOrder'])
      .orderBy({ sortOrder: 'asc' })
      .execute();
  }

  async toggleTaskItem(id: string, isComplete: boolean): Promise<TaskItem> {
    const client = getRayfinClient();
    return client.data.TaskItem.update({ id }, { isComplete });
  }

  async deleteTaskItem(id: string): Promise<void> {
    const client = getRayfinClient();
    await client.data.TaskItem.delete({ id });
  }

  // --- Job Logs ---

  async addJobLog(
    jobId: string,
    data: { type: JobLogType; message: string; imageUrl?: string }
  ): Promise<JobLog> {
    const client = getRayfinClient();
    const userId = this.getUserId();

    return client.data.JobLog.create({
      type: data.type,
      message: data.message,
      imageUrl: data.imageUrl,
      actor_id: userId,
      createdAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin relation creates accept id-only stubs that are not reflected in generated types
      job: { id: jobId } as any,
    });
  }

  async getJobLogs(_jobId: string): Promise<JobLog[]> {
    const client = getRayfinClient();
    return client.data.JobLog
      .select(['id', 'type', 'message', 'imageUrl', 'actor_id', 'createdAt'])
      .orderBy({ createdAt: 'desc' })
      .execute();
  }
}
