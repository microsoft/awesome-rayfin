/**
 * Pre-flight check for Docker local development.
 *
 * Checks that:
 *  1. Docker is installed and the daemon is reachable.
 *  2. The expected Rayfin image tag is derived from this template's CLI version.
 *  3. GHCR auth is ensured only if a pull may be needed.
 *  4. The expected image tag exists in GHCR (best effort).
 *
 * Set SKIP_DOCKER_CHECK=1 to bypass all checks.
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
import { debuglog } from 'node:util';

const IMAGE = 'ghcr.io/microsoft/project-rayfin/webservice';
const debug = debuglog('rayfin_ghcr_check');

function envFlagEnabled(value) {
  if (!value) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

if (envFlagEnabled(process.env.SKIP_DOCKER_CHECK)) {
  console.log('⚠️  SKIP_DOCKER_CHECK is set; skipping Docker/GHCR pre-flight checks.');
  process.exit(0);
}

function startTimer(label) {
  const start = process.hrtime.bigint();
  debug('start: %s', label);
  return (result) => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    if (result) {
      debug('stop: %s (%s) in %dms', label, result, Math.round(elapsedMs));
      return;
    }
    debug('stop: %s in %dms', label, Math.round(elapsedMs));
  };
}

/** Run a command and return trimmed stdout, or null on failure. */
function run(cmd, args, opts = {}) {
  const stopTimer = startTimer(`run ${cmd}`);
  debug('exec: %s %o', cmd, args);
  try {
    const output = execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    }).trim();
    stopTimer('ok');
    return output;
  } catch {
    stopTimer('failed');
    debug('exec failed: %s %o', cmd, args);
    return null;
  }
}

/** Ping the Docker daemon via the Unix socket without invoking the CLI. */
function pingDockerSocket() {
  const stopTimer = startTimer('pingDockerSocket');
  const socketPaths = [
    '/var/run/docker.sock',
    join(homedir(), '.docker', 'run', 'docker.sock'),
  ];
  const socketPath = socketPaths.find((p) => existsSync(p));
  if (!socketPath) {
    stopTimer('no_socket');
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const req = http.get(
      { socketPath, path: '/_ping', timeout: 15_000 },
      (res) => {
        res.resume();
        const ok = res.statusCode === 200;
        stopTimer(ok ? 'ok' : `status_${res.statusCode ?? 'unknown'}`);
        resolve(ok);
      },
    );
    req.on('error', () => {
      stopTimer('error');
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      stopTimer('timeout');
      resolve(false);
    });
  });
}

/** Fallback: check Docker via CLI (used on Windows where Unix sockets aren't available). */
function pingDockerCli() {
  return run('docker', ['info']) !== null;
}

/** Check if Docker daemon is reachable, with platform-appropriate strategy. */
function pingDocker() {
  const stopTimer = startTimer('pingDocker');
  if (process.platform === 'win32') {
    const ok = pingDockerCli();
    stopTimer(ok ? 'ok' : 'failed');
    return Promise.resolve(ok);
  }
  return pingDockerSocket().then((ok) => {
    const reachable = ok || pingDockerCli();
    stopTimer(reachable ? 'ok' : 'failed');
    return reachable;
  });
}

// ── Helper: quick auth checks ───────────────────────────────────────────────

/** Check local Docker config for a credential entry/helper for GHCR. */
function hasGhcrCredentialHint() {
  const dockerConfigDir = process.env.DOCKER_CONFIG || join(homedir(), '.docker');
  const configPath = join(dockerConfigDir, 'config.json');

  if (!existsSync(configPath)) {
    debug('docker config not found: %s', configPath);
    return false;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const auths = config.auths ?? {};
    const ghcrAuth = auths['ghcr.io'] ?? auths['https://ghcr.io'];
    const hasInlineAuth = Boolean(ghcrAuth?.auth || ghcrAuth?.identitytoken);

    const credHelpers = config.credHelpers ?? {};
    const helper = credHelpers['ghcr.io'] ?? credHelpers['https://ghcr.io'];
    const hasHelper = Boolean(helper || false); //|| config.credsStore // TODO: credsStore seems to not always work with ghcr.io

    const found = hasInlineAuth || hasHelper;
    debug('ghcr credential hint: %s', found ? 'present' : 'missing');
    return found;
  } catch {
    debug('failed to parse docker config: %s', configPath);
    return false;
  }
}

/** Check whether a specific image tag is already present locally. */
function hasLocalImage(imageRef) {
  return run('docker', ['image', 'inspect', imageRef], { timeout: 10_000 }) !== null;
}

