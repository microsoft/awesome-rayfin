# AGENTS.md

This project ships Rayfin agent context.
Load `.agents/skills/rayfin/SKILL.md` and the `rayfin` MCP server in `.mcp.json` before writing Rayfin code.

Rayfin docs are version-locked to the packages installed in this project.
Prefer the MCP tools `search_docs`, `get_doc`, `list_docs`, and `discover_packages` for examples, API details, and troubleshooting.
If MCP is unavailable, run `rayfin docs ...` from the project root so the CLI reads this project's `node_modules`.
If `rayfin` is not on `PATH`, use `npx -y @microsoft/rayfin-cli docs ...` from the project root.

Use `discover_packages` or `rayfin docs discover <topic>` when installed docs do not cover the task.

## Docker local development

This template includes Docker local development support behind the `docker-local-dev` feature flag.

Key scripts:
- `npm run dev:local` — starts the full Docker-based backend (checks GHCR auth first)
- `npm run dev:local:db` — applies database schema to local Docker environment
- `npm run dev:local:stop` / `dev:local:purge` — stop or reset the local environment

The GHCR check script (`scripts/check-docker-ghcr.mjs`) validates Docker is running and
the user is authenticated to `ghcr.io` before allowing `dev:local` to proceed.
