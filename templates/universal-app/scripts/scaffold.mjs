// scripts/scaffold.mjs — general capability-pack scaffolder for the universal app.
//
// One command turns a capability pack ON: it reads the pack's declarative
// manifest (`.agents/skills/<pack>/pack.json`) and, in one idempotent pass:
//   1. patches Fabric service flags in `rayfin/rayfin.yml`,
//   2. merges the pack's pinned dependencies + scripts into `package.json`,
//   3. copies the pack's kit files into the project,
//   4. runs `npm install` for the newly-merged dependencies.
//
// This replaces the slow, error-prone "copy ~60 files by hand + install ~40
// packages + rewire scripts" flow with `npm run pack:add <pack>`. It is
// pack-agnostic: future connectors/capabilities just ship their own `pack.json`.
//
// Usage:
//   node scripts/scaffold.mjs <pack> [--no-install] [--dry-run] [--force-seeds]
//   npm run pack:add -- <pack> [--no-install] [--dry-run] [--force-seeds]
//
// Flags:
//   --no-install   Do everything except `npm install` (fast; install yourself).
//   --dry-run      Print the planned actions without writing anything.
//   --force-seeds  Overwrite seed files even if you've customized them.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, '.agents', 'skills');

function parseArgs(argv) {
  const out = { pack: undefined, flags: {} };
  for (const a of argv) {
    if (a.startsWith('--')) out.flags[a.slice(2)] = true;
    else if (!out.pack) out.pack = a;
  }
  return out;
}

const log = (...m) => console.log(...m);
const warn = (...m) => console.warn(...m);

/** Set `services.<service>.enabled` in a rayfin.yml string, adding the block if absent. */
function setServiceEnabled(text, service, enabled) {
  const lines = text.split(/\r?\n/);
  const svcRe = new RegExp(`^  ${service}:\\s*$`);
  const enabledRe = /^ {4}enabled:\s*(true|false)\s*$/;
  const svcIdx = lines.findIndex((l) => svcRe.test(l));

  if (svcIdx === -1) {
    const servicesIdx = lines.findIndex((l) => /^services:\s*$/.test(l));
    const block = [`  ${service}:`, `    enabled: ${enabled}`];
    if (servicesIdx === -1) return [...lines, 'services:', ...block].join('\n');
    lines.splice(servicesIdx + 1, 0, ...block);
    return lines.join('\n');
  }

  for (let j = svcIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') continue;
    // Dedent to another top-level service (<=2-space indent) ends this block.
    if (/^ {0,2}\S/.test(line)) break;
    if (enabledRe.test(line)) {
      lines[j] = `    enabled: ${enabled}`;
      return lines.join('\n');
    }
  }
  lines.splice(svcIdx + 1, 0, `    enabled: ${enabled}`);
  return lines.join('\n');
}

/** Alpha-sort a dependency map for deterministic diffs. */
function sortDeps(map) {
  if (!map) return map;
  return Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
}

function copyDir(fromDir, toDir, onFile, dryRun) {
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    const to = join(toDir, name);
    if (statSync(from).isDirectory()) copyDir(from, to, onFile, dryRun);
    else {
      if (!dryRun) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      onFile(to);
    }
  }
}

/**
 * Content digest used to recognize an untouched base seed. Line endings and a
 * leading BOM are normalized so a Windows checkout hashes the same as a Linux
 * one.
 */
