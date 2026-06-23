# Power BI Fixer

<table>
<tr>
<td>

### 🙏 Credits & Thanks

**This tool would not exist without two people:**

- **[Michael Kovalsky](https://www.linkedin.com/in/michaelkovalsky/)** — for showing me that
  something like this is even *possible* with Rayfin. The spark for the whole
  project.
- **[Lukasz Obst](https://www.linkedin.com/in/lukasz-obst-3672083a2/)** — with
  whom I started this tool. **Whenever you see AI infused into PBI Fixer, it is
  most likely thanks to him.**

Thank you both. 🚀

</td>
</tr>
</table>

A Fabric-authenticated React + Vite app that **inspects, edits, and fixes Power BI
semantic models and reports** directly in the browser. It reads model and report
definitions through a server-side Fabric **User Data Function** proxy, runs a
library of Best Practice Analyzer (BPA) rules, and writes the changes back as
TMDL / PBIR — all without leaving the tab.

> 🌐 **Website:** [kornalexander.github.io/pbi_fixer/app.html](https://kornalexander.github.io/pbi_fixer/app.html)
> — the landing page for this Fabric App edition. The companion
> [Notebook edition](https://kornalexander.github.io/pbi_fixer/) (one line of
> Python in a Fabric Notebook) is linked from there too.

> 🆕 **This Fabric App edition supersedes the original Semantic Link Labs
> notebook solution of PBI Fixer.** Everything the notebook does — all **12 tabs
> and 50+ fixers** — is here too, now running in the browser and shared across
> your whole team, plus a full report layer, AI-assisted cleanup, Team
> Best-Practice Guidelines, and one-click workspace automation the notebook never
> had. The Semantic Link Labs notebook remains available as the lightweight,
> single-user option, but the Fabric App is the way forward.

> Built on [Rayfin](../../README.md) — brokered Fabric auth + static hosting, so
> the whole thing runs as a single Fabric app item with a Python backend.

> ⭐ marks my top picks. This is not an exhaustive list of functionality — you
> will find other hidden gems.
>
> ⚠️ The application is currently in **Beta** — use at your own risk.

---

## Why this exists

If you maintain enterprise semantic models, you already know the workflow:
install a desktop model editor, connect with XMLA, click through dialogs, export
scripts, hope the diff is clean. Power BI Fixer takes a different angle — it is a
**browser-based modelling workbench** that needs nothing installed locally and
runs on top of your existing Fabric capacity.

It is built to be a genuine, everyday alternative to the established desktop
model editors:

- It **covers the core model-editing surface** people rely on from the free
  desktop editors — explore and edit tables, columns, measures, relationships,
  display folders, descriptions, perspectives, field parameters, and the raw
  TMDL.
- It **adds things you will not find even in the paid desktop tooling** — a full
  **report layer** (PBIR explorer, diff, and one-click report fixes), a **free
  IBCS-compliant custom visual**, and **AI-assisted cleanup** for translations,
  descriptions, and display-folder organisation.

No license server, no install footprint, no XMLA endpoint plumbing — just sign
in with your Fabric identity and start working.

---

## Features

### Semantic model editing

Edit your tabular model with full access to all properties — and a lot more.

- **Edit**
  - ⭐ Edit all properties — Display Folders, Descriptions, Field Parameters, Perspectives, Translations
  - DAX Formatter
  - Preview data
  - Model Adder — calc groups, tables, info views
  - Model Diagram — live ER diagram with layout, zoom, hidden-object toggles
  - Perspective Editor
- **Clean up**
  - Unused Cleanup — remove unreferenced columns / measures
  - Metric View Migration — Databricks Unity Catalog metric view (YAML) → Direct Lake semantic model
- **Analyse**
  - Model BPA — Best Practice Analyzer and fixer with severity grouping + batch one-click fixes
  - Memory Analyzer — column / table size + cardinality insights to shrink models
  - Diff preview — every fix shows the exact TMDL / PBIR change before it is written
- **Refresh**
  - Refresh Tools — whole model, individual tables, or all models
  - ⭐ Pre-Warm Direct Lake Caching — warm caches for faster queries
- **AI** *(once-off GitHub device-flow auth, runs on your own Copilot subscription)*
  - ⭐ Translations — culture translations for captions and descriptions
  - ⭐ Descriptions — consistent object descriptions across the model
  - ⭐ Display-Folder Organisation — propose a clean, consistent folder structure
- **Safety**
  - History & Undo — every write-back tracked and reversible

### Report editing

Edit and extend your report — fix, prototype, and document.

- **Explore**
  - ⭐ PBIR View — browse and edit the report definition (tree, source / diff, pop-out editor)
  - Reverse / Forward Prototype — scaffold and round-trip report layouts
- **Fix**
  - IBCS rules — bring report visuals in line with IBCS notation standards
  - ⭐ Add free IBCS custom visual — notation-correct charts, no marketplace purchase
  - Report BPA — report-layer best-practice findings
- **Add Page**
  - ⭐ Whole Model Documentation — generate a documentation page
  - ⭐ Landing Page — AI-generated landing page

### Automation & ops

One-click deploy for:

- ⭐ Sempy Runner and Builder
- ⭐ **Workspace Editor** — reorganise workspace items into folders with AI, mass-delete items
- ⭐ Jumpstart Catalog
- ⭐ Awesome Rayfin Apps Catalog
- Workspace Monitoring

### Team guidelines

- ⭐ **Power BI Best-Practice Guidelines & Survey** — a guided questionnaire
  captures your team's Power BI conventions, renders them as an in-app Guidelines
  view, and syncs to OneLake (`pbi-fixer-guidelines-conventions.json`) so the
  whole team shares one source of truth.

---

## Screenshots

**The app shell** — model and report tooling, Fluent UI, light/dark themes:

![Power BI Fixer app shell](docs/screenshots/app-shell.png)

**Model Explorer** — browse and edit a model's tables, columns, and measures,
with inline TMDL, a live properties pane, and one-click organise actions:

![Model Explorer](docs/screenshots/model-explorer.png)

**Model BPA** — the Best Practice Analyzer with per-rule findings, severity
chips, and **one-click fixes** for the findings the engine can repair
automatically:

![Model Best Practice Analyzer](docs/screenshots/model-bpa.png)

**Memory Analyzer** — column / table size and cardinality insights with
auto-fixable findings to shrink the model:

![Memory Analyzer](docs/screenshots/memory-analyzer.png)

**Model Diagram** — a live ER diagram of tables and relationships with layout,
zoom, and hidden-object toggles:

![Model relationship diagram](docs/screenshots/model-diagram.png)

**Report Explorer** — the PBIR tree with a live / wireframe report preview and an
editable properties pane:

![Report Explorer](docs/screenshots/report-explorer.png)

**IBCS builder** — add a marked calendar table and generate previous-year &
variance measures (PY, Δ PY, Δ% PY) that drive IBCS variance charts:

![IBCS builder](docs/screenshots/ibcs-builder.png)

**AI Translations** — generate culture translations for the whole model with
GitHub Copilot via a one-time device-flow sign-in:

![AI-assisted translations](docs/screenshots/ai-translations.png)

> Screenshots use sample semantic models and reports.

---

## Architecture

```text
┌─────────────────────────┐     brokered auth      ┌──────────────────────────┐
│  React + Vite SPA        │ ─────────────────────► │  Fabric (this app item)  │
│  (Fluent UI v9)          │                        │  static hosting + auth   │
│  src/                    │                        └──────────────────────────┘
│   ├─ explorer/ pages/    │     HTTPS invoke
│   ├─ components/         │ ─────────────────────► ┌──────────────────────────┐
│   └─ services/  ────────────── udfClient ──────►  │  Python User Data Funcs   │
│        config/udfConfig  │                        │  fabric-udf/function_app  │
└─────────────────────────┘                        │   list_workspaces         │
                                                    │   list_reports            │
                                                    │   apply_report_fixer      │
                                                    │   fabric_proxy (generic)  │
                                                    │   github_device_*/translate│
                                                    └──────────────────────────┘
```

- The SPA never calls Fabric REST directly — all calls go through the Python
  **`fabric_proxy`** UDF, which holds the on-behalf-of token server-side
  (avoids browser CORS and keeps tokens out of the client).
- Config is fully **env-driven** ([src/config/udfConfig.ts](src/config/udfConfig.ts)).
  No tenant / workspace / capacity ids are hardcoded in source.

---

## Getting started

### Prerequisites

- A **Microsoft Fabric** workspace on a capacity that supports User Data Functions.
- **Node.js 20+** and the repo's package manager.
- An **Entra app registration** (SPA) for brokered auth.
- _(Optional)_ A **GitHub Copilot** subscription for the AI cleanup tools.

### Configuration

All runtime config comes from Vite env vars. Copy `.env.example` to `.env` and
fill in your values; `rayfin env --framework vite` generates `.env.local`
(workspace / item / tenant ids + Rayfin publishable key) automatically.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FABRIC_TENANT_ID` | yes (from `.env.local`) | Entra tenant id (auth authority). |
| `VITE_FABRIC_SPA_CLIENT_ID` | yes | Entra SPA app-registration client id. |
| `VITE_UDF_LIST_WORKSPACES_URL` | yes | Public URL of the `list_workspaces` UDF. |
| `VITE_UDF_LIST_REPORTS_URL` | yes | Public URL of the `list_reports` UDF. |
| `VITE_UDF_APPLY_FIXER_URL` | yes | Public URL of the `apply_report_fixer` UDF. |
| `VITE_UDF_FABRIC_PROXY_URL` | no | Override for the generic proxy (derived by default). |
| `VITE_DEMO_WORKSPACE_ID` | no | Source workspace for the monitoring report clone shortcut. |

> The app derives the remaining UDF endpoints (`fabric_proxy`, `github_device_start`,
> `github_device_poll`, `github_translate`, `github_comment_m`) from
> `VITE_UDF_LIST_WORKSPACES_URL`, so you only set the three core URLs.

### Deploy your own

1. **Publish the backend functions.** Publish the Python UDF in
   [fabric-udf/](fabric-udf/function_app.py) as a **User Data Functions** item
   in your Fabric workspace (it exposes `list_workspaces`, `list_reports`,
   `apply_report_fixer`, `fabric_proxy`, and the GitHub device-flow / translate
   functions). Note the item's invoke base URL.

2. **Configure env.** Copy `.env.example` → `.env` and set
   `VITE_FABRIC_SPA_CLIENT_ID` plus the three `VITE_UDF_*_URL` values to point at
   your published UDF item.

3. **Deploy the app to Fabric:**

   ```bash
   npm run build:fabric
   npm run rayfin:up        # or: rayfin up --workspace-id <your-ws> --tenant <your-tenant> -y
   ```

   `rayfin up` provisions the app item, generates `.env.local`, and publishes the
   static bundle. The command prints the live `*.webapp.fabricapps.net` URL.

4. **(Optional) GitHub Copilot AI tools.** The Translations / Descriptions tools
   use a GitHub **device flow**: open the tool, click **Sign in with GitHub**,
   enter the shown code at <https://github.com/login/device>, and authorize. A
   Copilot subscription is required for the AI features.

### Local development

```bash
npm run dev      # rayfin env + Vite dev server at http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) to view the app. `npm run dev`
deploys the app services to Fabric (for brokered auth) and starts a local Vite
server pointed at them.

---

## Project structure

```text
├── fabric-udf/
│   ├── function_app.py     # Python User Data Functions (proxy + fixers + GitHub flow)
│   └── requirements.txt
├── rayfin/
│   └── rayfin.yml          # Fabric service config (auth + static hosting)
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes + auth gate
│   ├── config/
│   │   └── udfConfig.ts     # Env-driven UDF endpoint config
│   ├── explorer/           # Model/report explorer UI + theme
│   ├── components/         # Tool panels (BPA, Translations, Monitoring, …)
│   ├── pages/              # Top-level routed pages
│   ├── services/           # udfClient, BPA rule engines, TMDL/PBIR helpers
│   └── hooks/              # Auth context + shared hooks
├── docs/screenshots/       # README screenshots
├── .env.example            # Copy to .env and fill in
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app services to Fabric and start the local dev server |
| `npm run build:fabric` | Build for Fabric deployment (`tsc -b && vite build`) |
| `npm run rayfin:up` | Deploy the app to Fabric (no local dev server) |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |

---

## License

[MIT](LICENSE) © Microsoft Corporation.
