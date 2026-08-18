import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Performance budgets — the ceilings that decide whether this opens on the stand.
 *
 * Recovered from Campus-Insights during the merge. Campus-Scheduler had inherited that repo's
 * AOIs, its scenes and its geodata pipeline, but NOT its budgets: `textureBytes()` and
 * `firstFrameMs()` had been dropped from the scene handle, so the four-university build was
 * shipping with no measurement of the resource that actually breaks a demo laptop.
 *
 * ⚠️ THREE QUANTITIES THAT FAIL DIFFERENTLY, WHICH IS WHY THERE ARE THREE BUDGETS.
 *
 *  * **transferred bytes** — what the network waits for. Deterministic.
 *  * **texture memory** — what the GPU holds. A drape arrives as a few MB of JPEG and unpacks to
 *    tens of MB of RGBA, so a download budget CANNOT see it. This is the number that decides
 *    whether the tab survives on integrated graphics.
 *  * **time to first frame** — what the viewer waits for. Not deterministic; see below.
 *
 * Measured 2026-08-05 against the dev server, all four AOIs warm:
 *
 *   oth-regensburg  transferred 25.1 MB   texture 82.7 MB   first frame 8.52 s (cold, first run)
 *   lmu-muenchen    transferred 41.6 MB   texture 83.0 MB   first frame 2.21 s
 *   garching        transferred 13.2 MB   texture 67.5 MB   first frame 1.33 s
 *   tuebingen       transferred 24.9 MB   texture 77.8 MB   first frame 1.47 s
 *
 * Garching's 67.5 MB and Tübingen's 77.8 MB reproduce Campus-Insights' own 2026-07-31 figures to
 * the decimal, which is the evidence that the estimator came across intact rather than merely
 * compiling.
 *
 * ⚠️ THERE IS NO JAVASCRIPT BUNDLE BUDGET HERE, AND THAT IS DELIBERATE. Campus-Insights had one.
 * Against this repo's dev server every `.js` entry reports `transferSize === 0`, so the same
 * assertion passes at 0.00 MB no matter how large the bundle grows — it would be a test that can
 * only pass. A budget that flatters itself is worse than no budget, so it is left out rather than
 * shipped green. Restoring it means measuring a built `dist/`, not a dev server.
 */

/** Transferred-byte ceilings, ~1.25x measured. */
const assetBudgets = [
  { aoi: 'oth-regensburg', megabytes: 31 },
  { aoi: 'lmu-muenchen', megabytes: 52 },
  { aoi: 'garching', megabytes: 17 },
  // Tübingen is heavier by design: 6 417 medieval buildings against Garching's 353. AOIs load
  // lazily, so this costs Garching nothing.
  { aoi: 'tuebingen', megabytes: 31 },
];

/**
 * Texture ceilings, ~1.2x measured.
 *
 * Far below what re-baking a drape at 8192 px would cost — that is a 4x on the largest single
 * allocation in the app, and it is the regression this exists to catch.
 */
const textureBudgets = [
  { aoi: 'oth-regensburg', megabytes: 100 },
  { aoi: 'lmu-muenchen', megabytes: 100 },
  { aoi: 'garching', megabytes: 80 },
  { aoi: 'tuebingen', megabytes: 95 },
];

/**
 * ⚠️ THIS CEILING IS A CATASTROPHE DETECTOR, NOT A TARGET, AND IT MUST NOT BE TIGHTENED.
 *
 * Warm, every AOI draws in 1.3-2.2 s. The very first run of a session measured 8.52 s for OTH
 * while the dev server was still warming — same build, same machine, 6x the number. Campus-Insights
 * recorded a 15.4 s outlier for Tübingen that never reproduced and whose cause was never found.
 *
 * A tight ceiling here would flake, and a flaky performance test gets deleted, after which nothing
 * is measured at all. The lesson is worth more than the metric: **one sample is not a measurement.**
 */
const FIRST_FRAME_CEILING_S = 30;

async function waitForFirstFrame(page: Page) {
  await waitForCampusReady(page);
  await page.waitForFunction(
    () => {
      const api = (window as unknown as { __campus?: { firstFrameMs(): number | null } }).__campus;
      return Boolean(api && api.firstFrameMs() !== null);
    },
    undefined,
    { timeout: 60_000 }
  );
  // The drape and the room geometry arrive after the first frame; the texture figure is only
  // meaningful once they have.
  await page.waitForTimeout(6000);
}

test.describe('Performance budget', () => {
  for (const { aoi, megabytes } of assetBudgets) {
    test(`${aoi} stays inside its asset budget`, async ({ page }) => {
      await page.goto(`/?aoi=${aoi}`);
      await waitForFirstFrame(page);

      const transferred = await page.evaluate(() =>
        (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).reduce(
          (sum, entry) => sum + (entry.transferSize || 0),
          0
        )
      );

      const mb = transferred / 1e6;
      expect(mb, `${aoi} transferred ${mb.toFixed(1)} MB`).toBeLessThan(megabytes);
      // A near-zero total means the assets did not load at all, and every other assertion here
      // would be measuring an empty scene rather than a working one.
      expect(mb, `${aoi} transferred almost nothing`).toBeGreaterThan(1);
    });
  }

  for (const { aoi, megabytes } of textureBudgets) {
    test(`${aoi} stays inside its texture-memory budget`, async ({ page }) => {
      await page.goto(`/?aoi=${aoi}`);
      await waitForFirstFrame(page);

      const bytes = await page.evaluate(
        () =>
          (window as unknown as { __campus: { textureBytes(): number } }).__campus.textureBytes()
      );
      const mb = bytes / 1e6;
      expect(mb, `${aoi} holds ${mb.toFixed(1)} MB of texture`).toBeLessThan(megabytes);
      // Same guard as above: a near-zero figure means the rasters never arrived.
      expect(mb, `${aoi} holds almost no texture`).toBeGreaterThan(5);
    });
  }

  for (const { aoi } of assetBudgets) {
    test(`${aoi} draws its first frame before the viewer gives up`, async ({ page }) => {
      await page.goto(`/?aoi=${aoi}`);
      await waitForFirstFrame(page);

      const ms = await page.evaluate(
        () =>
          (window as unknown as { __campus: { firstFrameMs(): number | null } }).__campus.firstFrameMs()
      );
      expect(ms, 'no frame was ever drawn').not.toBeNull();
      expect(
        (ms ?? 0) / 1000,
        `${aoi} first frame at ${((ms ?? 0) / 1000).toFixed(1)} s`
      ).toBeLessThan(FIRST_FRAME_CEILING_S);
    });
  }
});
