import { Component, OnInit, inject, signal } from '@angular/core';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';

import type { Project } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';

export interface ProjectDialogData {
  project?: Project;
}

export interface ProjectFormResult {
  name: string;
  description?: string;
}

@Component({
  selector: 'app-project-form-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="dlg">
      <p class="eyebrow">{{ isEdit ? 'Edit project' : 'New project' }}</p>
      <h2 class="dlg__title">
        {{ isEdit ? 'Update the details.' : 'Name your project.' }}
      </h2>
      <mat-dialog-content class="dlg__body">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Name</mat-label>
          <input matInput [(ngModel)]="name" required maxlength="200" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Description</mat-label>
          <textarea
            matInput
            [(ngModel)]="description"
            rows="3"
            maxlength="1000"
          ></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end" class="dlg__actions">
        <button mat-button mat-dialog-close>Cancel</button>
        <button
          type="button"
          class="dlg__cta"
          [disabled]="!name.trim()"
          (click)="save()"
        >
          {{ isEdit ? 'Save changes' : 'Create project' }}
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
  `,
})
export class ProjectFormDialog {
  private readonly dialogRef = inject(MatDialogRef<ProjectFormDialog, ProjectFormResult>);
  private readonly data = inject<ProjectDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  protected readonly isEdit = !!this.data.project;
  protected name = this.data.project?.name ?? '';
  protected description = this.data.project?.description ?? '';

  protected save(): void {
    this.dialogRef.close({
      name: this.name.trim(),
      description: this.description.trim() || undefined,
    });
  }
}

@Component({
  selector: 'app-projects-list',
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="page page-enter">
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">Workspace</p>
          <h1 class="head__title">Projects.</h1>
          <p class="head__lead">
            {{ projects().length }}
            {{ projects().length === 1 ? 'project' : 'projects' }}
            @if (!appConfig.canWrite()) { · read-only }
          </p>
        </div>
        @if (appConfig.canWrite()) {
          <button
            type="button"
            class="primary-btn"
            (click)="newProject()"
          >
            <mat-icon>add</mat-icon>
            <span>New project</span>
          </button>
        }
      </header>

      @if (loading()) {
        <div class="cards">
          @for (n of skeletonItems; track n) {
            <div class="skeleton skeleton--card"></div>
          }
        </div>
      } @else if (projects().length === 0) {
        <div class="empty">
          <p class="eyebrow">No projects</p>
          <h2 class="empty__title">A blank page.</h2>
          <p class="empty__lead">
            Projects collect related tasks. Create your first one to
            get going.
          </p>
          @if (appConfig.canWrite()) {
            <button
              type="button"
              class="primary-btn"
              (click)="newProject()"
            >
              <mat-icon>add</mat-icon>
              <span>Create a project</span>
            </button>
          }
        </div>
      } @else {
        <div class="cards">
          @for (p of projects(); track p.id) {
            <a class="card" [routerLink]="['/projects', p.id]">
              <div class="card__head">
                <span class="card__num">
                  {{ ('0' + (cards().indexOf(p.id) + 1)).slice(-2) }}
                </span>
                @if (p.github_repo) {
                  <span class="pill pill--lime">GitHub</span>
                }
              </div>
              <h3 class="card__title">{{ p.name }}</h3>
              @if (p.description) {
                <p class="card__desc">{{ p.description }}</p>
              }
              <footer class="card__foot">
                @if (p.github_repo) {
                  <span class="mono dim">{{ p.github_repo }}</span>
                } @else if (p.created_at) {
                  <span class="mono dim">
                    Created {{ formatDate(p.created_at) }}
                  </span>
                } @else {
                  <span></span>
                }
                <span class="card__arrow">
                  <mat-icon>north_east</mat-icon>
                </span>
              </footer>
              @if (appConfig.canWrite()) {
                <button
                  type="button"
                  class="card__delete"
                  (click)="remove($event, p)"
                  aria-label="Delete project"
                >
                  <mat-icon>delete</mat-icon>
                </button>
              }
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
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

    /* Primary button — lime fill */
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
      letter-spacing: -0.005em;
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

    /* Empty state */
    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
      padding: 4rem 2rem;
      background: var(--ink-surface);
      border: 1px dashed var(--ink-border);
      border-radius: var(--radius-lg);
      max-width: 36rem;
      margin: 0 auto;
    }

    .empty__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: 2rem;
      letter-spacing: -0.025em;
      margin: 0.25rem 0 0;
    }

    .empty__lead {
      color: var(--cream-muted);
    }

    /* Cards grid */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(18rem, 100%), 1fr));
      gap: 1rem;
    }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
      padding: 1.5rem;
      min-width: 0;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      color: var(--cream);
      min-height: 14rem;
      transition: border-color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out);
    }

    .card:hover {
      border-color: var(--accent-border);
      transform: translateY(-2px);
      color: var(--cream);
    }

    .card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .card__num {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      color: var(--cream-dim);
    }

    .card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
      line-height: 1.15;
    }

    .card__desc {
      color: var(--cream-muted);
      font-size: var(--text-small);
      line-height: 1.55;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: auto;
      padding-top: 0.75rem;
      border-top: 1px solid var(--ink-border-soft);
      min-width: 0;
    }

    .card__foot .mono {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card__arrow {
      color: var(--cream-dim);
      transition: color var(--d-1) var(--ease-out),
        transform var(--d-1) var(--ease-out);
    }

    .card:hover .card__arrow {
      color: var(--accent);
      transform: translate(2px, -2px);
    }

    .card__arrow mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .card__delete {
      position: absolute;
      top: 0.875rem;
      right: 0.875rem;
      width: 1.75rem;
      height: 1.75rem;
      background: transparent;
      color: var(--cream-dim);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--d-1) var(--ease-out),
        color var(--d-1) var(--ease-out),
        border-color var(--d-1) var(--ease-out);
    }

    .card:hover .card__delete {
      opacity: 1;
    }

    .card__delete:hover {
      color: var(--rose);
      border-color: rgba(251, 113, 133, 0.25);
    }

    .card__delete mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
  `,
})
export class ProjectsList implements OnInit {
  private readonly data = inject(DataService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);

  // Stable card numbering — captures id order for the (i+1)/02 indicator.
  protected readonly cards = signal<string[]>([]);

  // Used by @for(track) for skeleton placeholders.
  protected readonly skeletonItems = [0, 1, 2, 3, 4, 5];

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const ps = await this.data.listProjects();
      this.projects.set(ps);
      this.cards.set(ps.map((p) => p.id));
    } finally {
      this.loading.set(false);
    }
  }

  protected formatDate(d: Date | string | undefined): string {
    if (!d) return '';
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  protected newProject(): void {
    const ref = this.dialog.open(ProjectFormDialog, {
      width: '32rem',
      panelClass: 'atelier-dialog',
    });
    ref.afterClosed().subscribe(async (result) => {
      if (!result) return;
      try {
        await this.data.createProject({
          ...result,
          created_at: new Date(),
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

  protected async remove(ev: Event, p: Project): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm(`Delete project "${p.name}" and all its tasks?`)) return;
    try {
      const tasks = await this.data.listTasksForProject(p.id);
      for (const t of tasks) await this.data.deleteTask(t.id);
      await this.data.deleteProject(p.id);
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
