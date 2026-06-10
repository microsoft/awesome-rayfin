import { Injectable, inject } from '@angular/core';
import { v5 as uuidv5 } from 'uuid';

import type { Project, Task } from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { AppConfigService } from './app-config.service';
import {
  GITHUB_MAX_PAGES,
  GITHUB_PAGE_SIZE,
  PROJECT_NAMESPACE_UUID,
  SYNC_STALE_MS,
  TASK_NAMESPACE_UUID,
} from './constants';

interface GhUser {
  login: string;
}

interface GhLabel {
  name: string;
}

interface GhIssueOrPr {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  state_reason?: string | null;
  html_url: string;
  pull_request?: unknown; // presence ⇒ this is a PR, not an issue
  assignee?: GhUser | null;
  labels: GhLabel[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface SyncResult {
  created: number;
  updated: number;
  total: number;
}

/** Maps GitHub labels → our priority enum. Falls back to 'medium'. */
function pickPriority(labels: GhLabel[]): Task['priority'] {
  const names = new Set(labels.map((l) => l.name.toLowerCase()));
  if (names.has('priority: high') || names.has('high priority') || names.has('p0') || names.has('p1')) {
    return 'high';
  }
  if (names.has('priority: low') || names.has('low priority') || names.has('p3') || names.has('p4')) {
    return 'low';
  }
  return 'medium';
}

function pickStatus(item: GhIssueOrPr): Task['status'] {
  if (item.state === 'closed') return 'closed';
  const inProgress = item.labels.some((l) =>
    ['in progress', 'in-progress', 'wip'].includes(l.name.toLowerCase())
  );
  return inProgress ? 'in_progress' : 'open';
}

@Injectable({ providedIn: 'root' })
export class GithubSyncService {
  private readonly appConfig = inject(AppConfigService);

  /**
   * Validate a public repo via GET /repos/:owner/:name (unauthenticated).
   * Returns the canonical "owner/name" on success, or null on failure.
   */
  async validateRepo(repo: string): Promise<string | null> {
    const cleaned = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return null;
    try {
      const res = await fetch(`https://api.github.com/repos/${cleaned}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { full_name?: string };
      return json.full_name ?? cleaned;
    } catch {
      return null;
    }
  }

  /** Run sync only if the last sync is older than SYNC_STALE_MS. */
  async maybeAutoSync(): Promise<SyncResult | null> {
    if (!this.appConfig.isSynced()) return null;
    const last = this.appConfig.lastSyncedAt();
    if (last) {
      const lastMs = new Date(last).getTime();
      if (Date.now() - lastMs < SYNC_STALE_MS) return null;
    }
    return this.syncNow();
  }

  /** Full sync against the configured repo. */
  async syncNow(): Promise<SyncResult> {
    const repo = this.appConfig.repo();
    if (!repo) throw new Error('No GitHub repo configured.');

    const project = await this.ensureProject(repo);
    const items = await this.fetchIssuesAndPrs(repo);

    let created = 0;
    let updated = 0;

    for (const item of items) {
      const id = uuidv5(`${repo}#${item.number}`, TASK_NAMESPACE_UUID);
      const payload = {
        title: item.title,
        body: item.body ?? undefined,
        type: (item.pull_request ? 'pr' : 'issue') as Task['type'],
        status: pickStatus(item),
        priority: pickPriority(item.labels),
        assignee: item.assignee?.login,
        github_number: item.number,
        github_url: item.html_url,
        labels_json: JSON.stringify(item.labels.map((l) => l.name)),
        created_at: new Date(item.created_at),
        updated_at: new Date(item.updated_at),
        closed_at: item.closed_at ? new Date(item.closed_at) : undefined,
        project: { id: project.id },
      };
      const client = getRayfinClient();
      // Track create-vs-update for the result counter. Native upsert is
      // race-safe because deterministic ids converge across concurrent runs.
      const existed = await client.data.Task.findById(id);
      await client.data.Task.upsert(
        { id },
        { id, ...payload },
        payload
      );
      if (existed) updated++;
      else created++;
    }

    await this.appConfig.patch({ last_synced_at: new Date() });
    return { created, updated, total: items.length };
  }

  /** Ensure a deterministic Project row exists for the given repo. */
  private async ensureProject(repo: string): Promise<Project> {
    const id = uuidv5(repo, PROJECT_NAMESPACE_UUID);
    const client = getRayfinClient();
    // id is the only field we actually consume below, so the SDK's default
    // id-only projection is enough.
    const existing = await client.data.Project.findById(id);
    if (existing) return existing;
    try {
      return await client.data.Project.create({
        id,
        name: repo,
        description: `Synced from https://github.com/${repo}`,
        github_repo: repo,
        created_at: new Date(),
      });
    } catch {
      const refetched = await client.data.Project.findById(id);
      if (!refetched) throw new Error(`Failed to create or load project ${repo}`);
      return refetched;
    }
  }

  /** Paginated fetch of issues + PRs from the public GitHub REST API. */
  private async fetchIssuesAndPrs(repo: string): Promise<GhIssueOrPr[]> {
    const all: GhIssueOrPr[] = [];
    for (let page = 1; page <= GITHUB_MAX_PAGES; page++) {
      const url = `https://api.github.com/repos/${repo}/issues?state=all&per_page=${GITHUB_PAGE_SIZE}&page=${page}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new Error(
            'GitHub API rate limit exceeded. Try again later or sync a smaller repo.'
          );
        }
        throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
      }
      const batch = (await res.json()) as GhIssueOrPr[];
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < GITHUB_PAGE_SIZE) break;
    }
    return all;
  }
}
