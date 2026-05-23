/**
 * Pre-flight check for Docker local development.
 *
 * Verifies that:
 *  1. Docker is installed and the daemon is running.
 *  2. The user is authenticated to ghcr.io (GitHub Container Registry)
 *     so the Rayfin host container image can be pulled.
 *
 * Exits non-zero on failure so `npm run dev:local` stops early with
 * actionable instructions instead of a cryptic Docker pull error.
 */

import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// ── 1. Docker daemon check ──────────────────────────────────────────────────

try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
  console.error('❌ Docker is not running.');
  console.error('');
  console.error('   Please start Docker Desktop (or the Docker daemon) and try again.');
  console.error('   https://www.docker.com/products/docker-desktop/');
  process.exit(1);
}

// ── 2. GHCR authentication check ────────────────────────────────────────────

const dockerConfigPath = join(homedir(), '.docker', 'config.json');

let authenticated = false;

try {
  const raw = await readFile(dockerConfigPath, 'utf-8');
  const config = JSON.parse(raw);

  const hasAuth = config.auths?.['ghcr.io'] !== undefined;
  const hasCredHelper = config.credHelpers?.['ghcr.io'] !== undefined;

  authenticated = hasAuth || hasCredHelper;
} catch {
  // config.json missing or unreadable — treat as not authenticated
}

if (authenticated) {
  console.log('✅ Docker is running and authenticated to ghcr.io');
  process.exit(0);
}

// ── Not authenticated — print setup instructions ────────────────────────────

console.error('❌ Not authenticated to ghcr.io (GitHub Container Registry).');
console.error('');
console.error('   The Rayfin host container is published to the GitHub private');
console.error('   package feed. You need to log in to ghcr.io before running');
console.error('   Docker local development.');
console.error('');
console.error('   Option 1 — Use the GitHub CLI (recommended):');
console.error('');
console.error('     # Install the GitHub CLI if you haven\'t already');
console.error('     # https://cli.github.com/');
console.error('');
console.error('     # Authenticate (needs read:packages scope)');
console.error('     gh auth login');
console.error('     gh auth refresh --scopes read:packages');
console.error('');
console.error('     # Pipe the token to Docker login');
console.error('     gh auth token | docker login ghcr.io -u $(gh api user -q .login) --password-stdin');
console.error('');
console.error('   Option 2 — Use a Personal Access Token (classic):');
console.error('');
console.error('     # Create a PAT with read:packages scope at');
console.error('     # https://github.com/settings/tokens');
console.error('');
console.error('     echo <YOUR_PAT> | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin');
console.error('');
console.error('   After logging in, re-run:  npm run dev:local');
process.exit(1);
