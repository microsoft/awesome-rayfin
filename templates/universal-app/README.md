# Universal App

A lean React + Vite starter that **grows into whatever you ask for**. Instead of
committing you to an app shape up front, it ships a small "hello world" home page
plus a **capability router** the agent reads first — it picks the right Rayfin
services, installs the right npm modules, and activates the right skills for the
app you describe.

> Build your app, then deploy it to a Fabric workspace with `npm run rayfin:up`.
> For a quick look without a backend, run `npm run preview` to serve the home
> page locally (no backend, no sign-in).

## How it works

Describe what you want in plain English. The agent starts at the **capability
router** (`AGENTS.md` + `.agents/skills/capability-router/`), maps your request
to one or more **capability packs**, and only then pulls each one in:

| You ask for… | The router activates | Which brings in |
|---|---|---|
| Sign-in / accounts / per-user data | `authentication` | Wire the Fabric auth that already ships in `src/services/` |
| Data, records, CRUD, a database | `data-modeling` **+ `authentication`** | Entities + row-level security in `rayfin/data/`; auth wired in, since Rayfin data is always authenticated |
| Charts, dashboards, KPIs | `graphein-visuals` | Author Graphein specs, drop into `<Chart>` |
| Power BI / semantic-model analytics | `analytics` | One command — `npm run pack:add -- analytics` scaffolds the dashboard kit, DAX + headless preview, and a runnable demo |

Nothing heavy is loaded until it's needed — the base app stays small and fast.

## Getting started

Scaffold the template, then describe what you want to build to your coding agent:

```bash
npx @microsoft/rayfin-cli init my-app \
  -t microsoft/awesome-rayfin --template-name "Universal App"
cd my-app
npm install
```

`npm run preview` serves the home page locally with no backend. To deploy to
Fabric:

```bash
npm run rayfin:up
```

## Project structure

```text
├── AGENTS.md                       # Capability router — the agent reads this first
├── .agents/skills/                 # Capability packs (skills + on-demand assets)
│   ├── capability-router/          # Start-here orchestrator
│   ├── authentication/             # Turn on Fabric sign-in
│   ├── data-modeling/              # Entities + row-level security
│   ├── graphein-visuals/           # Charts as declarative specs
│   └── analytics/                  # Power BI semantic model + DAX dashboards
├── .mcp.json                       # Rayfin MCP server (version-locked docs)
├── manifest.json                   # Gallery metadata (services, tokens)
├── rayfin/
│   ├── rayfin.yml                  # Fabric service configuration
│   └── data/
│       └── schema.ts               # Empty data schema — the router fills this in
├── scripts/
│   ├── scaffold.mjs                # `npm run pack:add` — applies a pack manifest
│   └── scaffold.test.mjs           # Seeding-contract tests (Node's test runner)
├── src/
│   ├── main.tsx                    # Entry point (auth wired off; router turns it on)
│   ├── App.tsx                     # Routes (no auth gate by default)
│   ├── main.css                    # Tailwind theme
│   ├── components/
│   │   ├── Chart.tsx               # Declarative <Chart spec={…} /> — Graphein binding
│   │   └── useChart.ts             # Headless Graphein binding hook
│   ├── hooks/AuthContext.tsx       # React context wrapping the auth helpers
│   ├── pages/HomePage.tsx          # "Hello, World" landing page
│   └── services/                   # Fabric auth scaffolding (wired off until needed)
└── package.json
```

Authentication ships wired **off** so the static base previews with no backend.
It's wired in automatically as soon as your app **uses data** (Rayfin data is
always authenticated) or needs sign-in — a static page over public data stays
no-auth. See `.agents/skills/authentication/SKILL.md`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run preview` | Preview the home page locally — no backend, no deploy |
| `npm run dev` | Deploy the backend, then serve the app against it |
| `npm run pack:add -- <pack>` | Turn on a capability pack in one step (e.g. `analytics`) — see `.agents/skills/capability-router/pack-manifest.md` |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment (entrypoint for `rayfin up`) |
| `npm run lint` | Lint with ESLint |
| `npm test` | Run the scaffolder contract tests and the Vitest suite |
| `npm run rayfin:up` | Deploy the app to a Fabric test workspace |
