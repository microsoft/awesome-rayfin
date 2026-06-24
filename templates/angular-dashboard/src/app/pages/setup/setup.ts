import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';
import { GithubSyncService } from '../../services/github-sync.service';

@Component({
  selector: 'app-setup',
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      <header class="header page-enter">
        <p class="eyebrow">Step 01 — set up your workspace</p>
        <h1 class="title">
          Two ways<br />
          to <em>begin.</em>
        </h1>
        <p class="lead">
          Either bring your own projects and tasks, or fill the workspace
          with a real public GitHub repository. You can switch later
          from Settings.
        </p>
      </header>

      <div class="cards page-enter">
        <article class="card" [class.card--busy]="busy() === 'scratch'">
          <header class="card__top">
            <span class="card__num">A</span>
            <span class="card__tag">Empty canvas</span>
          </header>
          <h2 class="card__title">Start <em>from scratch.</em></h2>
          <p class="card__lead">
            We'll seed a couple of projects and tasks so the dashboard
            isn't empty on first paint. Create, edit and delete with full
            CRUD in the UI.
          </p>
          <ul class="card__notes">
            <li>Full read &amp; write access</li>
            <li>Two starter projects</li>
            <li>Switch to sync later if you like</li>
          </ul>
          <button
            type="button"
            class="card__cta"
            [disabled]="busy() !== null"
            (click)="startScratch()"
          >
            @if (busy() === 'scratch') {
              <mat-spinner diameter="16" strokeWidth="2" />
            } @else {
              <mat-icon>arrow_forward</mat-icon>
            }
            <span>Use this</span>
          </button>
        </article>

        <article class="card card--accent" [class.card--busy]="busy() === 'github'">
          <header class="card__top">
            <span class="card__num">B</span>
            <span class="card__tag">From GitHub</span>
          </header>
          <h2 class="card__title">Pull a <em>public repo.</em></h2>
          <p class="card__lead">
            Issues and pull requests sync as tasks. The UI becomes
            read-only; sync runs on dashboard load when stale, and you
            can refresh on demand from the toolbar.
          </p>
          <label class="card__field">
            <span class="card__field-label">Owner / repository</span>
            <input
              class="card__input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="microsoft/vscode"
              [(ngModel)]="repoInput"
              [disabled]="busy() !== null"
            />
          </label>
          @if (error(); as err) {
            <p class="card__error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ err }}</span>
            </p>
          }
          <button
            type="button"
            class="card__cta card__cta--accent"
            [disabled]="busy() !== null || !repoInput.trim()"
            (click)="startSync()"
          >
            @if (busy() === 'github') {
              <mat-spinner diameter="16" strokeWidth="2" />
            } @else {
              <mat-icon>cloud_sync</mat-icon>
            }
            <span>Validate &amp; sync</span>
          </button>
        </article>
      </div>

      <footer class="hint page-enter">
        <span class="eyebrow">Tip</span>
        <p>
          Public repos only. Switching modes from Settings will reset
          the workspace.
        </p>
      </footer>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }

    .page {
      min-height: 100vh;
      max-width: 76rem;
      margin: 0 auto;
      padding: clamp(3rem, 8vw, 6rem) clamp(1.5rem, 4vw, 4rem) 4rem;
      display: flex;
      flex-direction: column;
      gap: clamp(2.5rem, 5vw, 4rem);
      isolation: isolate;
    }

    /* Subtle backdrop glow */
    .page::before {
      content: '';
      position: fixed;
      inset: -6rem auto auto -6rem;
      width: 40rem;
      height: 40rem;
      background: radial-gradient(
        circle,
        rgba(212, 255, 58, 0.1),
        transparent 60%
      );
      filter: blur(20px);
      z-index: -1;
      pointer-events: none;
    }

    /* Header */
    .header {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      max-width: 48rem;
    }

    .title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.5rem, 6vw, 4.5rem);
      line-height: 0.98;
      letter-spacing: -0.04em;
      color: var(--cream);
      margin: 0;
    }

    .title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 90, 'wght' 400;
      padding-right: 0.18em;
      color: var(--accent);
    }

    .lead {
      font-size: 1.0625rem;
      line-height: 1.55;
      color: var(--cream-muted);
      max-width: 36rem;
    }

    /* Cards */
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 1.25rem;
    }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      padding: 2rem;
      background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.025),
          rgba(255, 255, 255, 0)
        ),
        var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-lg);
      transition: border-color var(--d-3) var(--ease-out),
        transform var(--d-3) var(--ease-out);
    }

    .card:hover {
      transform: translateY(-2px);
      border-color: var(--ink-border);
    }

    .card--accent {
      background: linear-gradient(
          180deg,
          rgba(212, 255, 58, 0.04),
          rgba(212, 255, 58, 0)
        ),
        var(--ink-surface);
    }

    .card--accent:hover {
      border-color: var(--accent-border);
    }

    .card--busy {
      opacity: 0.7;
      pointer-events: none;
    }

    .card__top {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .card__num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      border: 1px solid var(--ink-border);
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 400;
      font-size: 1rem;
      color: var(--cream);
    }

    .card--accent .card__num {
      border-color: var(--accent-border);
      color: var(--accent);
    }

    .card__tag {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .card--accent .card__tag {
      color: var(--accent);
    }

    .card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 96, 'SOFT' 30, 'wght' 400;
      font-size: clamp(1.5rem, 3vw, 2rem);
      line-height: 1.05;
      letter-spacing: -0.025em;
      color: var(--cream);
      margin: 0;
    }

    .card__title em {
      font-style: italic;
      font-variation-settings: 'opsz' 96, 'SOFT' 80, 'wght' 400;
      color: var(--cream);
      padding-right: 0.18em;
    }

    .card--accent .card__title em {
      color: var(--accent);
    }

    .card__lead {
      color: var(--cream-muted);
      line-height: 1.55;
    }

    .card__notes {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card__notes li {
      position: relative;
      padding-left: 1.25rem;
      color: var(--cream-muted);
      font-size: var(--text-small);
    }

    .card__notes li::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0.55rem;
      width: 0.5rem;
      height: 1px;
      background: var(--cream-dim);
    }

    /* Field */
    .card__field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .card__field-label {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .card__input {
      height: 2.75rem;
      padding: 0 0.875rem;
      background: var(--ink-bg);
      color: var(--cream);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: 0.9375rem;
      letter-spacing: -0.005em;
      transition: border-color var(--d-1) var(--ease-out),
        background var(--d-1) var(--ease-out);
    }

    .card__input::placeholder {
      color: var(--cream-dim);
    }

    .card__input:focus {
      outline: none;
      border-color: var(--accent);
      background: var(--ink-elevated);
    }

    /* Error */
    .card__error {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.625rem 0.75rem;
      background: var(--rose-soft);
      color: var(--rose);
      border: 1px solid rgba(251, 113, 133, 0.25);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--text-small);
      line-height: 1.4;
    }

    .card__error mat-icon {
      flex-shrink: 0;
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-top: 1px;
    }

    /* CTA — text + icon, edge-aligned */
    .card__cta {
      display: inline-flex;
      align-items: center;
      gap: 0.625rem;
      align-self: flex-start;
      height: 2.75rem;
      padding: 0 1.25rem;
      background: transparent;
      color: var(--cream);
      border: 1px solid var(--cream);
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans);
      font-size: var(--text-body);
      font-weight: 600;
      letter-spacing: -0.005em;
      margin-top: auto;
      transition: background var(--d-1) var(--ease-out),
        color var(--d-1) var(--ease-out),
        transform var(--d-1) var(--ease-out);
    }

    .card__cta:hover:not([disabled]) {
      background: var(--cream);
      color: var(--ink-bg);
      transform: translateY(-1px);
    }

    .card__cta--accent {
      background: var(--accent);
      color: var(--ink-bg);
      border-color: var(--accent);
      box-shadow: 0 10px 30px -10px rgba(212, 255, 58, 0.3);
    }

    .card__cta--accent:hover:not([disabled]) {
      background: var(--accent);
      color: var(--ink-bg);
      transform: translateY(-1px);
      box-shadow: 0 14px 36px -10px rgba(212, 255, 58, 0.5);
    }

    .card__cta[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .card__cta mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .card__cta .mat-mdc-progress-spinner {
      --mat-progress-spinner-active-indicator-color: currentColor;
    }

    /* Hint footer */
    .hint {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      padding-top: 2rem;
      border-top: 1px solid var(--ink-border-soft);
      color: var(--cream-dim);
    }

    .hint .eyebrow {
      color: var(--accent);
      flex-shrink: 0;
    }

    .hint p {
      max-width: 40rem;
      font-size: var(--text-small);
    }
  `,
})
export class Setup {
  private readonly appConfig = inject(AppConfigService);
  private readonly data = inject(DataService);
  private readonly sync = inject(GithubSyncService);
  private readonly router = inject(Router);

  protected repoInput = '';
  protected readonly busy = signal<'scratch' | 'github' | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async startScratch(): Promise<void> {
    this.busy.set('scratch');
    this.error.set(null);
    try {
      await this.appConfig.setMode('scratch');
      await this.seedDemoData();
      await this.router.navigate(['/']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }

  protected async startSync(): Promise<void> {
    const repo = this.repoInput.trim();
    if (!repo) return;
    this.busy.set('github');
    this.error.set(null);
    try {
      const canonical = await this.sync.validateRepo(repo);
      if (!canonical) {
        this.error.set(
          'Could not find that public repository. Use the "owner/name" format.'
        );
        return;
      }
      await this.appConfig.setMode('github', canonical);
      await this.sync.syncNow();
      await this.router.navigate(['/']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(null);
    }
  }

  private async seedDemoData(): Promise<void> {
    const website = await this.data.createProject({
      name: 'Website redesign',
      description: 'Refresh the marketing site and CMS.',
      created_at: new Date(),
    });
    const mobile = await this.data.createProject({
      name: 'Mobile launch',
      description: 'Ship v1 of the mobile companion.',
      created_at: new Date(),
    });
    const now = new Date();
    await this.data.createTask({
      title: 'Audit current pages',
      type: 'issue',
      status: 'in_progress',
      priority: 'high',
      created_at: now,
      updated_at: now,
      project: { id: website.id },
    });
    await this.data.createTask({
      title: 'Pick a design system',
      type: 'issue',
      status: 'open',
      priority: 'medium',
      created_at: now,
      updated_at: now,
      project: { id: website.id },
    });
    await this.data.createTask({
      title: 'Beta TestFlight build',
      type: 'issue',
      status: 'open',
      priority: 'high',
      created_at: now,
      updated_at: now,
      project: { id: mobile.id },
    });
  }
}
