# [Experimental] Todo App w/ full local

> ⚠️ **This template uses experimental features.** Username/password authentication and Docker local hosting (`rayfin dev`) are not yet stable. APIs may change without notice.

End-to-end todo CRUD with username/password auth, a Rayfin data model, and Docker local development.
A working starter that exercises the full data path without Fabric — sign in, create todos, toggle them, delete them.

## Install this template

```bash
npm create @microsoft/rayfin -- -t https://github.com/microsoft/awesome-rayfin --template-name "[Experimental] Todo app with full local dev"
```

## Getting started

```bash
# Start the local Docker backend and dev server
npm run dev:local

# Apply database migrations (first time only)
npm run rayfin:db
```

Open [http://localhost:5173](http://localhost:5173) to view the app. Create an account with any email/password.

## Development modes

This template supports three development workflows:

### 1. Full local (`dev:local`) — recommended for offline/local work

Runs the entire Rayfin backend in Docker containers on your machine. No Fabric workspace needed.

```bash
npm run dev:local
```

This starts the Docker containers (`rayfin dev`), generates Vite env files, and launches the Vite dev server. Requires Docker Desktop and `gh` CLI authenticated to ghcr.io (the pre-flight script handles this automatically).

### 2. Fabric cloud (`dev`) — requires a deployed Fabric workspace

Deploys services to Fabric (`rayfin up`) and runs Vite locally against the cloud backend.

```bash
npm run dev
```

### 3. Deploy only (`up`) — deploy to Fabric without a local dev server

```bash
npm run up
```

### Passing options to `rayfin dev`

The `rayfin:dev` script wraps `rayfin dev` with the required feature flag. You can pass additional CLI options after `--`:

```bash
# Check status of local containers
npm run rayfin:dev -- status

# Apply database migrations
npm run rayfin:db

# Stop local containers (keeps data)
npm run dev:local:stop

# Remove local containers (keeps volumes/data)
npm run dev:local:down

# Purge local containers and volumes (full reset)
npm run dev:local:purge
```

### Feature flag: `RAYFIN_FEATURE_FLAGS=docker-local-dev`

Docker local hosting is gated behind the `docker-local-dev` feature flag. The `rayfin:dev` and `rayfin:db` scripts set this automatically via `cross-env`. If you invoke `rayfin dev` directly, you must set it yourself:

```bash
# Manual invocation (equivalent to npm run rayfin:dev)
RAYFIN_FEATURE_FLAGS=docker-local-dev rayfin dev

# Or export it for the session
export RAYFIN_FEATURE_FLAGS=docker-local-dev
rayfin dev
rayfin dev db apply
rayfin dev status
```

### Debugging `check-docker-ghcr`

If `npm run dev:local` fails during the pre-flight check, run the script directly with debug logs enabled:

```bash
NODE_DEBUG=rayfin_ghcr_check node scripts/check-docker-ghcr.mjs
```

This prints timing and step-level diagnostics for Docker reachability, GH auth checks, and GHCR tag verification. You can also run the full local flow with the same debug channel enabled:

```bash
NODE_DEBUG=rayfin_ghcr_check npm run dev:local
```

### Skipping `check-docker-ghcr`

If you need to bypass the pre-flight checks, set `SKIP_DOCKER_CHECK` to a truthy value (`1`, `true`, `yes`, or `on`).

```bash
# One-off run
SKIP_DOCKER_CHECK=1 npm run dev:local

# Or export for the current shell session
export SKIP_DOCKER_CHECK=1
npm run dev:local
```

Use this only when you intentionally want to skip Docker/GHCR validation.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml          # Service configuration (password auth, Docker local)
│   └── data/
│       ├── Todo.ts         # Todo entity with @role-based per-user access
│       └── schema.ts       # Schema export consumed by the typed client
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── hooks/
│   │   └── AuthContext.tsx # React context wrapping auth + session polling
│   ├── components/
│   │   └── AuthPage.tsx    # Sign-in/sign-up UI (email/password or Fabric)
│   ├── pages/
│   │   └── HomePage.tsx    # Todo list UI
│   └── services/
│       ├── IAuthService.ts        # Auth service contract + AuthUser type
│       ├── RayfinAuthService.ts   # Dual-mode: password or Fabric brokered auth
│       ├── rayfinClient.ts        # Typed Rayfin client singleton
│       ├── bootstrap.ts           # Reads env, picks the right auth mode
│       └── todos.ts               # Todo CRUD via Rayfin data API
├── scripts/
│   └── check-docker-ghcr.mjs     # Pre-flight Docker + GHCR auth check
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:local` | Start Docker backend + Vite dev server (full local) |
| `npm run dev:local:stop` | Stop local Docker containers (keeps data) |
| `npm run dev:local:down` | Remove local Docker containers (keeps volumes) |
| `npm run dev:local:purge` | Purge containers and volumes (full reset) |
| `npm run dev` | Deploy to Fabric + start Vite dev server (cloud backend) |
| `npm run up` | Deploy to Fabric only (no local server) |
| `npm run rayfin:dev` | Run `rayfin dev` with the `docker-local-dev` feature flag |
| `npm run rayfin:db` | Apply database migrations to local Docker backend |
| `npm run build` | Production build |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |

## Authentication

This template defaults to **username/password** mode — no Fabric workspace required. Users create accounts and sign in with an email and password stored in the local backend.

To switch to **Fabric brokered auth**, set these env vars (the `@microsoft/rayfin-auth-provider-fabric` dependency is already included):

```env
VITE_FABRIC_WORKSPACE_ID=...
VITE_FABRIC_ITEM_ID=...
VITE_FABRIC_PORTAL_URL=...
VITE_RAYFIN_PUBLISHABLE_KEY=...
```
