/**
 * Awesome Rayfin app gallery + one-click deploy command.
 *
 * Source: https://github.com/microsoft/awesome-rayfin — a curated gallery of
 * Project Rayfin templates (full React/Vite apps backed by Fabric auth + data).
 *
 * Unlike Fabric Jumpstarts (which deploy as a server-side notebook), Rayfin
 * apps are scaffolded and deployed with the Rayfin CLI:
 *
 *     npm create @microsoft/rayfin@latest -- --template <gallery-url>
 *     npx rayfin up
 *
 * The CLI runs on the developer machine (it scaffolds source, installs deps,
 * builds and uploads to Fabric), so it cannot be triggered from the browser
 * through the JSON proxy. "One-click deploy" here therefore copies the exact,
 * ready-to-run deploy command for the selected app to the clipboard.
 */

export type RayfinAppCategory = 'App' | 'Game' | 'Tool' | 'Starter';

export interface RayfinApp {
  /** Folder name under `templates/` in the awesome-rayfin repo. */
  slug: string;
  name: string;
  description: string;
  category: RayfinAppCategory;
  /** Tech stack tags for display. */
  stack: string[];
  /** Supports Fabric Entra SSO in production. */
  fabricAuth: boolean;
  /** Uses a Rayfin data model (typed entities). */
  fabricData: boolean;
  /** Flagged experimental in the gallery. */
  experimental?: boolean;
}

export const AWESOME_RAYFIN_REPO = 'https://github.com/microsoft/awesome-rayfin';

/** Browse the template folder on GitHub. */
export function rayfinAppRepoUrl(slug: string): string {
  return `${AWESOME_RAYFIN_REPO}/tree/main/templates/${slug}`;
}

/**
 * The running app already knows its own Fabric context, so we pre-fill the
 * deploy command with the current workspace + tenant as a sensible default.
 * The copier can still override either flag (the scaffolded app may target a
 * different workspace). Falls back to readable placeholders when the env is
 * not set (e.g. local dev without `.env.local`).
 */
function currentWorkspaceId(): string {
  return (import.meta.env.VITE_FABRIC_WORKSPACE_ID as string | undefined)?.trim() || '<your-workspace-id>';
}

function currentTenantId(): string {
  return (import.meta.env.VITE_FABRIC_TENANT_ID as string | undefined)?.trim() || '<your-tenant-id>';
}

/**
 * Build the one-click deploy command for a gallery app. The Rayfin CLI reads
 * `rayfin-template.yml` at the repo root and shows a picker; the user selects
 * the named app, then `rayfin up staticapp deploy` deploys it to Fabric. Both
 * `--workspace-id` and `--tenant` are pre-filled from this app's own context
 * so the snippet is ready-to-run (override them to target a different place).
 */
export function rayfinDeployCommand(app: RayfinApp): string {
  return [
    `# Scaffold "${app.name}" from the Awesome Rayfin gallery`,
    `npm create @microsoft/rayfin@latest -- --template ${AWESOME_RAYFIN_REPO}`,
    `#   -> choose "${app.name}" in the template picker, then cd into the new folder`,
    '',
    '# Deploy to your Fabric workspace (workspace + tenant pre-filled from this app)',
    `npx rayfin up staticapp deploy --skip-build --workspace-id ${currentWorkspaceId()} --tenant ${currentTenantId()} -y`,
  ].join('\n');
}

/** Command that opens the full gallery picker (all apps). */
export function rayfinGalleryCommand(): string {
  return `npm create @microsoft/rayfin@latest -- --template ${AWESOME_RAYFIN_REPO}`;
}

/**
 * Mirror of the Awesome Rayfin template gallery (templates/ + rayfin-template.yml).
 */
export const RAYFIN_APPS: RayfinApp[] = [
  {
    slug: 'field-technician',
    name: 'Field Technician App',
    description:
      'Field service management app with role-based dashboards for dispatchers and technicians, job tracking, customer lookup, and dual-mode auth (local password + Fabric).',
    category: 'App',
    stack: ['React', 'Vite', 'Tailwind'],
    fabricAuth: true,
    fabricData: true,
  },
  {
    slug: 'ibcs-trainer',
    name: 'IBCS Trainer',
    description:
      'HTML5 Canvas platformer that teaches IBCS chart rules level by level, embedded in a Fabric-authenticated Rayfin app; each play-through is persisted to a typed GameStats entity.',
    category: 'Game',
    stack: ['React', 'Vite', 'Tailwind'],
    fabricAuth: true,
    fabricData: true,
  },
  {
    slug: 'slide-deck',
    name: 'Slide Deck',
    description:
      'Interactive slide deck presenter with sessions, live slide tracking, and audience chat.',
    category: 'Tool',
    stack: ['React', 'Vite', 'Tailwind'],
    fabricAuth: true,
    fabricData: true,
  },
  {
    slug: 'todo-local-experimental',
    name: 'Todo app with full local dev',
    description:
      'End-to-end todo CRUD with username/password auth, a Rayfin data model, and Docker local development — a working starter that exercises the full data path without Fabric.',
    category: 'Starter',
    stack: ['React', 'Vite', 'Tailwind', 'Docker'],
    fabricAuth: false,
    fabricData: true,
    experimental: true,
  },
];
