# [Experimental] Todo App w/ full local

> ⚠️ **This template uses experimental features.** Username/password authentication and Docker local hosting (`rayfin dev`) are not yet stable. APIs may change without notice.

End-to-end todo CRUD with username/password auth, a Rayfin data model, and Docker local development.
A working starter that exercises the full data path without Fabric — sign in, create todos, toggle them, delete them.

## Getting started

```bash
# Start the local Docker backend and dev server
npm run dev:local

# Apply database migrations (first time only)
npm run dev:local:db
```

Open [http://localhost:5173](http://localhost:5173) to view the app. Create an account with any email/password.

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
| `npm run dev:local` | Start Docker backend + Vite dev server |
| `npm run dev:local:db` | Apply database migrations to local backend |
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |

## Authentication

This template defaults to **username/password** mode — no Fabric workspace required. Users create accounts and sign in with an email and password stored in the local backend.

To switch to **Fabric brokered auth**, set these env vars and add `@microsoft/rayfin-auth-provider-fabric` to dependencies:

```env
VITE_FABRIC_WORKSPACE_ID=...
VITE_FABRIC_ITEM_ID=...
VITE_FABRIC_PORTAL_URL=...
VITE_RAYFIN_PUBLISHABLE_KEY=...
```
