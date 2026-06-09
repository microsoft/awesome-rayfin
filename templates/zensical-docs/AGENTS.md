# AGENTS.md

This is a Zensical-based documentation site deployed to Microsoft Fabric via Rayfin.
Load the `rayfin` MCP server in `.mcp.json` before writing Rayfin deployment configuration.

## Stack

- **Zensical** — static site generator for documentation sites
- **Rayfin** — deployment tool for Microsoft Fabric Apps

This template does **not** use React, Vite, or TypeScript for the application layer.
Documentation content is authored in Markdown under `docs/`.

## Key files

| File | Purpose |
|------|---------|
| `docs/` | Markdown source pages |
| `zensical.toml` | Zensical config (site name, URL, navigation, theme) |
| `rayfin/rayfin.yml` | Rayfin deployment config (static hosting, Fabric auth) |
| `site/` | Generated static output — do not edit directly |

## Development workflows

- **`npm run dev`** — Start the Zensical local dev server (`http://0.0.0.0:8000`) with live reload
- **`npm run build`** — Generate the static site into `site/`
- **`npm run up`** — Deploy to Microsoft Fabric via `rayfin up`

## Before deploying

1. Update `site_url` in `zensical.toml` to your Fabric App URL.
2. Update `allowedRedirectUris` in `rayfin/rayfin.yml` to the same URL.
3. Run `rayfin login` then `rayfin up --workspace-id <your-workspace-id>`.

## Rayfin docs

Prefer the MCP tools `search_docs`, `get_doc`, `list_docs`, and `discover_packages` for Rayfin details.
If MCP is unavailable, run `rayfin docs ...` from the project root.
