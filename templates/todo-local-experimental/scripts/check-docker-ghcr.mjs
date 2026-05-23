/**
 * Pre-flight check for Docker local development.
 *
 * Verifies that:
 *  1. Docker is installed and the daemon is running.
 *  2. The GitHub CLI (`gh`) is installed and authenticated.
 *  3. The user is logged in to ghcr.io — if not, automatically logs
 *     them in using their `gh` token.
 *
 * Exits non-zero on failure so `npm run dev:local` stops early with
 * actionable instructions instead of a cryptic Docker pull error.
 */

import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { homedir } from 'os';

const IMAGE = 'ghcr.io/microsoft/project-rayfin/webservice';

/** Run a command and return trimmed stdout, or null on failure. */
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

/** Ping the Docker daemon via the Unix socket without invoking the CLI. */
function pingDocker() {
  const socketPaths = [
    '/var/run/docker.sock',
    join(homedir(), '.docker', 'run', 'docker.sock'),
  ];
  const socketPath = socketPaths.find((p) => existsSync(p));
  if (!socketPath) return Promise.resolve(false);

  return new Promise((resolve) => {
    const req = http.get(
      { socketPath, path: '/_ping', timeout: 15_000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── 1. Docker daemon check ──────────────────────────────────────────────────

const dockerRunning = await pingDocker();

if (!dockerRunning) {
  console.error('❌ Docker is not running.');
  console.error('');
  console.error('   Please start Docker Desktop (or the Docker daemon) and try again.');
  console.error('   https://www.docker.com/products/docker-desktop/');
  process.exit(1);
}

// ── 2. Quick auth check — can Docker already pull from ghcr.io? ─────────────

/** Try to inspect a known image to test existing credentials. */
function canAccessGhcr() {
  // Use `docker manifest inspect` with a short timeout. If credentials are
  // already cached from a prior login, this succeeds instantly.
  const result = run('docker', ['manifest', 'inspect', `${IMAGE}:latest`], { timeout: 10_000 });
  return result !== null;
}

let alreadyAuthed = canAccessGhcr();

if (!alreadyAuthed) {
  // ── 3. GitHub CLI check ─────────────────────────────────────────────────────

  const ghUser = run('gh', ['api', 'user', '-q', '.login']);
  if (!ghUser) {
    console.error('❌ GitHub CLI (gh) is not installed or not authenticated.');
    console.error('');
    console.error('   Install it from https://cli.github.com/ then run:');
    console.error('');
    console.error('     gh auth login');
    process.exit(1);
  }

  // ── 4. Ensure read:packages scope ─────────────────────────────────────────

  const authStatus = run('gh', ['auth', 'status', '--show-token']);
  const hasPackagesScope = authStatus?.toLowerCase().includes('read:packages');

  if (!hasPackagesScope) {
    console.log('🔄 Token missing read:packages scope, refreshing…');
    try {
      execFileSync('gh', ['auth', 'refresh', '--scopes', 'read:packages'], {
        stdio: 'inherit',
        timeout: 60_000,
      });
    } catch {
      console.error('❌ Failed to refresh token with read:packages scope.');
      console.error('');
      console.error('   Run manually and try again:');
      console.error('');
      console.error('     gh auth refresh --scopes read:packages');
      process.exit(1);
    }
  }

  // ── 5. GHCR login ──────────────────────────────────────────────────────────

  const token = run('gh', ['auth', 'token']);
  if (!token) {
    console.error('❌ Could not retrieve a token from the GitHub CLI.');
    console.error('');
    console.error('   Try re-authenticating:  gh auth login');
    process.exit(1);
  }

  try {
    execFileSync('docker', ['login', 'ghcr.io', '-u', ghUser, '--password-stdin'], {
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    console.log('✅ Logged in to ghcr.io');
  } catch (err) {
    console.error('❌ Failed to log in to ghcr.io.');
    console.error('');
    const stderr = err?.stderr?.toString().trim();
    if (stderr) {
      console.error(`   ${stderr}`);
      console.error('');
    }
    console.error('   Try re-authenticating:  gh auth login');
    process.exit(1);
  }
} else {
  console.log('✅ Docker is running and already authenticated to ghcr.io');
}

// ── 6. Verify the expected container image exists ───────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
let cliVersion;
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  cliVersion = pkg.devDependencies?.['@microsoft/rayfin-cli']?.replace(/^[\^~]/, '');
} catch {
  // Can't read package.json — skip the image check
}

if (cliVersion) {
  const tag = `cli-${cliVersion}`;
  const imageRef = `${IMAGE}:${tag}`;

  // Check the GHCR API for the tag instead of `docker manifest inspect`
  // to avoid invoking the Docker CLI (which focuses Docker Desktop on macOS).
  const tagExists = run('gh', [
    'api', '/orgs/microsoft/packages/container/project-rayfin%2Fwebservice/versions',
    '--jq', `[.[].metadata.container.tags[] | select(. == "${tag}")] | length`,
  ]);

  if (!tagExists || tagExists === '0') {
    console.error(`❌ Container image not found: ${imageRef}`);
    console.error('');
    console.error('   The image for this CLI version may not be published yet.');

    // Query GHCR API for the latest available tags
    const tagsJson = run('gh', [
      'api', '/orgs/microsoft/packages/container/project-rayfin%2Fwebservice/versions',
      '--jq', '[.[].metadata.container.tags[] | select(startswith("cli-"))] | unique | sort | reverse | .[:5] | .[]',
    ]);
    if (tagsJson) {
      const tags = tagsJson.split('\n').filter(Boolean);
      if (tags.length > 0) {
        console.error('   Latest published tags:');
        for (const t of tags) {
          console.error(`     - ${t}`);
        }
        console.error('');
        console.error('   To fix, update @microsoft/rayfin-cli in package.json to match');
        console.error('   a published version, then run npm install.');
      }
    }
    process.exit(1);
  }
}
