import {
  entity,
  authenticated,
  uuid,
  text,
  int,
  date,
  set,
  one,
  many,
} from '@microsoft/rayfin-core';

@entity()
@authenticated('*')
export class Project {
  @uuid() id!: string;
  @text({ max: 200 }) name!: string;
  @text({ max: 1000, optional: true }) description?: string;
  // "owner/name" when sourced from a synced GitHub repo.
  @text({ max: 200, optional: true }) github_repo?: string;
  @date({ optional: true }) created_at?: Date;
  @many(() => Task) tasks?: Task[];
}

@entity()
@authenticated('*')
export class Task {
  // For synced rows, this is a deterministic UUID v5 of "<repo>#<number>"
  // so re-runs are idempotent and concurrent syncs converge on the same id.
  @uuid() id!: string;
  @text({ max: 500 }) title!: string;
  // Unbounded NVARCHAR(MAX) — issue/PR bodies can be arbitrarily long.
  @text({ optional: true }) body?: string;
  @set('issue', 'pr') type!: 'issue' | 'pr';
  @set('open', 'in_progress', 'closed') status!: 'open' | 'in_progress' | 'closed';
  @set('low', 'medium', 'high') priority!: 'low' | 'medium' | 'high';
  @text({ max: 200, optional: true }) assignee?: string;
  @int({ optional: true }) github_number?: number;
  @text({ max: 500, optional: true }) github_url?: string;
  // Display-only JSON array of label names. Not server-side filterable —
  // promote to a Label/TaskLabel pair if you need queryable tagging.
  @text({ max: 2000, optional: true }) labels_json?: string;
  @date({ optional: true }) created_at?: Date;
  @date({ optional: true }) updated_at?: Date;
  @date({ optional: true }) closed_at?: Date;
  @one(() => Project) project!: Project;
}

// Singleton config row — see APP_CONFIG_ID in src/app/services/constants.ts.
@entity()
@authenticated('*')
export class AppConfig {
  @uuid() id!: string;
  @set('pending', 'scratch', 'github') sync_mode!: 'pending' | 'scratch' | 'github';
  @text({ max: 200, optional: true }) github_repo?: string;
  @date({ optional: true }) last_synced_at?: Date;
}

export type DashboardSchema = {
  Project: Project;
  Task: Task;
  AppConfig: AppConfig;
};

export const schema = [Project, Task, AppConfig];
