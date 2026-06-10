import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { UpperCasePipe } from '@angular/common';
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
} from '../tasks/tasks-list';
import {
  ProjectDialogData,
  ProjectFormDialog,
  ProjectFormResult,
} from './projects-list';

@Component({
  selector: 'app-project-detail',
  imports: [MatIconModule, RouterLink, UpperCasePipe],
  template: `
    @if (loading()) {
      <div class="page page-enter">
        <div class="skel-hero skeleton skeleton--card" style="height: 8rem"></div>
        <div class="skeleton skeleton--card" style="height: 12rem"></div>
      </div>
    } @else if (project(); as p) {
      <article class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/projects" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All projects</span>
          </a>
        </nav>

        <header class="hero">
          <p class="eyebrow">Project</p>
          <div class="hero__row">
            <h1 class="hero__title">{{ p.name }}</h1>
            @if (appConfig.canWrite()) {
              <div class="hero__actions">
                <button
                  type="button"
                  class="ghost-btn"
                  (click)="editProject(p)"
                  matTooltip="Edit project"
                  aria-label="Edit project"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  type="button"
                  class="ghost-btn ghost-btn--danger"
                  (click)="deleteProject(p)"
                  matTooltip="Delete project"
                  aria-label="Delete project"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              </div>
            }
          </div>
          @if (p.description) {
            <p class="hero__lead">{{ p.description }}</p>
          }
          <dl class="meta">
            @if (p.github_repo) {
              <div class="meta__group">
                <dt>Source</dt>
                <dd class="mono">{{ p.github_repo }}</dd>
              </div>
            }
            @if (p.created_at) {
              <div class="meta__group">
                <dt>Created</dt>
                <dd class="mono">{{ formatDate(p.created_at) }}</dd>
              </div>
            }
            <div class="meta__group">
              <dt>Tasks</dt>
              <dd class="mono">{{ tasks().length }}</dd>
            </div>
            <div class="meta__group">
              <dt>Open</dt>
              <dd class="mono">{{ counts().open }}</dd>
            </div>
          </dl>
        </header>

        <section class="tasks">
          <header class="tasks__head">
            <h3 class="section-title">Tasks</h3>
            @if (appConfig.canWrite()) {
              <button type="button" class="ghost-link" (click)="newTask(p)">
                <mat-icon>add</mat-icon>
                <span>Add task</span>
              </button>
            }
          </header>

          @if (tasks().length === 0) {
            <p class="empty">No tasks attached to this project yet.</p>
          } @else {
            <ol class="task-list">
              @for (t of tasks(); track t.id) {
                <li class="task-row">
                  <span class="dot" [class]="'dot--' + t.status"></span>
                  <a class="task-row__title" [routerLink]="['/tasks', t.id]">
                    {{ t.title }}
                  </a>
                  <span class="task-row__meta">
                    <span class="pill">{{ t.type | uppercase }}</span>
                    <span class="pill pill--{{ statusPill(t.status) }}">
                      {{ formatStatus(t.status) }}
                    </span>
                  </span>
                </li>
              }
            </ol>
          }
        </section>
      </article>
    } @else {
      <div class="page page-enter">
        <nav class="crumbs">
          <a routerLink="/projects" class="crumbs__back">
            <mat-icon>arrow_back</mat-icon>
            <span>All projects</span>
          </a>
        </nav>
        <div class="empty">
          <p class="eyebrow">404</p>
          <h2 class="section-title">Project not found.</h2>
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
      max-width: 56rem;
    }

    .crumbs { display: flex; align-items: center; }

    .crumbs__back {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-muted);
      transition: color var(--d-1) var(--ease-out);
    }

    .crumbs__back mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: transform var(--d-1) var(--ease-out);
    }

    .crumbs__back:hover { color: var(--accent); }
    .crumbs__back:hover mat-icon { transform: translateX(-2px); }

    /* Hero */
    .hero {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
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
      font-size: clamp(2.25rem, 5vw, 3.5rem);
      letter-spacing: -0.04em;
      line-height: 1;
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

    .hero__lead {
      font-size: 1.0625rem;
      line-height: 1.55;
      color: var(--cream-muted);
      max-width: 38rem;
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

    /* Tasks */
    .tasks {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .tasks__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .section-title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .ghost-link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out);
    }

    .ghost-link:hover { color: var(--accent); }

    .ghost-link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .empty {
      color: var(--cream-muted);
      padding: 1.5rem 0;
    }

    /* Task rows */
    .task-list {
      list-style: none;
      padding: 0;
      margin: 0;
      border-top: 1px solid var(--ink-border-soft);
    }

    .task-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.875rem;
      padding: 1rem 0.25rem;
      border-bottom: 1px solid var(--ink-border-soft);
    }

    .task-row__title {
      font-size: var(--text-body);
      color: var(--cream);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .task-row__title:hover { color: var(--accent); }

    .task-row__meta {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  `,
})
export class ProjectDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly project = signal<Project | null>(null);
  protected readonly tasks = signal<Task[]>([]);
  protected readonly loading = signal(true);

  protected readonly counts = computed(() => {
    const c = { open: 0, in_progress: 0, closed: 0 };
    for (const t of this.tasks()) c[t.status]++;
    return c;
  });

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
      const [project, tasks] = await Promise.all([
        this.data.getProject(id),
        this.data.listTasksForProject(id),
      ]);
      this.project.set(project);
      this.tasks.set(tasks);
    } finally {
      this.loading.set(false);
    }
  }

  protected editProject(p: Project): void {
    const ref = this.dialog.open<ProjectFormDialog, ProjectDialogData, ProjectFormResult>(
      ProjectFormDialog,
      { width: '32rem', data: { project: p } }
    );
    ref.afterClosed().subscribe(async (result) => {
      if (!result) return;
      try {
        await this.data.updateProject(p.id, result);
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

  protected async deleteProject(p: Project): Promise<void> {
    if (!confirm(`Delete project "${p.name}" and all its tasks?`)) return;
    try {
      const tasks = await this.data.listTasksForProject(p.id);
      for (const t of tasks) await this.data.deleteTask(t.id);
      await this.data.deleteProject(p.id);
      await this.router.navigate(['/projects']);
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 5000 }
      );
    }
  }

  protected newTask(p: Project): void {
    const ref = this.dialog.open<TaskFormDialog, TaskDialogData, TaskFormResult>(
      TaskFormDialog,
      {
        width: '38rem',
        data: { projects: [p], lockedProjectId: p.id },
      }
    );
    ref.afterClosed().subscribe(async (result) => {
      if (!result) return;
      try {
        await this.data.createTask({
          ...result,
          created_at: new Date(),
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

  protected formatDate(d: Date | string | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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
}
