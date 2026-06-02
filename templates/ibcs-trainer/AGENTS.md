# AGENTS.md

This project ships Rayfin agent context.
Load `.agents/skills/rayfin/SKILL.md` and the `rayfin` MCP server in `.mcp.json` before writing Rayfin code.

## What this template is

A single-file HTML5 Canvas platformer (`public/game/ibcs_trainer.html`) that
teaches IBCS chart rules level by level, embedded in a Fabric-authenticated
Rayfin app. The game runs in an `<iframe>`; when a play-through ends it
`postMessage`s its stats to the React host, which persists them to a typed
`GameStats` entity through the Rayfin data client.

## Development workflows

- **`npm run dev`** — Cloud backend. Deploys to Fabric (`rayfin up`), then starts
  Vite against the remote API. This is the primary workflow.
- **`npm run rayfin:up`** — Deploy only. Deploys to Fabric without a local dev server.
- **`npm run build:fabric`** — Production build for Fabric static hosting.
- **`npm run test`** — Run unit tests with Vitest.
- **`npm run lint`** — Lint with ESLint.

## Data model

`GameStats` (`rayfin/data/GameStats.ts`) mirrors the game's `stats.toJSON()`
payload (score, deaths by cause, coins, jumps, attacks, forms collected, final
form, level reached, duration). Each record is scoped to the signed-in player
via `user_id` (from the JWT `sub` claim) using a row-level `@role` policy, so a
player only ever sees their own runs. Register new entities in
`rayfin/data/schema.ts`.

## Editing the game

The game is a standalone HTML file in `public/game/`. The only Rayfin-specific
hook is in its `stats.publish()` function, which `postMessage`s the stats
payload to the parent window. `src/pages/GamePage.tsx` listens for that message
and calls `client.data.GameStats.create(...)`.

## Rayfin docs

Rayfin docs are version-locked to the packages installed in this project.
Prefer the MCP tools `search_docs`, `get_doc`, `list_docs`, and `discover_packages`
for examples, API details, and troubleshooting.
If MCP is unavailable, run `rayfin docs ...` from the project root so the CLI reads
this project's `node_modules`.
If `rayfin` is not on `PATH`, use `npx -y @microsoft/rayfin-cli docs ...` from the project root.
