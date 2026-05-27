---
name: template-gallery
description: "Use when working in the Awesome Rayfin template gallery repo — creating, validating, or updating templates under templates/, regenerating gallery manifests, or updating the templates table in README. Triggers: awesome-rayfin, template gallery, templates/, new-template.sh, generate-manifest.mjs, rayfin-template.yml, manifest.json, template metadata, templateId, template.name, template.displayName, template.description, rayfin init -t, scaffold template, gallery README, leaf manifest, root manifest"
metadata:
  author: microsoft
  version: "0.1.0"
---

# Template Gallery Skill

Use this skill when working in the Awesome Rayfin template gallery repo. This is an operational checklist for creating, validating, and maintaining gallery templates.

## Goal

Make changes that keep individual templates, generated manifests, and gallery documentation consistent.

## Before you change anything

1. Read `docs/template-guidelines.md` for the expected template structure.
2. Read the root `AGENTS.md` for gallery-specific workflow guidance.
3. Use the `rayfin` MCP server from `.mcp.json` when you need Rayfin SDK or CLI docs.
4. Review a nearby template in `templates/` if you need a working example.
5. Use `.scratchpad/` for any temporary or working files — it is git-ignored.

## Create a new template

1. Run:
   ```bash
   ./scripts/new-template.sh <name> "<Display Name>" "<description>"
   ```
2. Open the new `templates/<name>/` directory.
3. Customize the generated files, especially:
   - `src/` for the application UI and client logic
   - `rayfin/data/` for entities and schema definitions
   - `rayfin/rayfin.yml` for service configuration
4. Update any placeholder content in `README.md`, `manifest.json`, and `package.json`.
5. Confirm `package.json` includes:
   - `template.name`
   - `template.displayName`
   - `template.description`
6. If the template adds new routes or features, make sure the README explains what the template demonstrates.

## Validate a template

1. Verify generated manifests are in sync:
   ```bash
   node scripts/generate-manifest.mjs --check
   ```
2. Smoke-test scaffolding in a fresh scratch directory:
   ```bash
   rayfin init -t . --template-name "<name>"
   ```
   If the CLI supports it in your environment, point the output to a new empty directory so you can inspect the scaffolded result safely.
3. Check the scaffolded output contains the expected project files, especially `package.json`.
4. Re-open the source template's `package.json` and confirm `template.name`, `template.displayName`, and `template.description` are present and correct.
5. If the repo workflow or your change touches manifest generation, compare the regenerated files before finishing.

## Update the gallery after template changes

After changing template metadata or adding/removing templates, run:

```bash
node scripts/generate-manifest.mjs
```

This regenerates:
- root `rayfin-template.yml`
- per-template `rayfin-template.yml`
- the templates table in `README.md`

Do not hand-edit generated manifest content if the script owns it.

## Required template structure

Each template should include these files:

- `package.json` with template metadata
- `manifest.json`
- `rayfin-template.yml`
- `rayfin/rayfin.yml`
- `rayfin/data/schema.ts`
- `README.md`
- `index.html`
- `src/main.tsx`
- `tsconfig.json`
- `vite.config.ts`

If any required file is missing, add it before considering the template complete.

## Common patterns

### Add a data entity

1. Create a new file in `rayfin/data/`.
2. Define the entity with decorators from `@microsoft/rayfin-core`.
3. Export the entity from `rayfin/data/schema.ts` so the schema includes it.
4. Update any app code that reads or writes the new entity.
5. Document the new data model in the template README if it changes what the template demonstrates.

### Add a page

1. Create the page component in `src/pages/`.
2. Add the route in `src/App.tsx`.
3. Link to the page from navigation or the relevant entry point.
4. Verify the page works with the template's auth and data model.

## Cross-platform compatibility (Windows + macOS/Linux)

Templates are used on Windows, macOS, and Linux. Check for platform issues when adding or modifying scripts:

- **Prefer `.mjs` over `.sh`** for any script that end users run. Shell scripts are fine for contributor tooling only (e.g., `scripts/new-template.sh`).
- **No Unix-only assumptions** in runtime scripts: avoid hardcoded Unix socket paths (`/var/run/docker.sock`), symlinks, or POSIX-only APIs without a Windows fallback.
- **Use `process.platform` guards** when behavior diverges (e.g., Docker daemon detection uses sockets on Unix but named pipes/CLI on Windows).
- **Use `cross-env`** for environment variables in npm scripts — never rely on `VAR=value cmd` syntax.
- **Avoid path separators** in JS: use `path.join()`/`path.resolve()` instead of string concatenation with `/`.
- **`&&` chaining in npm scripts** is safe (works in cmd, PowerShell 7+, and bash).

When reviewing or validating a template, scan scripts for:
1. Hardcoded Unix paths (`/var/run/`, `/tmp/`, `~/.docker/run/`)
2. Socket or pipe assumptions without platform checks
3. Shell-specific syntax in npm scripts (backticks, `$(...)`, `export`)
4. File permission operations (`chmod`, `chown`) without guards

## Final checklist

- Template structure matches `docs/template-guidelines.md`
- Template metadata in `package.json` is complete
- `node scripts/generate-manifest.mjs --check` passes
- `rayfin init -t . --template-name "<name>"` works for the changed template
- Generated gallery files were refreshed with `node scripts/generate-manifest.mjs` when needed
- README and manifest content reflect the actual template behavior