export function seedDigest(text) {
  return createHash('sha256')
    .update(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
    .digest('hex');
}

/**
 * Decide what to do with a seed file — one the pack wants to plant over the base
 * starter, but which the user may already own.
 *
 * A seed is only replaced when we can *prove* the destination is still the
 * untouched base starter: it is missing, or its content digest matches one of
 * the base revisions the pack recorded in `seedReplaceIfPristine`. Anything else
 * is the user's file and is preserved. (Same model as dpkg conffile handling.)
 *
 * This must not be inferred from a substring. A marker like `HomePage` or
 * `./main.css` survives exactly the edits worth protecting — wiring
 * `AuthProvider` into `main.tsx` keeps the `./main.css` import — so a substring
 * test reports "pristine" for a customized file and silently destroys it.
 *
 * @returns {'write'|'preserve'|'current'} `current` means the pack's own seed is
 *   already in place, so a re-run is a silent no-op.
 */
export function classifySeed(entry, destText, { force = false, sourceText } = {}) {
  if (destText === undefined) return 'write';
  if (sourceText !== undefined && seedDigest(destText) === seedDigest(sourceText)) {
    return 'current';
  }
  if (force) return 'write';

  const pristine = entry.seedReplaceIfPristine;
  if (pristine === undefined) return 'preserve';

  const digests = Array.isArray(pristine) ? pristine : [pristine];
  return digests.includes(seedDigest(destText)) ? 'write' : 'preserve';
}

function main() {
  const { pack, flags } = parseArgs(process.argv.slice(2));
  if (!pack) {
    warn('Usage: node scripts/scaffold.mjs <pack> [--no-install] [--dry-run]');
    process.exit(1);
  }

  const packDir = join(SKILLS, pack);
  const manifestPath = join(packDir, 'pack.json');
  if (!existsSync(manifestPath)) {
    warn(`No manifest for pack "${pack}" at ${manifestPath}`);
    warn('Available packs:', readdirSync(SKILLS)
      .filter((d) => existsSync(join(SKILLS, d, 'pack.json')))
      .join(', ') || '(none)');
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dryRun = !!flags['dry-run'];
  log(`\n> Scaffolding pack: ${pack}${dryRun ? ' (dry run)' : ''}`);
  if (manifest.description) log(`  ${manifest.description}`);

  // 1) rayfin.yml service flags
  const svcEdits = manifest.rayfin?.services ?? {};
  const svcNames = Object.keys(svcEdits);
  if (svcNames.length) {
    const ymlPath = join(ROOT, 'rayfin', 'rayfin.yml');
    let yml = readFileSync(ymlPath, 'utf8');
    for (const name of svcNames) {
      yml = setServiceEnabled(yml, name, !!svcEdits[name].enabled);
      log(`  - rayfin.yml: ${name}.enabled = ${!!svcEdits[name].enabled}`);
    }
    if (!dryRun) writeFileSync(ymlPath, yml);
  }

  // 2) package.json deps + scripts
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let depCount = 0;
  for (const kind of ['dependencies', 'devDependencies']) {
    const add = manifest[kind];
    if (!add) continue;
    pkg[kind] = pkg[kind] ?? {};
    for (const [name, version] of Object.entries(add)) {
      if (pkg[kind][name] !== version) depCount++;
      pkg[kind][name] = version;
    }
    pkg[kind] = sortDeps(pkg[kind]);
  }
  if (manifest.scripts) {
    pkg.scripts = pkg.scripts ?? {};
    for (const [name, cmd] of Object.entries(manifest.scripts)) {
      pkg.scripts[name] = cmd;
      log(`  - package.json script: ${name}`);
    }
  }
  if (!dryRun) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`  - package.json: ${depCount} dependency change(s)`);

  // 3) copy kit files
  let copied = 0;
  const preserved = [];
  const legacySeeds = [];
  for (const entry of manifest.copy ?? []) {
    const from = join(packDir, entry.from);
    const to = join(ROOT, entry.to);
    if (!existsSync(from)) {
      warn(`  ! missing source: ${entry.from}`);
      continue;
    }
    // Seed files plant the pack's starter over the base one, but never clobber a
    // file the user has made their own.
    const isSeed = entry.seedReplaceIfPristine !== undefined
      || entry.seedReplaceIfContains !== undefined;
    if (isSeed) {
      const destText = existsSync(to) ? readFileSync(to, 'utf8') : undefined;
      const action = classifySeed(entry, destText, {
        force: !!flags['force-seeds'],
        sourceText: readFileSync(from, 'utf8'),
      });
      if (action === 'current') continue;
      if (action === 'preserve') {
        preserved.push({ to: entry.to, from: `.agents/skills/${pack}/${entry.from}` });
        if (entry.seedReplaceIfPristine === undefined) legacySeeds.push(entry.to);
        continue;
      }
      if (!dryRun) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      copied++;
      continue;
    }
    if (statSync(from).isDirectory()) copyDir(from, to, () => copied++, dryRun);
    else {
      if (!dryRun) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      copied++;
    }
  }
  log(`  - copied ${copied} file(s)`);

  if (legacySeeds.length) {
    warn(
      `  ! ${legacySeeds.join(', ')}: "seedReplaceIfContains" is no longer honored — ` +
      'a substring cannot prove a file is unmodified. Record the base digest in ' +
      '"seedReplaceIfPristine" instead (see pack-manifest.md). Kept your file.',
    );
  }

  // A preserved seed is not a no-op: the pack's own version carries providers the
  // rest of the kit depends on, so say exactly what still needs merging.
  if (preserved.length) {
    log('\n  Kept your customized file(s) — merge the pack\'s version in by hand:');
    for (const p of preserved) log(`    - ${p.to}  <-  ${p.from}`);
    log('    (re-run with --force-seeds to overwrite instead)');
  }

  // 4) install the dependencies the manifest just merged into package.json.
  if (dryRun) {
    log('\n(dry run - nothing written, nothing installed)');
  } else if (flags['no-install']) {
    log('\n(--no-install - run `npm install` to fetch the new dependencies)');
  } else {
    log('\n> Installing dependencies...');
    // Single-string command with shell:true keeps this cross-platform (cmd.exe on
    // Windows, /bin/sh elsewhere) and avoids Node's DEP0190 args+shell warning.
    const res = spawnSync(
      'npm install --no-audit --no-fund',
      { cwd: ROOT, stdio: 'inherit', shell: true },
    );
    if (res.status !== 0) {
      warn('\n! dependency install failed - resolve the error above, then re-run.');
      process.exit(res.status ?? 1);
    }
  }

  if (Array.isArray(manifest.next) && manifest.next.length) {
    log('\n[done] Pack ready. Next, read these skills as you build:');
    for (const s of manifest.next) log(`  -> .agents/skills/${s}/SKILL.md`);
  } else {
    log('\n[done] Pack ready.');
  }
}

// Only run when invoked directly, so tests can import the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
