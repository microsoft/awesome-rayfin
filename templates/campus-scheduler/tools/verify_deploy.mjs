/**
 * Prove the DEPLOYED app renders — PLAN Phase 5.
 *
 * `rayfin up` reporting success only means bytes were uploaded. It says nothing about whether the
 * thing renders, and this project has already shipped two faults that a green deploy log would
 * happily have hidden: a drape whose mipmap chain made the entire campus black, and a drape
 * uploaded mirrored so the buildings appeared to stand in a field. Both looked like a working
 * deployment from every angle except a human eye on the pixels.
 *
 * So this drives the real URL in a real browser and asserts on what came back.
 *
 * ⚠️ **Edge with a persistent profile, not vanilla Chromium.** The app sits behind Fabric auth on
 * the MCAP tenant; a fresh context bounces through AAD and lands nowhere. `channel: 'msedge'` plus
 * a profile that has signed in once gives silent SSO afterwards. A cold profile WILL fail the
 * first time and needs an interactive sign-in — that is expected, not a bug.
 *
 * Usage
 *   node tools/verify_deploy.mjs
 *   node tools/verify_deploy.mjs --url http://localhost:5188   # verify a local build the same way
 */

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ⚠️ Set after the FIRST `rayfin up` of this app. It is deliberately empty rather than inherited:
// the forked value pointed at the Campus-Insights item, so a "verified" run would have proved the
// wrong app renders.
const LIVE_URL = process.env.CAMPUS_SCHEDULER_URL ?? '';
const PROFILE = resolve(REPO, '..', 'temp', 'scheduler-deploy-profile');
const SHOT = resolve(REPO, '..', 'temp', `scheduler-deploy-verify-${process.argv.includes('--aoi') ? process.argv[process.argv.indexOf('--aoi') + 1] : 'oth-regensburg'}.png`);

/** What each site must look like once loaded. Numbers are floors, not equalities — they are here
 *  to catch a layer failing to load or a stale asset, not to freeze the data. */
const SITES = {
  'oth-regensburg': {
    // Floors derived from the Overpass probe of 2026-07-30 (8 193 buildings, 6 078 OSM trees
    // before the Oberpfalz cadastre is added), set well below the measurement so a partial
    // cadastre or a trimmed LoD tile does not fail the run.
    buildings: 5000,
    trees: 4000,
    // Rooms exist now. The earlier "zero rooms is a fact about this site" note was true only of
    // the OSM survey on its own: 25 surveyed rooms in Gebäude K and nothing at Prüfening. The
    // room stock is now 25 SURVEYED outlines plus generated ones for the remaining teaching and
    // office space, so the floor is set below the generated total but above the surveyed count —
    // it catches the asset failing to load without freezing the generator's output.
    rooms: 1500,
    withCalendar: 50,
    neverBooked: -1,
    planner: true,
  },
  'lmu-muenchen': {
    // Floors from the MEASURED build of 2026-07-31: 15 746 LoD2 buildings and 29 580 cadastre
    // trees. Set roughly a third below, for the same reason as OTH — this catches a layer that
    // failed to load, not a data update.
    buildings: 10000,
    trees: 18000,
    // ⚠️ The room floor is HIGHER than OTH's even though LMU is the second site, because LMU's
    // surveyed stock is larger, not smaller: 526 real outlines in Oettingenstraße 67 against
    // OTH's 25 in Gebäude K. Copying OTH's numbers here would have made the check pass while
    // half the interiors were missing.
    rooms: 2000,
    withCalendar: 50,
    neverBooked: -1,
    planner: true,
  },

  // ⚠️ THE TWO CAMPUS TWINS WERE MISSING FROM THIS TABLE, AND THAT IS HOW A DEFECT SHIPPED.
  // Garching and Tübingen came in from Campus-Insights and the deploy gate did not know their
  // names, so `--aoi garching` exited "unknown AOI" and neither was ever checked against a live
  // build. Garching then spent a deploy rendering roughly half its rooms at NaN — its rooms.bin is
  // Int16 and this repo had widened its reader to Int32 — which this check would have caught on
  // the console-errors assertion alone. A gate that covers half the sites reports on half the app.
  garching: {
    // Floors from the Campus-Insights build: 353 LoD2 buildings, 14 081 cadastre trees, 3 922
    // room polygons, 310 rooms carrying a TUMonline calendar. Set well below each, for the same
    // reason as the sites above — this catches a layer that failed to load, not a data update.
    buildings: 250,
    trees: 10000,
    rooms: 3000,
    withCalendar: 200,
    neverBooked: -1,
    // ⚠️ 1 500 m IS AN OTH NUMBER. That default exists because OTH and LMU each span two campuses
    // 2.5 km apart, so a collapsed room layer shows up as a small span. Garching's indoor survey
    // is ONE cluster — the MW and MI complexes — measuring 420 m across, which is the site being
    // itself rather than a fault. The check keeps its real teeth through the distinct-position
    // half: rooms stacked on one point still fail, whatever the span.
    roomSpanM: 300,
    // Since 2026-08-04 Garching serves TUM's real published week.
    planner: true,
  },
  tuebingen: {
    // ⚠️ `rooms: 0` IS A FACT ABOUT THE SITE, NOT A GAP IN THE CHECK. Tübingen has three mapped
    // indoor rooms city-wide and none in the Altstadt, so there is no interior to verify and the
    // room assertions are skipped by design. Copying Garching's floors here would fail every run
    // and teach the next person to weaken the check rather than read it.
    buildings: 4500,
    trees: 8000,
    rooms: 0,
    withCalendar: 0,
    neverBooked: -1,
    planner: false,
  },
};

