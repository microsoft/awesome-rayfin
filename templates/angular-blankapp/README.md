# Angular Blank App

Bare-bones Fabric-authenticated Angular + Material app.
Sign-in, routing, and a placeholder home page — with no data layer to delete
before you start your own project.

Built with **Angular 21** (standalone components + signals), **Angular Material**,
and the Angular CLI's esbuild-based application builder.

## Getting started

```bash
# Deploy app to Fabric and start the local dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Project structure

```text
├── rayfin/
│   └── rayfin.yml              # Fabric service configuration (auth + static hosting)
├── src/
│   ├── index.html              # <app-root> mount
│   ├── main.ts                 # bootstrapApplication + providers (router, animations, session restore)
│   ├── styles.scss             # Material 3 theme (azure-blue)
│   ├── env.d.ts                # Typed import.meta.env shape for VITE_* vars
│   ├── app/
│   │   ├── app.ts              # Root component (<router-outlet/>)
│   │   ├── app.routes.ts       # /auth + / routes, both guarded
│   │   ├── auth.guard.ts       # authGuard + noAuthGuard (CanActivateFn)
│   │   ├── services/
│   │   │   └── auth-state.ts   # Angular service wrapping IAuthService (signals)
│   │   └── pages/
│   │       ├── auth/auth.ts    # Sign-in card (mat-card + mat-button)
│   │       └── home/home.ts    # Post-auth landing page
│   └── services/
│       ├── IAuthService.ts        # Auth service contract + AuthUser type
│       ├── MockAuthService.ts     # Local-dev impl (email/password)
│       ├── RayfinAuthService.ts   # Production impl (Fabric brokered auth)
│       ├── rayfinClient.ts        # Typed Rayfin client singleton
│       └── bootstrap.ts           # Reads env, picks the right auth service
└── package.json
```

## Environment variables

The Rayfin CLI writes `VITE_*` env vars into `.env.local` via
`rayfin env --framework vite` (run automatically by the `predev` / `prebuild`
scripts). Angular reads them at build time through
[`@ngx-env/builder`](https://www.npmjs.com/package/@ngx-env/builder),
configured with `ngxEnv.prefix: "VITE_"` in `angular.json`. The auth services
read them from `import.meta.env.VITE_*` exactly like the other Rayfin
templates.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server on port 5173 |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment (entrypoint for `rayfin up staticapp deploy`) |
| `npm run lint` | Lint with ESLint + `@angular-eslint` |
| `npm run test` | Run unit tests with Karma + Jasmine (headless Chrome) |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |
