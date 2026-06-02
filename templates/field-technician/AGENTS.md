# AGENTS.md

This project ships Rayfin agent context.
Load `.agents/skills/rayfin/SKILL.md` and the `rayfin` MCP server in `.mcp.json` before writing Rayfin code.

## ⚠️ Experimental features

This template uses two **experimental** Rayfin features that may change or break:

1. **Username/password authentication** — uses `client.auth.signIn/signUp({ email, password })` rather than the production Fabric brokered auth flow. The API surface is not yet stable and may not be fully documented.
2. **Docker local hosting (`rayfin dev`)** — runs the full Rayfin backend locally in Docker containers. Requires the `RAYFIN_FEATURE_FLAGS=docker-local-dev` feature flag and a published container image matching the CLI version.

When working with auth code, refer to the existing `RayfinAuthService` and `ServiceContainer` implementations rather than MCP docs, since the password auth API may not be documented yet.

## Development workflows

Three modes are available:

- **`npm run dev:local`** — Full local. Runs the Rayfin backend in Docker, generates env, starts Vite.
- **`npm run dev:local:stop`** — Stop local Docker containers (keeps data).
- **`npm run dev:local:down`** — Remove local Docker containers (keeps volumes).
- **`npm run dev:local:purge`** — Purge containers and volumes (full reset).
- **`npm run dev`** — Cloud backend. Deploys to Fabric (`rayfin up`), starts Vite against the remote API.
- **`npm run up`** — Deploy only. Deploys to Fabric without a local dev server.

### Running `rayfin dev` commands

Use `npm run rayfin:dev` to invoke `rayfin dev` with the required feature flag already set:

```bash
npm run rayfin:dev             # start Docker containers
npm run rayfin:dev -- status   # check container status
npm run dev:local:stop         # stop containers
npm run dev:local:down         # remove containers
npm run dev:local:purge        # purge containers and volumes
npm run rayfin:db              # apply database migrations
```

If invoking `rayfin dev` directly (without npm scripts), you **must** set the feature flag:

```bash
RAYFIN_FEATURE_FLAGS=docker-local-dev rayfin dev [options]
```

## Rayfin docs

Rayfin docs are version-locked to the packages installed in this project.
Prefer the MCP tools `search_docs`, `get_doc`, `list_docs`, and `discover_packages` for examples, API details, and troubleshooting.
If MCP is unavailable, run `rayfin docs ...` from the project root so the CLI reads this project's `node_modules`.
If `rayfin` is not on `PATH`, use `npx -y @microsoft/rayfin-cli docs ...` from the project root.

Use `discover_packages` or `rayfin docs discover <topic>` when installed docs do not cover the task.
