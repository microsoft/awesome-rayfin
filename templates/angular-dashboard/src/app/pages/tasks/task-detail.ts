import { Component, OnInit, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import type { Project, Task } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';
import {
  TaskDialogData,
  TaskFormDialog,
  TaskFormResult,
} from './tasks-list';

@Component({
  selector: 'app-task-detail',
  imports: [MatIconModule, RouterLink],
  template: `
    @if (loading()) {
      <div class="page page-enter">
        <div class="skeleton skeleton--card" style="height: 6rem"></div>
        <div class="skeleton skeleton--card" style="height: 12rem"></div>
      </div>
    } @else if (task(); as t) {
      <article class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/tasks" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All tasks</span>
          </a>
          @if (project(); as p) {
            <span class="crumbs__sep">·</span>
            <a [routerLink]="['/projects', p.id]" class="crumbs__project">
              {{ p.name }}
            </a>
          }
        </nav>

        <header class="hero">
          <div class="hero__chips">
            <span class="pill">{{ t.type }}</span>
            <span class="pill pill--{{ statusPill(t.status) }}">
              {{ formatStatus(t.status) }}
            </span>
            <span class="pill pill--{{ priorityPill(t.priority) }}">
              {{ t.priority }} priority
            </span>
          </div>
          <div class="hero__row">
            <h1 class="hero__title">{{ t.title }}</h1>
            @if (appConfig.canWrite()) {
              <div class="hero__actions">
                <button
                  type="button"
                  class="ghost-btn"
                  (click)="editTask(t)"
                  aria-label="Edit task"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  type="button"
                  class="ghost-btn ghost-btn--danger"
                  (click)="deleteTask(t)"
                  aria-label="Delete task"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            }
          </div>
          <dl class="meta">
            @if (t.assignee) {
              <div class="meta__group">
                <dt>Assignee</dt>
                <dd>{{ t.assignee }}</dd>
              </div>
            }
            @if (t.created_at) {
              <div class="meta__group">
                <dt>Created</dt>
                <dd class="mono">{{ formatDate(t.created_at) }}</dd>
              </div>
            }
            @if (t.updated_at) {
              <div class="meta__group">
                <dt>Updated</dt>
                <dd class="mono">{{ formatDate(t.updated_at) }}</dd>
              </div>
            }
            @if (t.closed_at) {
              <div class="meta__group">
                <dt>Closed</dt>
                <dd class="mono">{{ formatDate(t.closed_at) }}</dd>
              </div>
            }
            @if (t.github_number) {
              <div class="meta__group">
                <dt>GitHub</dt>
                <dd class="mono">#{{ t.github_number }}</dd>
              </div>
            }
          </dl>
        </header>

        @if (labels().length > 0) {
          <section class="labels">
            <p class="eyebrow">Labels</p>
            <div class="labels__row">
              @for (label of labels(); track label) {
                <span class="pill">{{ label }}</span>
              }
            </div>
          </section>
        }

        @if (t.body) {
          <section class="body">
            <p class="eyebrow">Body</p>
            <div class="body__content">
              <pre>{{ t.body }}</pre>
            </div>
          </section>
        }

        @if (t.github_url) {
          <a class="cta-link" [href]="t.github_url" target="_blank" rel="noopener">
            <span>Open on GitHub</span>
            <mat-icon>open_in_new</mat-icon>
          </a>
        }
      </article>
    } @else {
      <div class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/tasks" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All tasks</span>
          </a>
        </nav>
        <div class="empty">
          <p class="eyebrow">404</p>
          <h2 class="section-title">Task not found.</h2>
          <p class="muted">
            It may have been deleted or you may have followed a broken link.
          </p>
        </div>
      </div>
    }
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
      max-width: 52rem;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 4rem 0;
    }

    /* Crumbs */
    .crumbs {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .crumbs__back {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--cream-muted);
      transition: color var(--d-1) var(--ease-out);
    }

    .crumbs__back:hover {
      color: var(--accent);
    }

    .crumbs__back mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .crumbs__sep {
      color: var(--cream-dim);
    }

    .crumbs__project {
      color: var(--cream-muted);
      text-transform: none;
      letter-spacing: 0;
      font-family: var(--font-sans);
      font-size: var(--text-small);
    }

    .crumbs__project:hover {
      color: var(--accent);
    }

    /* Hero */
    .hero {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .hero__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .hero__row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4vw, 3rem);
      letter-spacing: -0.03em;
      line-height: 1.05;
      color: var(--cream);
      margin: 0;
      flex: 1 1 auto;
      min-width: 0;
    }

    .hero__actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .ghost-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      background: transparent;
      color: var(--cream-muted);
      border: 1px solid var(--ink-border-soft);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .ghost-btn:hover {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .ghost-btn--danger:hover {
      color: var(--rose);
      border-color: rgba(251, 113, 133, 0.35);
    }

    .ghost-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Meta */
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--ink-border-soft);
      margin: 0;
    }

    .meta__group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .meta dt {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .meta dd {
      margin: 0;
      color: var(--cream);
      font-size: 0.9375rem;
    }

    /* Labels */
    .labels {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .labels__row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    /* Body */
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .body__content {
      padding: 1.5rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-md);
    }

    .body__content pre {
      margin: 0;
      font-family: var(--font-mono);
      font-size: 0.875rem;
      line-height: 1.65;
      color: var(--cream);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* CTA link to GitHub */
    .cta-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      align-self: flex-start;
      padding: 0.625rem 1rem;
      background: transparent;
      color: var(--cream);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-pill);
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .cta-link:hover {
      color: var(--accent);
      border-color: var(--accent-border);
    }

    .cta-link mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .section-title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .empty {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1.5rem 0;
    }
  `,
})
export class TaskDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly task = signal<Task | null>(null);
  protected readonly project = signal<Project | null>(null);
  protected readonly loading = signal(true);

  protected labels(): string[] {
    const raw = this.task()?.labels_json;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((s): s is string => typeof s === 'string')
        : [];
    } catch {
      return [];
    }
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const task = await this.data.getTask(id);
      this.task.set(task);
      if (task?.project?.id) {
        this.project.set(await this.data.getProject(task.project.id));
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected editTask(t: Task): void {
    const projects: Project[] = [];
    const p = this.project();
    if (p) projects.push(p);
    const ref = this.dialog.open<TaskFormDialog, TaskDialogData, TaskFormResult>(
      TaskFormDialog,
      {
        width: '38rem',
        data: { task: t, projects, lockedProjectId: p?.id },
      }
    );
    ref.afterClosed().subscribe(async (result) => {
      if (!result) return;
      try {
        await this.data.updateTask(t.id, {
          ...result,
          updated_at: new Date(),
        });
        await this.refresh();
      } catch (err) {
        this.snack.open(
          err instanceof Error ? err.message : String(err),
          'Dismiss',
          { duration: 5000 }
        );
      }
    });
  }

  protected async deleteTask(t: Task): Promise<void> {
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try {
      await this.data.deleteTask(t.id);
      await this.router.navigate(['/tasks']);
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 5000 }
      );
    }
  }

  protected formatDate(d: Date | string | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected formatStatus(s: Task['status']): string {
    return s === 'in_progress' ? 'In progress' : s.charAt(0).toUpperCase() + s.slice(1);
  }

  protected statusPill(status: string): string {
    if (status === 'open') return 'emerald';
    if (status === 'in_progress') return 'amber';
    return '';
  }

  protected priorityPill(p: string): string {
    if (p === 'high') return 'rose';
    if (p === 'low') return '';
    return 'amber';
  }
}
