# Atelier — Angular Dashboard

A customer-facing dashboard built on Rayfin, with an "Editorial Ink"
design system: dark ink palette, acid-lime accent, Fraunces display
serif + DM Sans + JetBrains Mono. Collapsible left rail, sticky frosted
topbar, KPI grid, chart, and editorial-style list + detail views for
projects and tasks.

Two operating modes, picked on first launch:

| Mode | Data source | UI writes | Best for |
|---|---|---|---|
| **Scratch** | You create everything by hand. Seeded with a couple of demo projects. | All CRUD enabled. | Building your own app on top of the dashboard layout. |
| **GitHub-sync** | Issues + pull requests pulled from a public GitHub repo. | Read-only (UI affordances hidden). | Quickly trying the app against real-looking data. |

## Design system at a glance

- **Palette** — deep ink (`#0a0911`), cream text (`#f4ecdf`), one acid
  accent (`#d4ff3a`). All Material 3 tokens are remapped via CSS custom
  properties in `src/styles.scss`.
- **Type** — Fraunces (variable serif) for headings + numbers, DM Sans
  for UI, JetBrains Mono for captions / data / mono pills.
- **Components** — rounded pills, hairline borders, status dots with
  soft glow, page-enter staggered animation, glowing sync badge.

## Getting started

```bash
# Deploy to Fabric (or start the local backend) and start the Angular dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), sign in, and you'll land
on the **setup wizard** where you can pick the mode.

## Stack

- **Angular 21** standalone components, signals, lazy routes.
- **Angular Material 21** + **CDK** as the component foundation (with
  CSS custom-property overrides to keep Material out of the way visually).
- **chart.js** + **ng2-charts** for the dashboard chart.
- **Rayfin** for auth, the data backend, and the `RayfinClient` SDK.
- **uuid** (v5) for deterministic ids during GitHub sync.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml                 # Rayfin service config (auth + data)
│   └── data/
│       └── schema.ts              # Project, Task, AppConfig entities
├── src/
│   ├── main.ts                    # Bootstrap + Rayfin client init
│   ├── services/                  # Framework-agnostic Rayfin client + auth
│   ├── app/
│   │   ├── app.routes.ts          # Lazy routes (/auth, /setup, /, /projects, /tasks, /settings)
│   │   ├── auth.guard.ts          # Auth + no-auth route guards
│   │   ├── setup.guard.ts         # Routes user to /setup on first run
│   │   ├── shell/                 # Top toolbar + collapsible side nav
│   │   ├── services/
│   │   │   ├── data.service.ts    # Project + Task wrapper around the data client
│   │   │   ├── app-config.service.ts  # Singleton-row config + canWrite() signal
│   │   │   ├── github-sync.service.ts # GitHub REST fetch + idempotent upsert
│   │   │   ├── auth-state.ts      # Signal-based auth state
│   │   │   └── constants.ts       # APP_CONFIG_ID, TASK_NAMESPACE_UUID, etc.
│   │   └── pages/
│   │       ├── auth/              # Sign-in page
│   │       ├── setup/             # First-launch wizard
│   │       ├── dashboard/         # KPI cards + chart + recent tasks
│   │       ├── projects/          # Projects list + detail
│   │       ├── tasks/             # Tasks list + detail
│   │       └── settings/          # Current mode, manual sync, reset
└── package.json
```

## Modes in depth

### Scratch mode

Hand-managed CRUD via the UI. The setup wizard seeds two demo projects and a
few tasks so the dashboard isn't empty on first paint. Everything is editable.

### GitHub-sync mode

You give the wizard a public `owner/repo`. The app:

1. Validates the repo via an unauthenticated `GET /repos/:owner/:name`.
2. Pulls issues **and** pull requests via `GET /repos/:owner/:name/issues?state=all`
   (the issues endpoint includes PRs; we tag each row with `type: 'issue' | 'pr'`).
3. Upserts each item as a `Task`, using `uuidv5("${repo}#${number}")` as the
   row id. This makes sync idempotent and race-safe across tabs.
4. Updates `AppConfig.last_synced_at`.

A "Sync now" button is always available in the toolbar. The dashboard also
triggers an auto-sync when last sync is ≥ 24h old.

### Switching modes

Settings → **Reset to setup** wipes every project + task and returns you to
the wizard.

## Caveats — read this

- **Read-only in sync mode is UI-only.** The schema entities are annotated
  `@authenticated('*')`, so the backend still accepts mutations from anyone
  signed in. The dashboard simply hides create/edit/delete affordances and
  refuses to call them. This is template-level UX, not a security boundary.
  If you need true server-enforced read-only, you'll need a custom
  `@authenticated` policy.

- **Public repos only.** Browser-side personal access tokens leak into the SPA
  bundle and ship to every visitor. The cleaner alternative — moving sync into
  a Rayfin server function — depends on `rayfin functions`, which the Rayfin
  CLI currently marks as **preview / feature-gated**. We'll add PAT/private
  repo support server-side once that GA's.

- **GitHub API rate limit.** Unauthenticated GitHub REST allows 60 requests
  per hour per IP. Sync caps at 10 pages × 100 issues = 1000 items, so one
  full sync of a medium repo uses ~10 requests. Comfortably enough room for a
  daily sync of small/medium repos; not enough for hourly polling.

- **"Daily sync" is on-load, not scheduled.** Rayfin has no built-in
  scheduler. We re-sync when the dashboard loads if `last_synced_at` is older
  than 24h, plus a manual "Sync now" button. For true scheduled sync, a
  GitHub Actions workflow calling `npx rayfin ...` is the easiest path today.

- **`Task.labels_json` is a JSON string** (no array primitive in
  `@microsoft/rayfin-core` decorators). It's rendered as chips but **cannot
  be filtered server-side**. If you need that, add `Label` + `TaskLabel`
  entities and a join.

## Environment overrides

The setup wizard writes its choice to the `AppConfig` table. You can override
that at boot via `.env`:

```bash
# .env.local
VITE_SYNC_MODE=github            # 'scratch' | 'github'
VITE_GITHUB_REPO=microsoft/vscode
```

When `VITE_SYNC_MODE` is set, the wizard is skipped entirely.

## Scripts

```bash
npm run dev      # rayfin up + ng serve --port 5173
npm run build    # production bundle in ./dist/
npm run lint     # eslint
npm test         # karma + jasmine (set CHROME_BIN if needed)
```

## Notes

- Side-menu collapsed state persists in `localStorage` under
  `dashboard.sidenav.collapsed`.
- The singleton `AppConfig` row uses a hardcoded UUID
  (`00000000-0000-0000-0000-000000000001`); concurrent first-creates handle
  the conflict by refetching.
- Schema decorators are TC39 stage-3, so `tsconfig.json` enables
  `ESNext.Decorators` and leaves `experimentalDecorators` off.

## Useful links

- Rayfin docs: <https://aka.ms/rayfin/docs>
- Angular Material: <https://material.angular.dev>
- ng2-charts: <https://valor-software.com/ng2-charts/>
- GitHub REST issues endpoint: <https://docs.github.com/en/rest/issues/issues>
