#!/usr/bin/env node
/**
 * Report whether this working copy is safe to publish, given `config/release.json`.
 *
 * ⚠️ THE CONFIG SWITCH ALONE IS NOT A GUARANTEE. It governs what the app offers and what the
 * pipeline builds from now on; it does not retract assets an earlier build already wrote, and it
 * does not touch tracked files. Both are how a repository configured not to redistribute TUM data
 * ends up publishing it anyway — from a stale `public/terrain/`, or from a config carrying values
 * read out of the API.
 *
 * Exit code 1 means: the stated posture and the files on disk disagree.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (rel) => resolve(ROOT, rel);

const release = JSON.parse(readFileSync(p('config/release.json'), 'utf-8'));
const RAW_MODE = release.navigatumData;
// Mirrors `NAVIGATUM_MODE` in src/config/release.ts: an unrecognised value fails CLOSED.
const mode = ['include', 'synthetic', 'exclude'].includes(RAW_MODE) ? RAW_MODE : 'exclude';
const excludeAois = release.excludeAois ?? [];
const garchingExcluded = excludeAois.includes('garching');
const tumWithheld = mode !== 'include' || garchingExcluded;

// Mirrors `SHIPS_REAL_CUSTOMER_DATA`: only the literal string includes.
const shipsCustomerData = release.realCustomerData === 'include';

/**
 * Assets that ARE the TUM data — the TUM feeds and anything derived from them.
 *
 * ⚠️ `rooms.*` IS NOT IN THIS LIST, and that is the point of `synthetic` mode. The room polygons
 * come from OpenStreetMap under ODbL; whether they may ship is decided by the `semantics` stamp
 * inside `rooms.json`, checked separately below, not by the file existing.
 */
const TUM_ONLY = [
  'data/tum',
  'data/raw/navigatum',
  'public/terrain/garching/flows.json',
  'public/terrain/garching/flows.bin',
];

/** Built room assets, whose acceptability depends on how they were built. */
const ROOM_ASSETS = [
  'public/terrain/garching/rooms.json',
  'public/terrain/garching/rooms.bin',
  'public/terrain/garching/occupancy.bin',
  'dist/terrain/garching/rooms.json',
  'dist/terrain/garching/occupancy.bin',
];

/** Tracked files that carry TUM-derived VALUES or TUM-specific tooling. */
const TRACKED = [
  ['config/aoi/garching.json', 'AOI config — `exploreBuildings` carries `navigatumRooms` counts read from the API'],
  ['config/campus-garching.json', 'campus outlines for Garching (OSM-sourced, but TUM-specific)'],
  ['e2e/tum.spec.ts', 'end-to-end tests asserting real TUMonline bookings'],
  ['tools/geodata/fetch_navigatum.py', 'NavigaTUM room-semantics fetcher'],
  ['tools/geodata/fetch_navigatum_calendar.py', 'TUMonline calendar fetcher'],
  ['tools/data/build_tum_dataset.py', 'builds the TUM planner dataset'],
];

/**
 * Scheduler sites built from a university's own export, and where that export lands on disk.
 *
 * ⚠️ SEPARATE FROM THE TUM LISTS, BECAUSE THE RESTRICTION IS STRONGER. TUM's bookings are at
 * least published somewhere. An institution's own Untis export is not public in any part,
 * including the fact that a particular lecturer teaches on a particular afternoon.
 */
const CUSTOMER_SITES = [
  ['oth-real', 'data/oth-real', "a university's own Untis GPU export"],
];

/** AOI configs whose declared `schedulerSite` must be checked against Lever C. */
const AOI_DIR = 'config/aoi';

const say = (s = '') => process.stdout.write(`${s}\n`);

say('Release posture (config/release.json)');
if (RAW_MODE !== mode) {
  say(`  ⚠ navigatumData is "${RAW_MODE}", which is not a mode. Failing closed to "${mode}".`);
}
say(`  navigatumData : ${mode}`);
say(`  excludeAois   : ${excludeAois.length ? excludeAois.join(', ') : '(none)'}`);
say(
  `  => TUM data is ${tumWithheld ? 'WITHHELD' : 'INCLUDED — this build may not be publishable'}`,
);
if (mode === 'synthetic') {
  say('     Garching keeps its OpenStreetMap room polygons and gets an invented week.');
}
say(`  realCustomerData : ${release.realCustomerData ?? '(unset)'}`);
say(
  `  => Customer exports are ${
    shipsCustomerData ? 'INCLUDED — this build may not be publishable' : 'WITHHELD'
  }`,
);
say();

let bad = 0;