/**
 * Which building the explode check opens, read from the AOI rather than repeated here.
 *
 * ⚠️ THIS WAS A DUPLICATED CONSTANT AND IT HAD ALREADY DRIFTED. LMU's entry said `hero: 'A'`,
 * which is a real building — a Hauptgebäude wing — so the check would have opened it, passed, and
 * proved nothing: wing A's interior is entirely generated. The AOI names `ax`, Oettingenstraße 67,
 * the one building on the site whose 520 room outlines were surveyed. A verifier that opens the
 * wrong building is worse than one that opens none, because it reports success for the layer it
 * never looked at. Reading the config removes the possibility rather than correcting the value.
 */
function heroBuilding(aoiId) {
  const path = resolve(REPO, 'config', 'aoi', `${aoiId}.json`);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  return config.rooms?.heroBuilding ?? null;
}

const args = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const base = urlArg >= 0 ? args[urlArg + 1] : LIVE_URL;
const aoiArg = args.indexOf('--aoi');
const aoi = aoiArg >= 0 ? args[aoiArg + 1] : 'oth-regensburg';
const expect = SITES[aoi];
if (!expect) throw new Error(`unknown AOI '${aoi}' — try ${Object.keys(SITES).join(' or ')}`);
if (!base) throw new Error('no URL — pass --url or set CAMPUS_SCHEDULER_URL (the app has not been deployed yet)');