/** Ensure Docker can authenticate to GHCR via the GitHub CLI token flow. */
function ensureGhcrAuth() {
  const stopTimer = startTimer('ensureGhcrAuth');
  // ── GH auth step A: GitHub CLI check ──────────────────────────────────────

  const ghUser = run('gh', ['api', 'user', '-q', '.login']);
  if (!ghUser) {
    stopTimer('gh_unavailable');
    console.error('❌ GitHub CLI (gh) is not installed or not authenticated.');
    console.error('');
    console.error('   Install it from https://cli.github.com/ then run:');
    console.error('');
    console.error('     gh auth login');
    process.exit(1);
  }

  // ── GH auth step B: Ensure read:packages scope ────────────────────────────

  const authStatus = run('gh', ['auth', 'status', '--show-token']);
  const hasPackagesScope = authStatus?.toLowerCase().includes('read:packages');

  if (!hasPackagesScope) {
    const stopRefreshTimer = startTimer('gh auth refresh read:packages');
    console.log('🔄 Token missing read:packages scope, refreshing…');
    try {
      execFileSync('gh', ['auth', 'refresh', '--scopes', 'read:packages'], {
        stdio: 'inherit',
        timeout: 60_000,
      });
      stopRefreshTimer('ok');
    } catch {
      stopRefreshTimer('failed');
      stopTimer('refresh_failed');
      console.error('❌ Failed to refresh token with read:packages scope.');
      console.error('');
      console.error('   Run manually and try again:');
      console.error('');
      console.error('     gh auth refresh --scopes read:packages');
      process.exit(1);
    }
  }

  // ── GH auth step C: GHCR login ────────────────────────────────────────────

  const token = run('gh', ['auth', 'token']);
  if (!token) {
    stopTimer('token_missing');
    console.error('❌ Could not retrieve a token from the GitHub CLI.');
    console.error('');
    console.error('   Try re-authenticating:  gh auth login');
    process.exit(1);
  }

  try {
    const stopLoginTimer = startTimer('docker login ghcr.io');
    execFileSync('docker', ['login', 'ghcr.io', '-u', ghUser, '--password-stdin'], {
      input: token,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
    stopLoginTimer('ok');
    stopTimer('ok');
    console.log('✅ Logged in to ghcr.io');
  } catch (err) {
    stopTimer('docker_login_failed');
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
}

// ── 1. Docker daemon check ──────────────────────────────────────────────────

const stopDockerCheckTimer = startTimer('step 1 docker check');
const dockerRunning = await pingDocker();
stopDockerCheckTimer(dockerRunning ? 'ok' : 'failed');

if (!dockerRunning) {
  console.error('❌ Docker is not running.');
  console.error('');
  console.error('   Please start Docker Desktop (or the Docker daemon) and try again.');
  console.error('   https://www.docker.com/products/docker-desktop/');
  process.exit(1);
}

// ── 2. Resolve expected image tag for this template version ─────────────────

const stopResolveTagTimer = startTimer('step 2 resolve image tag');
const __dirname = dirname(fileURLToPath(import.meta.url));
let cliVersion;
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  cliVersion = pkg.devDependencies?.['@microsoft/rayfin-cli']?.replace(/^[\^~]/, '');
} catch {
  debug('package.json read failed; skipping version-based tag checks');
  // Can't read package.json — skip the image check
}

if (cliVersion) {
  const tag = `cli-${cliVersion}`;
  const imageRef = `${IMAGE}:${tag}`;

  // Fast path: if we already have the required image locally, skip GH auth/API.
  if (hasLocalImage(imageRef)) {
    stopResolveTagTimer('local_image_present');
    console.log(`✅ Required image already present locally: ${imageRef}`);
    process.exit(0);
  }
}
stopResolveTagTimer(cliVersion ? 'version_resolved' : 'version_unavailable');

// ── 3. Ensure auth only when a pull may be needed ───────────────────────────

const stopEnsureAuthTimer = startTimer('step 3 ensure auth');
const alreadyAuthed = hasGhcrCredentialHint();
if (!alreadyAuthed) {
  ensureGhcrAuth();
  stopEnsureAuthTimer('auth_completed');
} else {
  stopEnsureAuthTimer('already_authed');
  console.log('✅ Docker is running and credentials for ghcr.io were found');
}

// ── 4. Verify the expected container image tag exists (best effort) ─────────

if (cliVersion) {
  const stopVerifyTagTimer = startTimer('step 4 verify image tag');
  const tag = `cli-${cliVersion}`;
  const imageRef = `${IMAGE}:${tag}`;

  // Check GHCR API (best effort) without invoking Docker CLI.
  const tagExists = run('gh', [
    'api', '--paginate', '/orgs/microsoft/packages/container/project-rayfin%2Fwebservice/versions',
    '--jq', `[.[].metadata.container.tags[] | select(. == "${tag}")] | length`,
  ]);

  // If GH API verification isn't available (e.g., missing scope), do not
  // treat that as a missing tag; allow downstream Docker pull behavior.
  if (!tagExists) {
    stopVerifyTagTimer('skipped_no_api_result');
    process.exit(0);
  }

  if (tagExists === '0') {
    stopVerifyTagTimer('missing_tag');
    console.error(`❌ Container image not found: ${imageRef}`);
    console.error('');
    console.error('   The image for this CLI version may not be published yet.');

    // Query GHCR API for the latest available tags
    const tagsJson = run('gh', [
      'api', '--paginate', '/orgs/microsoft/packages/container/project-rayfin%2Fwebservice/versions',
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

  stopVerifyTagTimer('tag_present');
}
