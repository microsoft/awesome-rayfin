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

## Cross-platform compatibility

Templates must work on both Windows and Unix-like systems (macOS/Linux). When adding or modifying scripts:

- Prefer Node.js (`.mjs`) scripts over shell scripts for any logic end users run. Shell scripts (`.sh`) are acceptable for contributor-only tooling.
- Avoid Unix-only assumptions: don't rely on Unix sockets, `/var/run/`, symlinks, or Unix file permissions in runtime scripts.
- Use `process.platform` checks or platform-agnostic APIs when behavior differs across OSes (e.g., Docker uses named pipes on Windows vs. Unix sockets on macOS/Linux).
- Use `cross-env` for setting environment variables in npm scripts.
- Use `&&` for chaining npm script commands (supported by cmd, PowerShell 7+, and bash).
- Test that `node --check <script>` passes for any new or modified `.mjs` files.

## Validation expectations

- CI is defined in `.github/workflows/validate-templates.yml`.
- The workflow validates template metadata, checks generated manifests and README output, and smoke-tests scaffolding with `rayfin init`.
- When changing templates or gallery metadata, run the same checks locally when practical.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <description>`.

- Types: `feat`, `fix`, `docs`, `chore`, `refactor`
- Scopes (optional): template name (e.g. `events-app`), `gallery`, `ci`, `scripts`, `docs`
- Example: `feat(events-app): add attendee check-in page`

See `CONTRIBUTING.md` for the full reference.

## Scratch space

- `.scratchpad/` is git-ignored and available for temporary working files (draft content, intermediate output, exploration notes, etc.).
- Prefer `.scratchpad/` over the repo tree for any files that should not be committed.

## Rayfin docs

- Prefer the Rayfin MCP server in `.mcp.json` for package discovery, examples, and API details.
- If MCP is unavailable, use `rayfin docs ...` or `npx -y @microsoft/rayfin-cli docs ...` from the relevant template directory so docs match that template's installed packages.