const failures = [];
function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ''}`);
}

/**
 * Does the backend this build talks to actually answer the routes it calls?
 *
 * ⚠️ THE FRONT END AND THE BACKEND DEPLOY SEPARATELY, AND NOTHING NOTICED WHEN THEY DIVERGED.
 * The week calendar shipped in the app calling `/api/calendar/suggestions`; the deployed
 * Container App is an older image and answers that with 404 while `/api/plan/summary` still
 * returns 200. So the app builds, typechecks, renders, passes every scene assertion — and the
 * drawer a planner opens is empty. The e2e suite did report it, as five failures that looked
 * like a broken feature rather than a version skew, and the only reason the cause was found is
 * that someone curled the two routes by hand.
 *
 * A 404 is the signal that matters. 401/403 means the route EXISTS and this check simply has no
 * app key, which is fine — the browser build has one. Anything else is a genuine outage.
 *
 * Skipped, not failed, when no backend is configured: the twin is designed to work without one.
 */
async function checkBackendContract() {
  const envFiles = ['rayfin/.env', '.env.local'];
  let apiBase = process.env.SCHEDULER_API ?? '';
  for (const file of envFiles) {
    if (apiBase) break;
    try {
      const text = readFileSync(resolve(REPO, file), 'utf8');
      apiBase = /^(?:VITE_|VITE_RAYFIN_|RAYFIN_PUBLIC_)SCHEDULER_API=(\S+)/m.exec(text)?.[1] ?? '';
    } catch {
      // An absent env file is a legitimate "no backend configured".
    }
  }
  if (!apiBase) {
    console.log('  --    no scheduler backend configured, skipping the contract check');
    return;
  }

  // ⚠️ CHECK THE SHIPPED BUNDLE, NOT JUST THE ENV FILE.
  //
  // `rayfin up` builds with whatever `VITE_*` variables are in the shell, and a variable left over
  // from local testing silently wins over rayfin/.env. That happened: a build went to production
  // with `VITE_SCHEDULER_API=http://127.0.0.1:8080` compiled in, so every visitor's browser tried
  // to reach their own machine. The routes below all passed, because they ask the env file's
  // backend — which was perfectly healthy and simply not the one the app was calling.
  //
  // The bundle is the only artefact that knows what the app will actually do.
  try {
    const html = await (await fetch(base)).text();
    const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    let sawLoopback = false;
    let sawConfigured = false;
    const host = new URL(apiBase).host;
    for (const src of scripts) {
      const code = await (await fetch(new URL(src, base).toString())).text();
      // ⚠️ A LOOPBACK **URL**, not the bare word. This used to match `localhost` anywhere in the
      // bundle, which was fine until a vendored library shipped `window.location.hostname ===
      // "localhost"` — an ordinary dev-mode check — and the deploy gate failed a perfectly correct
      // build. Loosening it to "warn only" would have thrown away the one check that catches a
      // dev backend compiled into production, so it is narrowed to what it was always about
      // instead: a loopback address used as an ORIGIN. Env values are always full URLs, so
      // anchoring on the scheme still catches the `http://127.0.0.1:8080` leak that caused it.
      if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(code)) sawLoopback = true;
      if (code.includes(host)) sawConfigured = true;
    }
    check('the shipped bundle does not point at localhost', !sawLoopback,
      sawLoopback ? 'a dev VITE_SCHEDULER_API leaked into the build' : '');
    check('the shipped bundle points at the configured backend', sawConfigured, host);
  } catch (err) {
    check('the shipped bundle names a backend', false, String(err).slice(0, 80));
  }

  // Every GET route the app relies on that needs no path parameter. Keep this list in step with
  // src/api/scheduler.ts — it is the contract, and it is cheap to state.
  const routes = ['/api/health', '/api/plan/summary', '/api/calendar/suggestions', '/api/calendar'];
  for (const route of routes) {
    let status = 0;
    try {
      const res = await fetch(new URL(route, apiBase).toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(180_000),
      });
      status = res.status;
    } catch (err) {
      check(`backend answers ${route}`, false, `unreachable: ${String(err).slice(0, 80)}`);
      continue;
    }
    check(
      `backend answers ${route}`,
      status !== 404,
      status === 404 ? 'HTTP 404 — the backend is older than this build' : `HTTP ${status}`,
    );
  }
}

const consoleErrors = [];
// ⚠️ A COUNT IS NOT A DIAGNOSIS. When `/api/plan/summary` was closed to anonymous callers, the one
// frontend caller that had never needed the key started returning 401 on every load of a site with
// a planner — and this file reported exactly `no console errors — 1`, with the browser's own
// useless "Failed to load resource: the server responded with a status of 401". Finding out WHICH
// request took a separate scripted run. Responses are recorded here so the failure names itself.
const refusedRequests = [];

mkdirSync(dirname(SHOT), { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1600, height: 900 },
  args: ['--enable-unsafe-webgpu'],
});

const page = context.pages()[0] ?? (await context.newPage());
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('response', (res) => {
  // The app's OWN backends, and only those. A 4xx from somewhere on the wider internet is not this
  // deploy's business, and folding it in would make the check noisy enough to be ignored.
  //
  // ⚠️ `azurecontainerapps.io` ALONE LEFT HALF THE APP UNWATCHED. The plan store is not on the
  // container app at all — it is Fabric's SQL data plane on `*.pbidedicated.windows.net` — so an
  // anonymous visitor triggering a data-plane read produced a 401 in the browser console that this
  // check could not see, and reported "the backend refused nothing" while a backend was refusing.
  // Two backends means two origins to watch.
  const url = res.url();
  const ours = url.includes('azurecontainerapps.io') || url.includes('pbidedicated.windows.net');
  if (res.status() >= 400 && ours) {
    refusedRequests.push(`${res.status()} ${res.request().method()} ${url}`);
  }
});

console.log(`\nverifying ${base}  (aoi: ${aoi})\n`);

console.log('backend:');
await checkBackendContract();

