# Awesome Rayfin — Roadmap & Recommendations

Prioritized list of improvements for the awesome-rayfin template gallery repo.

## Priority 1 — Foundation

### [Complete] 1. Auto-generate `rayfin-template.yml` from `templates/` directories

Each template already has its own `package.json` with `template.name`, `template.displayName`, and `template.description`. A script can scan `templates/*/package.json`, extract that metadata, and emit the root `rayfin-template.yml`. This eliminates manual sync between the two and prevents drift. Could be a simple Node script or even a shell one-liner with `jq`.

### [Complete] 2. CI workflow: validate manifest + scaffold test

A GitHub Actions PR gate that:

- Runs the auto-gen script and asserts `rayfin-template.yml` is up-to-date (or just generates it in CI)
- Runs `rayfin init -t . --template-name "<name>"` for each entry into a temp dir and checks exit code
- Validates each template's `package.json` has the required `template` metadata fields

### [Complete] 3. Clean up `.gitignore`

The current `.gitignore` is copied from the monorepo and has rules for Rush, .NET, OpenSpec, DAB, VS Code extensions, etc. that don't apply here. Trim it to what this gallery repo actually needs (node_modules, dist, .env, rayfin/.temp, .DS_Store, etc.).

## Priority 2 — Developer Experience

### [Complete] 4. Template-for-templates (scaffolding a new template contribution)

A `_template-scaffold/` directory or script that creates a new template with the right structure: `package.json` with `template` metadata, `manifest.json`, `rayfin-template.yml` (leaf), `README.md` skeleton, `rayfin/rayfin.yml`, and src boilerplate. Contributors run something like `./scripts/new-template.sh my-app "My App" "Description"`.

### [Complete] 5. Template style/structure guidelines doc

A `docs/template-guidelines.md` covering required files, naming conventions, metadata fields, `rayfin-template.yml` format, and what the leaf manifest needs. Update `CONTRIBUTING.md` to link to it.

### [Complete] 6. Copilot skills for template creation/validation

Add `.agents/skills/` with skills that help coding agents create, validate, and maintain templates in this gallery. This could include instructions for scaffolding a new template from the template-for-templates (item 4), running validation checks (manifest metadata, required files, `rayfin init` smoke test), and updating the gallery manifest and README. Lets agents be first-class contributors to the gallery.

### 7. Remove leaf `rayfin-template.yml` duplication

Right now each template needs its own `rayfin-template.yml` because the CLI resolves into the subdirectory then looks for a manifest. If the CLI supports this pattern long-term, the auto-gen script (item 1) should also generate the leaf manifests. If not, investigate whether the root manifest alone can suffice with a CLI update.

## Priority 3 — Quality Gates

### [Complete] 8. Per-template lint + build + test in CI

For each template, run `npm install && npm run lint && npm run build && npm test` in CI. Catches broken templates before merge.

### [Complete] 9. Dependabot / Renovate for template dependencies

Templates pin `@microsoft/rayfin-*` packages. Automated PRs for version bumps keep them current.

### [Complete] 10. PR template

A `.github/PULL_REQUEST_TEMPLATE.md` with checklist: template metadata present, `rayfin init` tested, README updated, etc.

## Priority 4 — Polish

### [Complete] 11. Root-level `AGENTS.md` / `.mcp.json` cleanup

The root-level `AGENTS.md` and `.mcp.json` reference Rayfin MCP and skills, but this is a gallery repo, not a Rayfin app. Either remove them or tailor them to help agents contribute templates (e.g., point to the template guidelines doc).

### [Complete] 12. README table auto-generation

Extend the auto-gen script to also update the `README.md` templates table from the same `package.json` metadata, so the gallery table stays in sync automatically.

### 13. Issue templates

`.github/ISSUE_TEMPLATE/` with forms for "New Template Proposal" and "Bug in Existing Template".
