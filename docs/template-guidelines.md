# Template Guidelines

Use this guide when adding a new gallery template under `templates/`.

## Location and naming

- Create each template in its own `templates/<template-name>/` directory.
- Directory names must be **kebab-case** (for example, `field-engineer`, `events-app`).
- `template.name` in `package.json` must match the directory name.
- `template.displayName` should be a human-readable **Title Case** name.
- `manifest.json.templateId` must match `template.name`.
- `rayfin/rayfin.yml` `id` and `name` must match the directory name.

## Required files

Each template should include the following files:

| File | Purpose | Required details |
| --- | --- | --- |
| `package.json` | Template package metadata and scripts | Must include a `template` object with `name`, `displayName`, `description`, and `category` |
| `manifest.json` | Gallery manifest metadata | Must include `templateId`, `icon`, `services`, `hasDabSchema`, and `tokens` |
| `rayfin-template.yml` | Leaf Rayfin template manifest | Must contain `apiVersion: v1`, `metadata` (`name`, `displayName`, `description`), and an `entries` item with `path: .` and `name` |
| `rayfin/rayfin.yml` | Rayfin service configuration | Include `id`, `name`, `version`, and service configuration |
| `rayfin/data/schema.ts` | Rayfin data schema | May be empty if the template has no data entities |
| `rayfin/tsconfig.json` | TypeScript config for the `rayfin/` directory | Keep Rayfin config isolated from the app TS config |
| `README.md` | Template-specific documentation | Must include `Getting started`, `Project structure`, and `Scripts` sections |
| `index.html` | Vite HTML entry point | Standard app entry document |
| `src/main.tsx` | React entry point | App bootstrap for the template |
| `tsconfig.json` | Root TypeScript config | Use TypeScript 5+ settings and ES2022 target |
| `vite.config.ts` | Vite configuration | Use React and Tailwind plugins |
| `vitest.config.ts` | Test configuration | Use Vitest for tests |
| `eslint.config.js` | Lint configuration | Use ESLint 9+ flat config |
| `.gitignore` | Template-level ignore rules | Include build artifacts, dependencies, logs, and Rayfin-generated files |

## Metadata conventions

Use these values consistently across template files:

- `template.name`: kebab-case identifier that matches the directory name
- `template.displayName`: human-readable name shown in the CLI picker
- `template.description`: one-line description of the template
- `template.category`: gallery category the template belongs to (see below)
- `manifest.json.templateId`: same value as `template.name`
- `manifest.json.icon`: icon identifier for the template
- `rayfin-template.yml.metadata`: should mirror the `template` metadata from `package.json`

## Gallery categories

The README gallery is grouped by `template.category`. Pick the single best fit:

| Category | Use it for |
| --- | --- |
| `starters` | Minimal scaffolds — auth wired up, little or nothing to delete |
| `business` | Everyday operational apps: dashboards, field work, presenting |
| `analytics` | Apps that put data and insight in front of an end user |
| `fabric-tools` | Apps that inspect, document, or administer the data platform itself |
| `digital-twins` | 3D, map, and live-operations views of real-world systems |
| `games` | Canvas and game-engine apps, and interactive teaching |
| `other` | Fallback — used automatically when the field is missing or unknown |

Categories with no templates are still listed, with an invitation to contribute the first one,
so builders can see where a new template belongs.

## Preview images

Each template gets one row in the README gallery. The row's preview image is resolved by
convention — no metadata field is needed:

- Path: `docs/previews/<template-directory-name>.webp` (`.png`, `.jpg`, `.jpeg`, and `.gif` also work)
- Size: 1280x800, displayed at 180px wide
- Budget: keep it under 200 KB — WebP at quality ~85 comfortably fits
- Content: a real screenshot of the running app is preferred; a designed title card is an acceptable stand-in

If no image is found, the shared `docs/previews/_placeholder.webp` is used and the
generator prints a warning.

## `manifest.json` conventions

`manifest.json` should describe the template’s capabilities:

- `services.auth`, `services.data`, `services.storage`, and `services.staticHosting` must be booleans
- `hasDabSchema` should reflect whether the template includes a DAB schema
- `tokens` should list replacement tokens required by the template

Example shape:

```json
{
  "templateId": "field-engineer",
  "icon": "field-engineer",
  "services": {
    "auth": true,
    "data": true,
    "storage": false,
    "staticHosting": true
  },
  "hasDabSchema": false,
  "tokens": ["__RAYFIN_API_URL__", "__RAYFIN_PK__"]
}
```

## Stack conventions

Templates should follow the current gallery baseline:

- React 19+ with `react-dom`
- Vite 7+ with `@vitejs/plugin-react-swc`
- TypeScript 5+ targeting ES2022
- Tailwind CSS 4+ with `@tailwindcss/vite`
- Vitest for testing
- ESLint 9+ with flat config

## README expectations

Each template README should include:

1. **Getting started** — how to install, run, and preview the template
2. **Project structure** — key files and directories with a short explanation
3. **Scripts** — a table or list describing available npm scripts

Keep the README template-specific and focused on what a contributor or consumer needs to run the app.

## Generated files and scripts

The repository includes automation to keep template metadata in sync:

- `scripts/generate-manifest.mjs` reads `package.json` template metadata
- It generates the root `rayfin-template.yml`
- It generates each template's leaf `rayfin-template.yml`
- It regenerates the categorised gallery in the root `README.md`, between the
  `<!-- TEMPLATES:START -->` and `<!-- TEMPLATES:END -->` markers

Everything between those markers is generated — edit the template metadata, not the README.

After adding or updating a template, run:

```bash
node scripts/generate-manifest.mjs
```

There is also a scaffold script at `scripts/new-template.sh` that bootstraps a new template directory.

## Recommended checklist

Before opening a PR, make sure the template:

- Lives in `templates/<kebab-case-name>/`
- Includes every required file listed above
- Uses matching identifiers across `package.json`, `manifest.json`, and `rayfin/rayfin.yml`
- Declares a `template.category` from the supported list
- Ships a preview image at `docs/previews/<template-directory-name>.webp`
- Includes a README with the required sections
- Follows the React/Vite/TypeScript/Tailwind/Vitest/ESLint baseline
- Runs `node scripts/generate-manifest.mjs` so generated manifests and the root README stay up to date