try {
  await page.goto(`${base}/?aoi=${aoi}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

  // The scene loads about 9 MB before it can claim anything. Wait for the handle rather than a
  // fixed sleep, so a slow network lengthens the wait instead of failing the run.
  await page.waitForFunction(() => Boolean(window.__campus), null, { timeout: 180_000 });
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => {
    const c = window.__campus;
    return {
      hasTerrain: c.hasTerrain,
      hasDrape: c.hasDrape,
      rastersShareOrientation: c.rastersShareOrientation,
      buildingCount: c.buildingCount,
      treeCount: c.treeCount,
      roomCount: c.roomCount,
      withCalendar: c.rooms?.distinct.withOccupancy ?? 0,
      neverBooked: c.rooms?.distinct.neverBooked ?? 0,
    };
  });

  console.log('scene:');
  check('terrain loaded', state.hasTerrain);
  check('orthophoto drape present', state.hasDrape);
  check('all rasters the same way up', state.rastersShareOrientation);
  check('LoD2 buildings', state.buildingCount > expect.buildings, `${state.buildingCount}`);
  check('vegetation', state.treeCount > expect.trees, `${state.treeCount}`);

  if (expect.rooms > 0) {
    check('indoor rooms', state.roomCount > expect.rooms, `${state.roomCount}`);
    // The code and the assets deploy separately, and only the code is content-hashed — a stale
    // `rooms.json` would ship silently behind a fresh bundle. These two numbers are the version
    // stamp of the data: before the empty-calendar fix they were 176 and 0.
    check('rooms with a calendar', state.withCalendar > expect.withCalendar, `${state.withCalendar}`);
    check('never-booked rooms counted', state.neverBooked > expect.neverBooked, `${state.neverBooked}`);

    // ⚠️ Counts come from the JSON, so they stay perfect while the MESH is destroyed. A clamped
    // Int16 vertex format once put all 2094 rooms on one point and every count above still passed.
    // Geometry needs a geometric assertion.
    const spread = await page.evaluate(() => {
      const rooms = window.__campus.rooms?.rooms ?? [];
      const seen = new Set();
      let minX = Infinity;
      let maxX = -Infinity;
      for (const room of rooms) {
        // ⚠️ THE LEVEL IS PART OF THE POSITION. Keyed on x,z alone this counted a real six-storey
        // building as duplication: Garching's surveyed interiors stack the same floor plan on
        // every level, so 684 of 3 922 rooms shared an x,z with a room above or below and the
        // ratio fell to 82.6%. OTH's mostly-generated plates do not stack that way, which is why
        // the omission survived. What this assertion exists to catch is a mesh COLLAPSED onto one
        // point — a clamped Int16 format once did exactly that to all 2 094 OTH rooms — and that
        // failure takes x, z AND level with it, so including the level keeps every tooth.
        seen.add(`${room.centre.x.toFixed(1)},${room.centre.z.toFixed(1)},${room.level ?? 0}`);
        minX = Math.min(minX, room.centre.x);
        maxX = Math.max(maxX, room.centre.x);
      }
      return { distinct: seen.size, total: rooms.length, spanX: maxX - minX };
    });
    check(
      'rooms are spread over the campus, not stacked on one point',
      spread.distinct > spread.total * 0.9 && spread.spanX > (expect.roomSpanM ?? 1500),
      `${spread.distinct}/${spread.total} distinct, ${Math.round(spread.spanX)} m across`
    );
  } else {
    check('no indoor rooms invented', state.roomCount === 0, `${state.roomCount}`);
  }

  // Pixels. A black campus and a lit one are the same DOM.
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="campus-canvas"]');
    const off = document.createElement('canvas');
    off.width = 240;
    off.height = 150;
    const ctx = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    let sum = 0;
    let dark = 0;
    const colours = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const luma = data[i] + data[i + 1] + data[i + 2];
      sum += luma;
      if (luma < 60) dark += 1;
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    const pixels = data.length / 4;
    return { mean: sum / pixels / 3, darkFraction: dark / pixels, colours: colours.size };
  });

  console.log('pixels:');
  check('ground is lit, not black', stats.mean > 45, `meanChannel ${stats.mean.toFixed(1)}`);
  check('not mostly dark', stats.darkFraction < 0.35, `dark ${(stats.darkFraction * 100).toFixed(1)}%`);
  check('a real scene, not flat fill', stats.colours > 500, `${stats.colours} colours`);

  console.log('interaction:');

  // The explode is animated on the GPU from uniforms, so the DOM cannot answer this. Only sites
  // with indoor data have anything to open.
  const hero = heroBuilding(aoi);
  if (hero) {
    await page.evaluate((code) => window.__campus.explodeBuilding(code), hero);
    await page.waitForFunction(() => window.__campus.explodeProgress() >= 0.999, null, {
      timeout: 30_000,
    });
    const opened = await page.evaluate(() => ({
      building: window.__campus.explodedBuilding(),
      progress: window.__campus.explodeProgress(),
    }));
    check('building opens fully', opened.progress >= 0.999, `progress ${opened.progress.toFixed(3)}`);
    check('the right building is open', opened.building === hero, `${opened.building}`);

    // ⚠️ AND THAT IT IS THE BUILDING WORTH OPENING. Opening a building proves the animation runs;
    // it says nothing about whether the floors being shown are surveyed or invented, and the hero
    // is chosen precisely because its interior is real. This is the assertion that would have
    // caught the join failing silently — the build once reported "0 vermessen, 8796 generiert"
    // while every count above stayed healthy.
    //
    // ⚠️ REAL means `measured` OR `plan`. Gebäude K's outlines now come from OTH's published CAD
    // sheets, which superseded 24 of the 25 OpenStreetMap ones — so a check that only counted
    // `measured` would have watched this building go from 25 to 1 and called it an improvement.
    const surveyed = await page.evaluate(async ([aoiId, code]) => {
      const res = await fetch(`/terrain/${aoiId}/rooms.json`);
      if (!res.ok) return -1;
      const meta = await res.json();
      const mine = meta.rooms.filter((r) => r.building === code);
      const perRoom = mine.filter(
        (r) => r.provenance === 'measured' || r.provenance === 'plan'
      ).length;
      if (perRoom > 0) return perRoom;
      // ⚠️ PROVENANCE IS NOT ALWAYS PER ROOM, and reading only the per-room field called 3 921
      // surveyed rooms fake. This repo stamps every room individually because its stock is mixed:
      // some traced from CAD, most generated. Campus-Insights' sites are uniform, so Garching
      // states it once for the file — "measured — OpenStreetMap Simple Indoor Tagging". Absence of
      // the per-room field means "see the file", not "invented".
      const declared = String(meta.provenance?.geometry ?? '');
      return /measured|survey/i.test(declared) ? mine.length : 0;
    }, [aoi, hero]);
    check('the opened building has real room outlines', surveyed > 0, `${surveyed} real`);
  }

  // Pressed, not clicked. There is no `drone-toggle` any more — the map and the drone were merged
  // into one camera and the button retired, so the way IN is a movement key. That makes the HUD
  // appearing the interface confirming the wheel and the drag have changed meaning.
  await page.waitForSelector('[data-testid="drone-hint"]', { timeout: 15_000 });
  await page.keyboard.down('r');
  await page.waitForTimeout(1500);
  const drone = await page.evaluate(() => ({
    hud: Boolean(document.querySelector('[data-testid="drone-hud"]')),
    altitude: document.querySelector('[data-testid="drone-altitude"]')?.textContent ?? '',
  }));
  await page.keyboard.up('r');
  check('flight mode opens from the keyboard', drone.hud);
  check('drone telemetry reads', /\d/.test(drone.altitude), drone.altitude || 'empty');
  await page.keyboard.press('Escape');

  await page.screenshot({ path: SHOT });

  /*
   * THE WEEK A PLANNER OPENS — last, because the drawer covers the bottom of the canvas and would
   * change the pixel statistics measured above.
   *
   * ⚠️ THIS EXISTS TO MAKE THE REFUSAL CHECK BELOW ABLE TO FIRE AT ALL. Opening the drawer is what
   * reaches the SECOND backend — Fabric's SQL data plane, where the saved plan lives — and until
   * this step existed the verifier walked only the campus, so no data-plane request was ever made
   * and watching that origin would have been coverage in name only.
   */
  if (expect.planner) {
    await page.getByTestId('rail-week').click();
    const drawer = page.getByTestId('calendar-panel');
    await drawer.waitFor({ state: 'visible', timeout: 30_000 });
    // Filled, not merely present: an empty grid is indistinguishable from a failed fetch, which is
    // the exact failure this whole file was written after.
    const entries = await page
      .locator('[data-testid^="calendar-entry-"]')
      .first()
      .waitFor({ state: 'visible', timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    check('the week opens and fills', entries);
    // The store read happens after the draft list comes back; give it time to be refused.
    await page.waitForTimeout(3000);
  }

  console.log('console:');
  check('no console errors', consoleErrors.length === 0, `${consoleErrors.length}`);
  for (const error of consoleErrors.slice(0, 5)) console.log(`        ${error}`);

  // Separate from the console check on purpose: a refused backend call is a specific, actionable
  // failure with a URL attached, and it should not have to be inferred from a generic error line.
  check(
    'the backend refused nothing',
    refusedRequests.length === 0,
    refusedRequests.length ? refusedRequests[0] : '0 refused'
  );
  for (const refused of refusedRequests.slice(0, 5)) console.log(`        ${refused}`);

  console.log(`\nscreenshot: ${SHOT}`);
} finally {
  await context.close();
}

if (failures.length) {
  console.log(`\nDEPLOY VERIFICATION FAILED (${failures.length}):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\ndeployed app renders correctly');
