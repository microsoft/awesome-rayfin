# API Key Management Starter

A Rayfin template for issuing, listing, and revoking application-level API keys for integrations, scripts, and machine-to-machine access. Keys are generated securely, shown once, and stored as hashes.

## Install this template

```bash
npm create @microsoft/rayfin@latest -- --template https://github.com/microsoft/awesome-rayfin --template-name "API Key Management Starter"
```

## Getting started

```bash
# Start the local Docker backend and dev server
npm run dev:local

# Apply database migrations (first time only)
npm run rayfin:db
```

Open [http://localhost:5173](http://localhost:5173) to view the app. Create an account with any email/password.

Local Docker mode pulls Rayfin development images from GitHub Container Registry. If the preflight check reports a GHCR authentication error, sign in with GitHub CLI (`gh auth login`) or run `docker login ghcr.io` with a GitHub token that has `read:packages` access.

## How it works

- The app generates a key like `rk_live_<publicId>_<secret>` using crypto-safe randomness.
- Only a SHA-256 hash is stored in the database.
- The full key is shown once after creation and never returned again.
- Keys belong to the authenticated user who created them.
- Revoking a key switches its status to `revoked`.

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml          # Service configuration (password auth, Docker local)
│   └── data/
│       ├── ApiKey.ts       # ApiKey entity with per-user access policy
│       └── schema.ts       # Schema export consumed by the typed client
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── hooks/
│   │   └── AuthContext.tsx # React context wrapping auth + session polling
│   ├── components/
│   │   └── AuthPage.tsx    # Sign-in/sign-up UI (email/password or Fabric)
│   ├── pages/
│   │   └── ApiKeysPage.tsx # API key management UI
│   └── services/
│       ├── apiKeys.ts      # Key create/list/revoke logic
│       ├── keyGenerator.ts # Secure key generation
│       ├── keyHashing.ts   # SHA-256 hashing
│       ├── IAuthService.ts        # Auth service contract + AuthUser type
│       ├── RayfinAuthService.ts   # Dual-mode: password or Fabric brokered auth
│       ├── rayfinClient.ts        # Typed Rayfin client singleton
│       └── bootstrap.ts           # Reads env, picks the right auth mode
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

## Limitations and next steps

- Optional scopes, expiration, and last-used tracking are not surfaced in the UI yet.
- Add a verification endpoint or middleware in your app to authenticate incoming API keys.
