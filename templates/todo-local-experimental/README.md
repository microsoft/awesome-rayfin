# Basic Todo App

End-to-end Fabric-authenticated todo CRUD with a Rayfin data model and per-user row-level security.
A working starter that exercises the full data path — sign in, create todos, toggle them, delete them.

## Getting started

```bash
# Deploy app to Fabric and start the local dev server
npm run dev

# As needed, apply database migrations (one time, when running locally)
npm run rayfin:db
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml          # Fabric service configuration
│   └── data/
│       ├── Todo.ts         # Todo entity with @role-based per-user access
│       └── schema.ts       # Schema export consumed by the typed client
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── hooks/
│   │   └── AuthContext.tsx # React context wrapping the auth helpers
│   ├── components/
│   │   └── AuthPage.tsx    # Sign-in UI
│   ├── pages/
│   │   └── HomePage.tsx    # Todo list UI
│   └── services/
│       ├── IAuthService.ts        # Auth service contract + AuthUser type
│       ├── MockAuthService.ts     # Local-dev impl (email/password)
│       ├── RayfinAuthService.ts   # Production impl (Fabric brokered auth)
│       ├── rayfinClient.ts        # Typed Rayfin client singleton
│       ├── bootstrap.ts           # Reads env, picks the right auth service
│       └── todos.ts               # Todo CRUD wrappers (in-memory in local dev)
└── package.json
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment (entrypoint for `rayfin up staticapp deploy`) |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |
| `npm run rayfin:db` | Apply database migrations |
