import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import type { ChartConfiguration } from 'chart.js';

import type { Project, Task } from '../../../../rayfin/data/schema';
import { AppConfigService } from '../../services/app-config.service';
import { DataService } from '../../services/data.service';
import { GithubSyncService } from '../../services/github-sync.service';

@Component({
  selector: 'app-dashboard',
  imports: [
    BaseChartDirective,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    TitleCasePipe,
  ],
  template: `
    <div class="dashboard page-enter">
      <header class="hero">
        <p class="eyebrow">Overview</p>
        <h1 class="hero__title">
          {{ greeting }}.<br />
          <em>{{ totalLabel() }}</em>
        </h1>
        <p class="hero__lead">
          @if (appConfig.isSynced()) {
            Synced from
            <span class="mono">{{ appConfig.repo() }}</span> ·
            {{ syncMeta() }}
          } @else {
            A snapshot of work in progress across your projects.
          }
        </p>
      </header>

      @if (loading()) {
        <section class="kpis">
          <div class="skeleton skeleton--card kpi--feature"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
          <div class="skeleton skeleton--card"></div>
        </section>
        <section class="split">
          <div class="skeleton skeleton--card" style="height: 18rem"></div>
          <div class="skeleton skeleton--card" style="height: 18rem"></div>
        </section>
      } @else {
        <!-- KPI grid -->
        <section class="kpis">
          <article class="kpi kpi--feature">
            <span class="kpi__label">Total</span>
            <div class="kpi__value">
              <span class="kpi__num">{{ tasks().length }}</span>
              <span class="kpi__suffix">items</span>
            </div>
            <div class="kpi__bar">
              <span
                class="kpi__bar-seg kpi__bar-seg--open"
                [style.flexGrow]="kpis().open"
              ></span>
              <span
                class="kpi__bar-seg kpi__bar-seg--in_progress"
                [style.flexGrow]="kpis().in_progress"
              ></span>
              <span
                class="kpi__bar-seg kpi__bar-seg--closed"
                [style.flexGrow]="kpis().closed"
              ></span>
            </div>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--open"></span>
              Open
            </span>
            <span class="kpi__num">{{ kpis().open }}</span>
            <span class="kpi__delta">{{ pct(kpis().open) }}%</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--in_progress"></span>
              In progress
            </span>
            <span class="kpi__num">{{ kpis().in_progress }}</span>
            <span class="kpi__delta">{{ pct(kpis().in_progress) }}%</span>
          </article>

          <article class="kpi">
            <span class="kpi__label">
              <span class="dot dot--closed"></span>
              Closed
            </span>
            <span class="kpi__num">{{ kpis().closed }}</span>
            <span class="kpi__delta">{{ pct(kpis().closed) }}%</span>
          </article>
        </section>

        <!-- Chart + recent -->
        <section class="split">
          <article class="panel panel--chart">
            <header class="panel__head">
              <h3 class="panel__title">Tasks by status</h3>
              <span class="eyebrow">Last {{ tasks().length }} items</span>
            </header>
            <div class="chart-wrap">
              <canvas
                baseChart
                [data]="chartData"
                [options]="chartOptions"
                type="bar"
              ></canvas>
            </div>
          </article>

          <article class="panel">
            <header class="panel__head">
              <h3 class="panel__title">Recent activity</h3>
              <a class="panel__link" routerLink="/tasks">
                View all
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            @if (recent().length === 0) {
              <p class="panel__empty">No tasks yet — they'll appear here.</p>
            } @else {
              <ol class="feed">
                @for (t of recent(); track t.id) {
                  <li class="feed__item">
                    <span class="dot" [class]="'dot--' + t.status"></span>
                    <a class="feed__title" [routerLink]="['/tasks', t.id]">
                      {{ t.title }}
                    </a>
                    <span class="feed__meta">
                      <span class="pill pill--{{ statusPill(t.status) }}">
                        {{ t.status | titlecase }}
                      </span>
                      @if (t.updated_at) {
                        <span class="feed__time">{{ relative(t.updated_at) }}</span>
                      }
                    </span>
                  </li>
                }
              </ol>
            }
          </article>
        </section>

        <!-- Projects strip -->
        @if (projects().length > 0) {
          <section class="strip">
            <header class="strip__head">
              <h3 class="panel__title">Projects</h3>
              <a class="panel__link" routerLink="/projects">
                Browse projects
                <mat-icon>arrow_forward</mat-icon>
              </a>
            </header>
            <div class="strip__grid">
              @for (p of projects().slice(0, 4); track p.id) {
                <a class="proj-card" [routerLink]="['/projects', p.id]">
                  <span class="eyebrow">{{ taskCount(p.id) }} tasks</span>
                  <h4 class="proj-card__title">{{ p.name }}</h4>
                  @if (p.description) {
                    <p class="proj-card__desc">{{ p.description }}</p>
                  }
                  <span class="proj-card__arrow">
                    <mat-icon>north_east</mat-icon>
                  </span>
                </a>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .dashboard {
      display: flex;
      flex-direction: column;
      gap: clamp(2rem, 4vw, 3.5rem);
    }

    /* ── Hero ──────────────────────────────────────────────────── */
    .hero {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-width: 48rem;
    }

    .hero__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2rem, 4.5vw, 3.25rem);
      line-height: 1;
      letter-spacing: -0.035em;
      color: var(--cream);
      margin: 0;
    }

    .hero__title em {
      font-style: italic;
      font-variation-settings: 'opsz' 144, 'SOFT' 90, 'wght' 400;
      padding-right: 0.18em;
      color: var(--accent);
    }

    .hero__lead {
      color: var(--cream-muted);
      font-size: var(--text-body);
      max-width: 36rem;
    }

    .hero__lead .mono {
      font-family: var(--font-mono);
      color: var(--cream);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 4rem 0;
    }

    /* ── KPI cards ─────────────────────────────────────────────── */
    .kpis {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: 1rem;
    }

    @media (max-width: 64rem) {
      .kpis { grid-template-columns: 1fr 1fr; }
    }

    @media (max-width: 28rem) {
      .kpis { grid-template-columns: 1fr; }
    }

    .kpi {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
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
      transition: border-color var(--d-2) var(--ease-out);
    }

    .kpi:hover {
      border-color: var(--accent-border);
    }

    .kpi__label {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .kpi__value {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }

    .kpi__num {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 144, 'SOFT' 30, 'wght' 400;
      font-size: clamp(2.75rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
      color: var(--cream);
    }

    .kpi__suffix {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--cream-dim);
    }

    .kpi__delta {
      font-family: var(--font-mono);
      font-size: var(--text-small);
      color: var(--cream-muted);
      margin-top: auto;
    }

    .kpi--feature .kpi__num {
      font-size: clamp(3.5rem, 6vw, 5.5rem);
    }

    .kpi--feature {
      grid-row: span 1;
    }

    .kpi__bar {
      display: flex;
      height: 0.375rem;
      border-radius: var(--radius-pill);
      overflow: hidden;
      background: var(--ink-elevated);
      margin-top: auto;
    }

    .kpi__bar-seg {
      flex-grow: 0;
      flex-basis: 0;
      transition: flex-grow var(--d-3) var(--ease-out);
    }

    .kpi__bar-seg--open {
      background: var(--emerald);
    }

    .kpi__bar-seg--in_progress {
      background: var(--amber);
    }

    .kpi__bar-seg--closed {
      background: var(--cream-dim);
    }

    /* ── Split: chart + recent ─────────────────────────────────── */
    .split {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: 1rem;
    }

    @media (max-width: 64rem) {
      .split { grid-template-columns: minmax(0, 1fr); }
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
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
    }

    .panel--chart .chart-wrap {
      flex: 1;
      min-height: 16rem;
      min-width: 0;
      position: relative;
    }

    .panel--chart .chart-wrap canvas {
      display: block;
      max-width: 100%;
    }

    .panel__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .panel__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.375rem;
      letter-spacing: -0.02em;
      color: var(--cream);
      margin: 0;
    }

    .panel__link {
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

    .panel__link:hover {
      color: var(--accent);
    }

    .panel__link mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: transform var(--d-1) var(--ease-out);
    }

    .panel__link:hover mat-icon {
      transform: translateX(2px);
    }

    .panel__empty {
      color: var(--cream-dim);
      padding: 1rem 0 0.5rem;
    }

    /* Feed (recent tasks) */
    .feed {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
    }

    .feed__item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 0;
      border-top: 1px solid var(--ink-border-soft);
    }

    .feed__item:first-child {
      border-top: none;
    }

    .feed__title {
      font-size: var(--text-body);
      color: var(--cream);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .feed__title:hover {
      color: var(--accent);
    }

    .feed__meta {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }

    .feed__time {
      font-family: var(--font-mono);
      font-size: var(--text-caption);
      color: var(--cream-dim);
    }

    /* ── Projects strip ────────────────────────────────────────── */
    .strip {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .strip__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .strip__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
      gap: 1rem;
    }

    .proj-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      padding: 1.25rem;
      background: var(--ink-surface);
      border: 1px solid var(--ink-border);
      border-radius: var(--radius-md);
      color: var(--cream);
      min-height: 8rem;
      transition: border-color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out),
        background var(--d-2) var(--ease-out);
    }

    .proj-card:hover {
      border-color: var(--accent-border);
      transform: translateY(-2px);
      background: var(--ink-elevated);
      color: var(--cream);
    }

    .proj-card__title {
      font-family: var(--font-display);
      font-variation-settings: 'opsz' 72, 'SOFT' 30, 'wght' 500;
      font-size: 1.25rem;
      letter-spacing: -0.015em;
      color: var(--cream);
      margin: 0;
    }

    .proj-card__desc {
      font-size: var(--text-small);
      color: var(--cream-muted);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .proj-card__arrow {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      color: var(--cream-dim);
      transition: color var(--d-2) var(--ease-out),
        transform var(--d-2) var(--ease-out);
    }

    .proj-card:hover .proj-card__arrow {
      color: var(--accent);
      transform: translate(2px, -2px);
    }

    .proj-card__arrow mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
  `,
})
export class Dashboard implements OnInit {
  private readonly data = inject(DataService);
  private readonly sync = inject(GithubSyncService);
  protected readonly appConfig = inject(AppConfigService);

