import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import type { Project, Task } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';

export interface TaskDialogData {
  task?: Task;
  projects: Project[];
  lockedProjectId?: string;
}

export interface TaskFormResult {
  title: string;
  body?: string;
  type: Task['type'];
  status: Task['status'];
  priority: Task['priority'];
  project: { id: string };
}

@Component({
  selector: 'app-task-form-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <div class="dlg">
      <p class="eyebrow">{{ isEdit ? 'Edit task' : 'New task' }}</p>
      <h2 class="dlg__title">
        {{ isEdit ? 'Update the task.' : 'What needs doing?' }}
      </h2>
      <mat-dialog-content class="dlg__body">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Title</mat-label>
          <input matInput [(ngModel)]="title" required maxlength="500" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Project</mat-label>
          <mat-select [(ngModel)]="projectId" [disabled]="!!lockedProjectId">
            @for (p of projects; track p.id) {
              <mat-option [value]="p.id">{{ p.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select [(ngModel)]="type">
              <mat-option value="issue">issue</mat-option>
              <mat-option value="pr">pr</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select [(ngModel)]="status">
              <mat-option value="open">open</mat-option>
              <mat-option value="in_progress">in progress</mat-option>
              <mat-option value="closed">closed</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Priority</mat-label>
            <mat-select [(ngModel)]="priority">
              <mat-option value="low">low</mat-option>
              <mat-option value="medium">medium</mat-option>
              <mat-option value="high">high</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Notes</mat-label>
          <textarea
            matInput
            [(ngModel)]="body"
            rows="4"
            maxlength="4000"
          ></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="dlg__actions">
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          type="button"
          class="dlg__cta"
          [disabled]="!title.trim() || !projectId"
          (click)="save()"
        >
          {{ isEdit ? 'Save changes' : 'Create task' }}
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: `
    .dlg {
      padding: 1.5rem 1.75rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .dlg__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 400;
      font-size: 1.75rem;
      letter-spacing: -0.025em;
      margin: 0 0 0.25rem;
      color: var(--cream);
    }
    .dlg__body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem 0 0 !important;
    }
    .dlg__actions { padding: 0 !important; gap: 0.5rem; }
    .dlg__cta {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      height: 2.5rem;
      padding: 0 1rem;
      background: var(--accent);
      color: var(--ink-bg);
      border: 1px solid var(--accent);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      letter-spacing: -0.005em;
      transition: transform var(--d-1) var(--ease-out),
        box-shadow var(--d-1) var(--ease-out);
    }
    .dlg__cta:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 10px 26px -10px var(--accent-glow);
    }
    .dlg__cta[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .full { width: 100%; }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.5rem;
    }
    @media (max-width: 30rem) {
      .row { grid-template-columns: 1fr; }
    }
  `,
})
export class TaskFormDialog {
  private readonly dialogRef = inject(MatDialogRef<TaskFormDialog, TaskFormResult>);
  private readonly data = inject<TaskDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = !!this.data.task;
  protected readonly lockedProjectId = this.data.lockedProjectId;
  protected readonly projects = this.data.projects;

  protected title = this.data.task?.title ?? '';
  protected projectId =
    this.data.task?.project?.id ?? this.lockedProjectId ?? '';
  protected type: Task['type'] = this.data.task?.type ?? 'issue';
  protected status: Task['status'] = this.data.task?.status ?? 'open';
  protected priority: Task['priority'] = this.data.task?.priority ?? 'medium';
  protected body = this.data.task?.body ?? '';

  protected save(): void {
    this.dialogRef.close({
      title: this.title.trim(),
      body: this.body.trim() || undefined,
      type: this.type,
      status: this.status,
      priority: this.priority,
      project: { id: this.projectId },
    });
  }
}

@Component({
  selector: 'app-tasks-list',
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
  ],
  template: `
    <div class="page page-enter">
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">Workspace</p>
          <h1 class="head__title">Tasks.</h1>
          <p class="head__lead">
            {{ filtered().length }} showing · {{ tasks().length }} total
            @if (!appConfig.canWrite()) { · read-only }
          </p>
        </div>
        @if (appConfig.canWrite()) {
          <button type="button" class="primary-btn" (click)="newTask()">
            <mat-icon>add</mat-icon>
            <span>New task</span>
          </button>
        }
      </header>

      <div class="filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="statusFilter">
            <mat-option value="">All</mat-option>
            <mat-option value="open">Open</mat-option>
            <mat-option value="in_progress">In progress</mat-option>
            <mat-option value="closed">Closed</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Type</mat-label>
          <mat-select [(ngModel)]="typeFilter">
            <mat-option value="">All</mat-option>
            <mat-option value="issue">Issue</mat-option>
            <mat-option value="pr">Pull request</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Priority</mat-label>
          <mat-select [(ngModel)]="priorityFilter">
            <mat-option value="">All</mat-option>
            <mat-option value="low">Low</mat-option>
            <mat-option value="medium">Medium</mat-option>
            <mat-option value="high">High</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      @if (loading()) {
        <ol class="list">
          @for (n of skeletonItems; track n) {
            <li class="row row--skeleton">
              <span class="skeleton skeleton--text" style="width: 60%"></span>
              <span class="skeleton skeleton--pill"></span>
              <span class="skeleton skeleton--pill"></span>
              <span class="skeleton skeleton--pill" style="width: 3rem"></span>
            </li>
          }
        </ol>
      } @else if (filtered().length === 0) {
        <div class="empty">
          <p class="eyebrow">No matches</p>
          <h2 class="empty__title">Nothing here.</h2>
          <p class="muted">
            Try clearing a filter or
            @if (appConfig.canWrite()) { creating a task. }
            @else { syncing again. }
          </p>
        </div>
      } @else {
        <ol class="list">
          <li class="list__header">
            <span class="col-title">Title</span>
            <span class="col-project">Project</span>
            <span class="col-pill">Type</span>
            <span class="col-pill">Status</span>
            <span class="col-pill">Priority</span>
            <span class="col-actions"></span>
          </li>
          @for (t of filtered(); track t.id) {
            <li class="row">
              <a class="row__title" [routerLink]="['/tasks', t.id]">
                <span class="dot" [class]="'dot--' + t.status"></span>
                <span class="row__title-text">{{ t.title }}</span>
              </a>
              <div class="row__meta">
                <span class="row__project mono dim">
                  {{ projectName(t.project.id) }}
                </span>
                <span class="row__chips">
                  <span class="pill">{{ t.type }}</span>
                  <span class="pill pill--{{ statusPill(t.status) }}">
                    {{ formatStatus(t.status) }}
                  </span>
                  <span class="pill pill--{{ priorityPill(t.priority) }}">
                    {{ t.priority }}
                  </span>
                </span>
              </div>
              @if (appConfig.canWrite()) {
                <button
                  type="button"
                  class="row__delete"
                  (click)="remove($event, t)"
                  aria-label="Delete task"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </li>
          }
        </ol>
      }
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .head__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.5rem, 5vw, 3.75rem);
      letter-spacing: -0.04em;
      line-height: 1;
      margin: 0.5rem 0 0.75rem;
      color: var(--cream);
    }

    .head__lead {
      font-family: var(--font-mono);
      font-size: var(--text-small);
      color: var(--cream-muted);
    }

    .primary-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      height: 2.75rem;
      padding: 0 1.125rem;
      background: var(--accent);
      color: var(--ink-bg);
      border: 1px solid var(--accent);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      transition: transform var(--d-1) var(--ease-out),
        box-shadow var(--d-1) var(--ease-out);
    }

    .primary-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 36px -12px rgba(212, 255, 58, 0.5);
    }

    .primary-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    /* Filters */
    .filters {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .filters mat-form-field {
      min-width: 12rem;
    }

    /* Empty state */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 3rem 2rem;
      background: var(--ink-surface);
      border: 1px dashed var(--ink-border);
      border-radius: var(--radius-lg);
      max-width: 36rem;
      margin: 1rem auto;
    }

    .empty__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: 2rem;
      letter-spacing: -0.025em;
      margin: 0;
    }

    /* List */
    .list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .list__header {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) 5rem 7rem 5.5rem 2rem;
      gap: 1rem;
      align-items: center;
      padding: 0.875rem 0.5rem 0.625rem;
      border-bottom: 1px solid var(--ink-border);
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 0.75rem 1rem;
      align-items: center;
      padding: 0.875rem 0.5rem;
      border-bottom: 1px solid var(--ink-border-soft);
      transition: background var(--d-1) var(--ease-out);
    }

    .row:hover { background: var(--ink-surface); }

    .row--skeleton {
      grid-template-columns: minmax(0, 1fr) auto auto auto;
    }

    .row--skeleton:hover { background: transparent; }

    .row__title {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      color: var(--cream);
      font-weight: 500;
      min-width: 0;
    }

    .row__title:hover { color: var(--accent); }

    .row__title-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .row__meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
    }

    .row__project {
      font-size: var(--text-small);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      max-width: 14rem;
    }

    .row__chips {
      display: inline-flex;
      gap: 0.5rem;
      flex-wrap: nowrap;
    }

    /* Narrow layout — title and delete share row 1, meta wraps onto row 2. */
    @media (max-width: 70rem) {
      .list__header { display: none; }

      .row {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          'title delete'
          'meta meta';
        gap: 0.5rem 0.75rem;
        padding: 1rem 0.5rem;
      }

      .row__title { grid-area: title; }
      .row__delete { grid-area: delete; align-self: center; }

      .row__meta {
        display: flex;
        grid-area: meta;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        padding-left: 1.125rem; /* line up with title text past the dot */
      }

      .row__project {
        max-width: 100%;
      }

      .row__chips {
        flex-wrap: wrap;
      }
    }

    .row__delete {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.75rem;
      height: 1.75rem;
      background: transparent;
      color: var(--cream-dim);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .row:hover .row__delete { color: var(--cream-muted); }

    .row__delete:hover {
      color: var(--rose);
      border-color: rgba(251, 113, 133, 0.25);
    }

    .row__delete mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }
  `,
})
export class TasksList implements OnInit {
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly tasks = signal<Task[]>([]);
  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);

  // Used by @for(track) for skeleton placeholders.
  protected readonly skeletonItems = [0, 1, 2, 3, 4, 5, 6];

  protected statusFilter = '';
  protected typeFilter = '';
  protected priorityFilter = '';

  protected readonly filtered = computed(() =>
    this.tasks().filter(
      (t) =>
        (!this.statusFilter || t.status === this.statusFilter) &&
        (!this.typeFilter || t.type === this.typeFilter) &&
        (!this.priorityFilter || t.priority === this.priorityFilter)
    )
  );

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const [tasks, projects] = await Promise.all([
        this.data.listTasks(),
        this.data.listProjects(),
      ]);
      this.tasks.set(tasks);
      this.projects.set(projects);
    } finally {
      this.loading.set(false);
    }
  }

  protected projectName(id: string | undefined): string {
    if (!id) return '—';
    return this.projects().find((p) => p.id === id)?.name ?? '—';
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

  protected newTask(): void {
    const ref = this.dialog.open(TaskFormDialog, {
      width: '38rem',
      data: { projects: this.projects() } as TaskDialogData,
    });
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

  protected async remove(ev: Event, t: Task): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm(`Delete task "${t.title}"?`)) return;
    try {
      await this.data.deleteTask(t.id);
      await this.refresh();
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 5000 }
      );
    }
  }
}
