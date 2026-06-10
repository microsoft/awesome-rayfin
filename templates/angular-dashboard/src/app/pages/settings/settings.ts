import { Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { APP_CONFIG_ID } from '../../services/constants';
import { AppConfigService } from '../../services/app-config.service';
import { GithubSyncService } from '../../services/github-sync.service';
import { envVar } from '../../../services/env';
import { getRayfinClient } from '../../../services/rayfinClient';

@Component({
  selector: 'app-settings',
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page page-enter">
      <header class="head">
        <p class="eyebrow">Workspace</p>
        <h1 class="head__title">Settings.</h1>
        <p class="head__lead">
          How this workspace is configured. Most of these affect every
          signed-in user.
        </p>
      </header>

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">Mode</h2>
          <span class="pill pill--{{ modePill() }}">
            {{ appConfig.mode() }}
          </span>
        </header>
        <dl class="grid">
          <div class="grid__row">
            <dt>Current mode</dt>
            <dd>
              <span>{{ modeLabel() }}</span>
              @if (envOverride) {
                <span class="grid__hint mono">via VITE_SYNC_MODE</span>
              }
            </dd>
          </div>
          @if (appConfig.repo(); as repo) {
            <div class="grid__row">
              <dt>Repository</dt>
              <dd>
                <a
                  class="grid__link mono"
                  [href]="'https://github.com/' + repo"
                  target="_blank"
                  rel="noopener"
                >
                  {{ repo }}
                  <mat-icon>open_in_new</mat-icon>
                </a>
              </dd>
            </div>
          }
          @if (appConfig.lastSyncedAt(); as last) {
            <div class="grid__row">
              <dt>Last synced</dt>
              <dd class="mono">{{ formatDate(last) }}</dd>
            </div>
          }
        </dl>

        @if (appConfig.isSynced()) {
          <button
            type="button"
            class="primary-btn"
            (click)="syncNow()"
            [disabled]="busy() !== null"
          >
            @if (busy() === 'sync') {
              <mat-spinner diameter="16" strokeWidth="2" />
            } @else {
              <mat-icon>refresh</mat-icon>
            }
            <span>Sync now</span>
          </button>
        }
      </section>

      <section class="section section--danger">
        <header class="section__head">
          <h2 class="section__title">Reset workspace</h2>
        </header>
        <p class="section__lead">
          Delete every project and task, then return to the setup wizard.
          This cannot be undone.
        </p>
        <button
          type="button"
          class="danger-btn"
          (click)="reset()"
          [disabled]="busy() !== null"
        >
          @if (busy() === 'reset') {
            <mat-spinner diameter="16" strokeWidth="2" />
          } @else {
            <mat-icon>delete_forever</mat-icon>
          }
          <span>Reset everything</span>
        </button>
      </section>

      <footer class="about">
        <p class="eyebrow">Colophon</p>
        <p class="about__text">
          Built with
          <a href="https://aka.ms/rayfin/docs" target="_blank" rel="noopener">
            Rayfin
          </a>
          ·
          <a href="https://angular.dev" target="_blank" rel="noopener">
            Angular
          </a>
          ·
          <a href="https://material.angular.dev" target="_blank" rel="noopener">
            Material
          </a>
          . Typeset in
          <span class="serif">Fraunces</span> and DM Sans.
        </p>
      </footer>
    </div>
  `,
  styles: `
    .page {
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
      max-width: 44rem;
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
      color: var(--cream-muted);
      max-width: 32rem;
    }

    /* Section */
    .section {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 1.75rem;
      min-width: 0;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
    }

    @media (max-width: 40rem) {
      .section { padding: 1.25rem; }
    }

    .section--danger {
      border-color: rgba(251, 113, 133, 0.2);
      background: linear-gradient(
          180deg,
          rgba(251, 113, 133, 0.04),
          rgba(251, 113, 133, 0)
        ),
        var(--ink-surface);
    }

    .section__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .section__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.375rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .section__lead {
      color: var(--cream-muted);
    }

    /* Definition grid */
    .grid {
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .grid__row {
      display: grid;
      grid-template-columns: 12rem minmax(0, 1fr);
      gap: 1rem;
      padding: 0.875rem 0;
      border-top: 1px solid var(--ink-border-soft);
    }

    .grid__row:first-child {
      border-top: none;
      padding-top: 0;
    }

    @media (max-width: 40rem) {
      .grid__row {
        grid-template-columns: minmax(0, 1fr);
        gap: 0.375rem;
      }
    }

    .grid dt {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .grid dd {
      margin: 0;
      color: var(--cream);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .grid__hint {
      font-size: var(--text-caption);
      color: var(--cream-dim);
    }

    .grid__link {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--cream);
      transition: color var(--d-1) var(--ease-out);
    }

    .grid__link:hover {
      color: var(--accent);
    }

    .grid__link mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    /* Buttons */
    .primary-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      align-self: flex-start;
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
      transition: transform var(--d-1) var(--ease-out),
        box-shadow var(--d-1) var(--ease-out);
    }

    .primary-btn:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 10px 26px -10px rgba(212, 255, 58, 0.5);
    }

    .primary-btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .danger-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      align-self: flex-start;
      height: 2.5rem;
      padding: 0 1rem;
      background: transparent;
      color: var(--rose);
      border: 1px solid rgba(251, 113, 133, 0.4);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      transition: background var(--d-1) var(--ease-out),
        color var(--d-1) var(--ease-out);
    }

    .danger-btn:hover:not([disabled]) {
      background: var(--rose-soft);
    }

    .danger-btn[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .primary-btn mat-icon,
    .danger-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .primary-btn .mat-mdc-progress-spinner,
    .danger-btn .mat-mdc-progress-spinner {
      --mat-progress-spinner-active-indicator-color: currentColor;
    }

    /* About */
    .about {
      padding-top: 2rem;
      border-top: 1px solid var(--ink-border-soft);
      color: var(--cream-dim);
    }

    .about__text {
      margin-top: 0.5rem;
      font-size: var(--text-small);
    }

    .about__text a {
      color: var(--cream-muted);
    }

    .about__text a:hover {
      color: var(--accent);
    }
  `,
})
export class Settings {
  protected readonly appConfig = inject(AppConfigService);
  private readonly sync = inject(GithubSyncService);
  private readonly snack = inject(MatSnackBar);

  protected readonly busy = signal<'sync' | 'reset' | null>(null);
  protected readonly envOverride = !!envVar(
    () => import.meta.env.VITE_SYNC_MODE
  );

  protected modePill(): string {
    const m = this.appConfig.mode();
    if (m === 'github') return 'lime';
    if (m === 'scratch') return 'emerald';
    return '';
  }

  protected modeLabel(): string {
    const m = this.appConfig.mode();
    if (m === 'github') return 'GitHub sync (read-only UI)';
    if (m === 'scratch') return 'Scratch (full CRUD)';
    return 'Not set up';
  }

  protected formatDate(d: Date | string): string {
    return new Date(d).toLocaleString();
  }

  protected async syncNow(): Promise<void> {
    this.busy.set('sync');
    try {
      const result = await this.sync.syncNow();
      this.snack.open(
        `Synced ${result.total} items (${result.created} new, ${result.updated} updated)`,
        'Dismiss',
        { duration: 4000 }
      );
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 6000 }
      );
    } finally {
      this.busy.set(null);
    }
  }

  protected async reset(): Promise<void> {
    if (
      !confirm(
        'Delete ALL projects and tasks and return to setup? This cannot be undone.'
      )
    )
      return;
    this.busy.set('reset');
    try {
      // Wipe rows even when in sync mode — bypass the canWrite guard so a
      // stuck user can always escape.
      const client = getRayfinClient();
      const tasks = await client.data.Task.findMany();
      for (const t of tasks) await client.data.Task.delete({ id: t.id });
      const projects = await client.data.Project.findMany();
      for (const p of projects) await client.data.Project.delete({ id: p.id });
      await client.data.AppConfig.update(
        { id: APP_CONFIG_ID },
        {
          sync_mode: 'pending',
          github_repo: undefined,
          last_synced_at: undefined,
        }
      );
      window.location.assign('/');
    } catch (err) {
      this.snack.open(
        err instanceof Error ? err.message : String(err),
        'Dismiss',
        { duration: 6000 }
      );
    } finally {
      this.busy.set(null);
    }
  }
}
