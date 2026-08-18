// record-campus.mjs — Campus-Insights walkthrough, timed to the voice-over (~68 s).
//
// Stage A of a two-stage workflow. This is the SLOW step: it drives the deployed app and writes
// a raw .webm. Re-run it only when the VISUALS or the beats change. Narration, voice, pacing and
// the GIF window are all iterated in stage B (build-campus.ps1) against the same raw file, which
// takes seconds instead of minutes.
//
// Why it is built this way:
//
//   * Playwright recordVideo (a CDP screencast) captures the browser compositor, so the WebGL
//     canvas records properly. Desktop/gdigrab capture yields black frames for WebGL.
//   * Edge channel + a signed-in persistent profile, because the app sits behind Fabric auth.
//     Vanilla Chromium is blocked by Conditional Access.
//   * The explode is driven through window.__campus rather than by clicking the building.
//     A real click also switches the side panel to the occupancy lens, which hides the room
//     counts the narration is reading out at that exact moment.
//
// KNOWN: pre-warming does NOT make the site switch instant. Even with Tuebingen already loaded
// once, swapping AOI tears down and rebuilds the scene and the canvas goes black for ~7 s. The
// wait below is sized to contain that, and build-campus.ps1 cuts the dead window out. Do not
// assume a warmed site switches cleanly.
import { chromium } from 'playwright-core';

// ⚠️ NO PERSONAL PATHS AND NO PERSONAL ACCOUNT. All three of these used to default to one
// machine's directory layout and one person's tenant sign-in, which made the recorder a script
// only its author could run — and put a UPN into every clone of this repository.
const PROFILE = process.env.CAMPUS_REC_PROFILE ?? './.rec/profile';
const OUT = process.env.CAMPUS_REC_OUT ?? './.rec/';
// ⚠️ NO DEFAULT HOST. This used to fall back to one particular Fabric deployment, so a clone of
// this repository would silently record somebody else's app. Recording is against a URL you chose;
// say which.
const BASE = process.env.CAMPUS_REC_BASE;
if (!BASE) {
  console.error('Set CAMPUS_REC_BASE to the app URL to record, e.g. http://localhost:5173');
  process.exit(2);
}
// Only used to pick the right tile on the Fabric account chooser when the profile holds more than
// one identity. Empty means "whatever this profile is already signed in as", which is the right
// default for a local run against `npx vite`.
const ACCOUNT = process.env.CAMPUS_REC_ACCOUNT ?? '';
const W = 1600, H = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function picker(page) {
  // ⚠️ `getByText('')` MATCHES EVERYTHING. With no account named there is no chooser to answer,
  // and clicking the first thing on the page is how a recorder navigates away from the app it was
  // pointed at. Nothing to do is the correct behaviour, not a degraded one.
  if (!ACCOUNT) return;
  for (let i = 0; i < 3; i++) {
    const a = page.getByText(ACCOUNT, { exact: false });
    if (await a.count()) { await a.first().click().catch(() => {}); await sleep(5000); }
  }
}

async function open(page, aoi, wait) {
  await page.goto(`${BASE}/?aoi=${aoi}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await picker(page);
  await page.waitForFunction(() => Boolean(window.__campus), null, { timeout: 180000 }).catch(() => {});
  await sleep(wait);
}

const call = (page, fn) => page.evaluate(fn).catch(() => {});

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    channel: 'msedge',
    viewport: { width: W, height: H },
    args: ['--window-position=30,20', '--window-size=1620,1000', '--hide-crash-restore-bubble'],
    recordVideo: { dir: OUT + 'out', size: { width: W, height: H } },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.bringToFront().catch(() => {});

  // Warm both sites. This does not remove the switch cost (see above) but it does stop the
  // 27 MB Tuebingen payload from being downloaded during the walk.
  log('warm tuebingen');
  await open(page, 'tuebingen', 9000);
  log('warm garching');
  await open(page, 'garching', 9000);

  // ================= CLEAN WALK (VO-synced, ~68 s) =================
  // The log lines below are the cut points build-campus.ps1 is derived from. Keep them.
  log('WALK-START ' + (Date.now() - t0));

  // 0.0-5.5  "This is Campus Insights..."
  await sleep(5500);

  // 5.5-20.5 "Everything you can see is measured..." — one slow move so it is not a still frame.
  await call(page, () => window.__campus.focusPlace('mw'));
  await sleep(8000);
  await call(page, () => window.__campus.focusPlace('garching'));
  await sleep(6500);

  // 20.5-24.5 "Click a building, and it opens."
  log('explode 5506');
  await call(page, () => window.__campus.explodeBuilding('5506'));
  await sleep(4000);

  // 24.5-39.5 the room figures, read out while the default panel shows 3 921 / 310 / 134.
  await sleep(15000);

  // 39.5-46 "Campus Flow routes real lecture cohorts..."
  log('flow lens');
  await call(page, () => window.__campus.explodeBuilding(null));
  await sleep(1200);
  await call(page, () => window.__campus.focusPlace('garching'));
  await page.getByTestId('lens-flow').click().catch(() => {});
  await sleep(5300);

  // 46-58.5 "Now switch site..." — expect a black canvas for part of this.
  log('-> tuebingen');
  await open(page, 'tuebingen', 6500);
  await call(page, () => window.__campus.focusPlace('platanenallee'));
  await sleep(6000);

  // 58.5-66.5 "Here the question is the renovation backlog..."
  log('condition lens');
  await page.getByTestId('lens-condition').click().catch(() => {});
  await sleep(3500);
  await page.getByTestId('condition-year-slider').fill('2033').catch(() => {});
  await sleep(2000);
  await page.getByTestId('condition-year-slider').fill('2040').catch(() => {});
  await sleep(2500);

  // 66.5-68.5 "Measured where it can be. Labelled where it cannot."
  // Keep rolling past WALK-END: the settled Altstadt shot after this marker is the best frame
  // in the take and the finished cut uses it.
  await sleep(2000);
  log('WALK-END ' + (Date.now() - t0));

  await sleep(9000);
  await ctx.close();
  log('done');
})();
