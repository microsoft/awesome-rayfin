# Blank App

Truly bare-bones Fabric-authenticated Rayfin app.
A single static HTML page with inlined CSS, a tiny TypeScript entry point that
wires the Rayfin auth services to the DOM, and Vite for dev/build. No UI
framework, no CSS framework, no router.

## Getting started

```bash
# Deploy app to Fabric and start the local dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Project structure

```text
├── rayfin/
│   └── rayfin.yml            # Fabric service configuration (auth + static hosting)
├── index.html                # Static markup + inlined CSS
├── src/
│   ├── main.ts               # DOM wiring: auth state ↔ views and buttons
│   └── services/
│       ├── IAuthService.ts        # Auth service contract + AuthUser type
│       ├── MockAuthService.ts     # Local-dev impl (email/password)
│       ├── RayfinAuthService.ts   # Production impl (Fabric brokered auth)
│       ├── rayfinClient.ts        # Typed Rayfin client singleton
│       └── bootstrap.ts           # Reads env, picks the right auth service
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
