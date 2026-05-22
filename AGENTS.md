# AGENTS.md

This repository is the **Awesome Rayfin** template gallery, not a single Rayfin app. Work primarily in `templates/` and keep gallery metadata, manifests, and docs in sync.

## Start here

- Follow `docs/template-guidelines.md` for required template structure and contribution expectations.
- Load `.agents/skills/template-gallery/SKILL.md` before creating, validating, or updating templates in this gallery.
- Use the `rayfin` MCP server defined in `.mcp.json` for Rayfin SDK and CLI documentation while editing template code.

## Key repo workflows

- `scripts/new-template.sh` scaffolds a new template directory: `./scripts/new-template.sh <name> "<Display Name>" "<description>"`
- `scripts/generate-manifest.mjs` regenerates the root `rayfin-template.yml`, per-template manifests, and the README templates table.
- `node scripts/generate-manifest.mjs --check` verifies generated files are up to date.

## Validation expectations

- CI is defined in `.github/workflows/validate-templates.yml`.
- The workflow validates template metadata, checks generated manifests and README output, and smoke-tests scaffolding with `rayfin init`.
- When changing templates or gallery metadata, run the same checks locally when practical.

## Scratch space

- `.scratchpad/` is git-ignored and available for temporary working files (draft content, intermediate output, exploration notes, etc.).
- Prefer `.scratchpad/` over the repo tree for any files that should not be committed.

## Rayfin docs

- Prefer the Rayfin MCP server in `.mcp.json` for package discovery, examples, and API details.
- If MCP is unavailable, use `rayfin docs ...` or `npx -y @microsoft/rayfin-cli docs ...` from the relevant template directory so docs match that template's installed packages.
