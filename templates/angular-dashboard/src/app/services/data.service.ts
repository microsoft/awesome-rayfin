import { Injectable, inject } from '@angular/core';

import type { Project, Task } from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { AppConfigService } from './app-config.service';

type ProjectCreate = Omit<Project, 'id' | 'tasks'> & { id?: string };
type ProjectUpdate = Partial<Omit<Project, 'tasks'>>;
type TaskCreate = Omit<Task, 'id' | 'project'> & {
  id?: string;
  project: { id: string };
};
type TaskUpdate = Partial<Omit<Task, 'project'>> & {
  project?: { id: string };
};

// The SDK's default field selection only returns the primary key, so we have
// to spell out which columns to load on every read query.
const PROJECT_FIELDS = [
  'id',
  'name',
  'description',
  'github_repo',
  'created_at',
] as const;
const TASK_FIELDS = [
  'id',
  'title',
  'body',
  'type',
  'status',
  'priority',
  'assignee',
  'github_number',
  'github_url',
  'labels_json',
  'created_at',
  'updated_at',
  'closed_at',
  'project.id',
] as const;

/**
 * Thin wrapper around the Rayfin data client for Project + Task. Exists so
 * components don't reach into the raw client and so write paths can refuse to
 * fire when the app is in sync mode (defense in depth on top of UI gating).
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly appConfig = inject(AppConfigService);

  // ── Projects ───────────────────────────────────────────────────────────

  listProjects(): Promise<Project[]> {
    return getRayfinClient()
      .data.Project.select([...PROJECT_FIELDS])
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  getProject(id: string): Promise<Project | null> {
    return getRayfinClient()
      .data.Project.select([...PROJECT_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createProject(input: ProjectCreate): Promise<Project> {
    this.assertWritable();
    const created = await getRayfinClient().data.Project.create(input);
    // Mutations only echo back the fields you sent; re-read so callers get
    // a fully-hydrated row.
    return (await this.getProject(created.id)) ?? created;
  }

  async updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
    this.assertWritable();
    await getRayfinClient().data.Project.update({ id }, patch);
    const reloaded = await this.getProject(id);
    if (!reloaded) throw new Error(`Project ${id} not found after update`);
    return reloaded;
  }

  deleteProject(id: string): Promise<Project> {
    this.assertWritable();
    return getRayfinClient().data.Project.delete({ id });
  }

  // ── Tasks ──────────────────────────────────────────────────────────────

  listTasks(): Promise<Task[]> {
    return getRayfinClient()
      .data.Task.select([...TASK_FIELDS])
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  listTasksForProject(projectId: string): Promise<Task[]> {
    return getRayfinClient()
      .data.Task.select([...TASK_FIELDS])
      .where({ project: { id: { eq: projectId } } })
      .orderBy({ created_at: 'desc' })
      .execute();
  }

  getTask(id: string): Promise<Task | null> {
    return getRayfinClient()
      .data.Task.select([...TASK_FIELDS])
      .where({ id: { eq: id } })
      .findFirst();
  }

  async createTask(input: TaskCreate): Promise<Task> {
    this.assertWritable();
    const created = await getRayfinClient().data.Task.create(input);
    return (await this.getTask(created.id)) ?? created;
  }

  async updateTask(id: string, patch: TaskUpdate): Promise<Task> {
    this.assertWritable();
    await getRayfinClient().data.Task.update({ id }, patch);
    const reloaded = await this.getTask(id);
    if (!reloaded) throw new Error(`Task ${id} not found after update`);
    return reloaded;
  }

  deleteTask(id: string): Promise<Task> {
    this.assertWritable();
    return getRayfinClient().data.Task.delete({ id });
  }

  // ── Reset (Settings → "Reset to scratch") ──────────────────────────────

  /** Delete every Task + Project. Caller flips `AppConfig.sync_mode` separately. */
  async wipeAll(): Promise<void> {
    const client = getRayfinClient();
    const tasks = await client.data.Task.findMany(); // id-only is enough here
    for (const t of tasks) await client.data.Task.delete({ id: t.id });
    const projects = await client.data.Project.findMany();
    for (const p of projects) await client.data.Project.delete({ id: p.id });
  }

  private assertWritable(): void {
    if (!this.appConfig.canWrite()) {
      throw new Error(
        'This project is in GitHub-sync mode (read-only). Switch to scratch in Settings.'
      );
    }
  }
}