const presentTum = TUM_ONLY.filter((f) => existsSync(p(f)));
if (tumWithheld && presentTum.length) {
  bad += presentTum.length;
  say('✗ TUM-only assets still on disk — a build made now could ship them:');
  for (const f of presentTum) say(`    ${f}`);
} else if (tumWithheld) {
  say('✓ No TUM-only assets on disk.');
} else {
  say(`· ${presentTum.length} TUM asset path(s) present (expected — nothing is withheld).`);
}

// ⚠️ THE FILE EXISTING PROVES NOTHING; WHAT IT WAS BUILT FROM DOES. A `rooms.json` left over from
// an internal build carries real TUMonline bookings and is indistinguishable by name from a
// synthetic one. The `semantics` stamp is the only way to tell them apart.
for (const f of ROOM_ASSETS.filter((x) => x.endsWith('rooms.json'))) {
  if (!existsSync(p(f))) continue;
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(p(f), 'utf-8')).semantics;
  } catch {
    stamp = undefined;
  }
  const real = stamp !== 'synthetic';
  if (mode === 'synthetic' && real) {
    bad += 1;
    say(`✗ ${f} was built with semantics "${stamp ?? 'navigatum'}", not synthetic.`);
    say('  Rebuild it:  python tools/geodata/build_rooms.py --aoi garching --semantics synthetic');
  } else if (mode === 'exclude' && existsSync(p(f))) {
    bad += 1;
    say(`✗ ${f} exists, but this build ships no interiors at all. Delete it.`);
  } else if (mode === 'synthetic') {
    say(`✓ ${f} carries the synthetic stamp.`);
  }
}
say();

const presentTracked = TRACKED.filter(([f]) => existsSync(p(f)));
if (garchingExcluded && presentTracked.length) {
  say('· Tracked TUM files still in the repository:');
  for (const [f, why] of presentTracked) say(`    ${f}\n        ${why}`);
  say('  These are SOURCE, not data. Delete them for a repository with no TUM content at all;');
  say('  leaving them is fine if withholding the site is enough. Not counted as a failure.');
} else if (garchingExcluded) {
  say('✓ No tracked TUM files remain.');
}

say();

/*
 * LEVER C — a customer's own timetable export.
 *
 * ⚠️ TWO HALVES, AND THE SECOND IS THE ONE THAT WOULD HAVE SHIPPED. The dataset itself is under
 * `/data/`, which is gitignored, so it was never going to be committed. What WAS committed is
 * `config/aoi/oth-regensburg.json` naming `schedulerSite: "oth-real"` as the site's default — a
 * tracked file, in a public template, pointing the product at a customer's week. The app now
 * substitutes the generated site at runtime; this asserts the two agree, because a substitution
 * nobody checks is a substitution that gets refactored away.
 */
for (const [site, dir, why] of CUSTOMER_SITES) {
  const onDisk = existsSync(p(dir));
  if (!shipsCustomerData && onDisk) {
    say(`· ${dir} is on disk — ${why}.`);
    say('    Not a failure: /data/ is gitignored and .templateignore excludes it, so it cannot');
    say('    reach a published tree. Delete it before archiving a copy of this working directory.');
  }
  if (!shipsCustomerData && existsSync(p('Dockerfile'))) {
    const dockerfile = readFileSync(p('Dockerfile'), 'utf-8');
    if (new RegExp(`^\\s*COPY\\s+${dir}`, 'm').test(dockerfile)) {
      bad += 1;
      say(`✗ Dockerfile COPYs ${dir}, which a public clone can never produce.`);
    }
  }
  if (!existsSync(p(AOI_DIR))) continue;
  for (const f of readdirSync(p(AOI_DIR)).filter((n) => n.endsWith('.json'))) {
    let declared;
    try {
      declared = JSON.parse(readFileSync(p(`${AOI_DIR}/${f}`), 'utf-8')).schedulerSite;
    } catch {
      declared = undefined;
    }
    if (declared !== site) continue;
    if (shipsCustomerData) {
      say(`· ${AOI_DIR}/${f} defaults to "${site}" (expected — nothing is withheld).`);
    } else {
      // Not a failure: `applyRelease()` substitutes the generated site before the config is ever
      // exported, and `release.test.ts` proves it. Said out loud so nobody "fixes" the config by
      // hand and then wonders why the internal demo lost its real week.
      say(`· ${AOI_DIR}/${f} declares "${site}"; the release switch substitutes the generated site.`);
    }
  }
}
say();
say(bad ? `FAIL — ${bad} problem(s).` : 'OK.');
process.exit(bad ? 1 : 0);