  protected readonly tasks = signal<Task[]>([]);
  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly greeting = greet();

  protected readonly kpis = computed(() => {
    const counts = { open: 0, in_progress: 0, closed: 0 };
    for (const t of this.tasks()) counts[t.status]++;
    return counts;
  });

  protected readonly recent = computed(() =>
    [...this.tasks()]
      .sort(
        (a, b) =>
          (b.updated_at ? new Date(b.updated_at).getTime() : 0) -
          (a.updated_at ? new Date(a.updated_at).getTime() : 0)
      )
      .slice(0, 6)
  );

  protected chartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1d1a26',
        borderColor: '#2a2532',
        borderWidth: 1,
        titleColor: '#f4ecdf',
        bodyColor: '#a39db1',
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        padding: 10,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#a39db1',
          font: { family: 'JetBrains Mono', size: 10 },
        },
        border: { color: '#2a2532' },
      },
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0,
          color: '#a39db1',
          font: { family: 'JetBrains Mono', size: 10 },
        },
        grid: { color: 'rgba(255,255,255,0.03)' },
        border: { color: '#2a2532' },
      },
    },
  };

  protected chartData: ChartConfiguration<'bar'>['data'] = {
    labels: ['Open', 'In progress', 'Closed'],
    datasets: [
      {
        data: [0, 0, 0],
        backgroundColor: ['#34d399', '#fbbf24', '#6b6677'],
        borderRadius: 4,
        borderSkipped: false,
        barThickness: 32,
      },
    ],
  };

  async ngOnInit(): Promise<void> {
    void this.sync.maybeAutoSync().then(async (res) => {
      if (res) await this.refresh();
    });
    await this.refresh();
  }

  protected pct(n: number): number {
    const total = this.tasks().length;
    if (!total) return 0;
    return Math.round((n / total) * 100);
  }

  protected statusPill(status: string): string {
    if (status === 'open') return 'emerald';
    if (status === 'in_progress') return 'amber';
    return '';
  }

  protected totalLabel(): string {
    const t = this.tasks().length;
    if (t === 0) return 'Nothing on the board yet.';
    if (t === 1) return 'One item in flight.';
    return `${t} items in flight.`;
  }

  protected syncMeta(): string {
    const last = this.appConfig.lastSyncedAt();
    if (!last) return 'never synced';
    return `last synced ${this.relative(last)}`;
  }

  protected relative(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  protected taskCount(projectId: string): number {
    let n = 0;
    for (const t of this.tasks()) if (t.project?.id === projectId) n++;
    return n;
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
      const c = this.kpis();
      this.chartData = {
        ...this.chartData,
        datasets: [
          {
            ...this.chartData.datasets[0],
            data: [c.open, c.in_progress, c.closed],
          },
        ],
      };
    } finally {
      this.loading.set(false);
    }
  }
}

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
