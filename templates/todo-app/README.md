# Todo App

Full-stack todo app with categories, auth, and Docker local development built on Rayfin.

## Getting started

```bash
# Install dependencies
npm install

# Deploy app to Fabric and start the local dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

### Service modes

The app supports two service modes:

| Mode | Command | Description |
|------|---------|-------------|
| **Rayfin** | `npm run dev:rayfin` | Connects to the Rayfin backend API (default) |
| **Mock** | `npm run dev:mock` | Uses localStorage — no backend required |

Toggle between modes with `npm run toggle-mode [mock\|rayfin]`.

### Docker local development (preview)

Run the full Rayfin backend locally via Docker containers:

```bash
# One-time setup: authenticate to GitHub Container Registry
gh auth login
gh auth refresh --scopes read:packages
gh auth token | docker login ghcr.io -u $(gh api user -q .login) --password-stdin

# Start the Docker local dev environment
npm run dev:local
```

> **Note:** `dev:local` automatically checks that Docker is running and that you
> are authenticated to `ghcr.io`. See [GHCR authentication](#ghcr-authentication)
> below for alternative setup methods.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml          # Fabric service configuration
│   ├── data/
│   │   ├── Todo.ts         # Todo entity with RLS policy
│   │   ├── Category.ts     # Category entity with relationships
│   │   └── schema.ts       # Data schema type definition
│   └── storage/
│       ├── ProfileImage.ts # Blob storage entity
│       └── schema.ts       # Storage schema type definition
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── models/             # TypeScript type definitions
│   ├── components/         # Shared UI components (auth, todos, categories)
│   ├── hooks/              # React hooks (useAuth, useTodos, useCategories, …)
│   ├── pages/              # Page components (Dashboard, AuthCallback, …)
│   ├── services/
│   │   ├── interfaces/     # Service contracts (ITodoService, IAuthService, …)
│   │   ├── mock/           # localStorage-backed implementations
│   │   └── rayfin/         # Rayfin API-backed implementations
│   └── utils/              # Environment helpers
├── scripts/
│   ├── check-docker-ghcr.mjs    # GHCR auth pre-flight check
│   ├── toggle-service-mode.js   # Switch between mock and rayfin modes
│   └── run-rayfin-db.js         # Apply database schema changes
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run dev:mock` | Start in mock mode (localStorage, no backend) |
| `npm run dev:rayfin` | Apply DB schema and start in Rayfin mode |
| `npm run dev:local` | Start Docker local dev environment (preview) |
| `npm run dev:local:db` | Apply database schema to local Docker environment |
| `npm run dev:local:status` | Show status of Docker local dev containers |
| `npm run dev:local:stop` | Stop Docker local dev containers |
| `npm run dev:local:purge` | Stop, remove containers, and delete volumes |
| `npm run check:ghcr` | Check Docker and GHCR authentication |
| `npm run toggle-mode` | Toggle between mock and rayfin service modes |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |

## GHCR authentication

The Docker local dev environment pulls the Rayfin host container from
`ghcr.io`. You need `read:packages` access to the GitHub organization.

**Option 1 — GitHub CLI (recommended):**

```bash
gh auth login
gh auth refresh --scopes read:packages
gh auth token | docker login ghcr.io -u $(gh api user -q .login) --password-stdin
```

**Option 2 — Personal Access Token:**

Create a PAT with `read:packages` scope at <https://github.com/settings/tokens>,
then:

```bash
echo <YOUR_PAT> | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
```
