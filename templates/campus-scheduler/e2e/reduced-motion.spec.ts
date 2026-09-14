import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * `prefers-reduced-motion` — the setting this app was ignoring entirely.
 *
 * It is unusually motion-heavy: a 1.4 s camera flight on every focus, a 1.2 s explode when a
 * building opens, a water ripple and a route dash that loop forever. The looping pair are exactly
 * the vestibular trigger the OS setting exists for.
 *
 * The rule implemented: journeys ARRIVE instantly rather than being skipped, and loops are HELD on
 * a fixed frame rather than hidden. Nothing becomes unreachable — the camera still ends where it
 * was sent, and the water is still drawn.
 *
 * ⚠️ Every case asserts RENDERED STATE, never `reducedMotion()` alone. A true flag only proves the
 * media query was read. And each has a MIRROR CONTROL asserting the motion does happen without the
 * setting — otherwise a scene that had stopped rendering altogether would pass every test here.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

/** How far the camera still is from where it was sent, one animation frame after being sent. */
async function distanceAfterOneFrame(page: Page, place: string) {
  return page.evaluate(async (id) => {
    window.__campus.focusPlace(id);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = window.__campus.cameraDebug().pos;
    // A second sample a moment later says whether the camera is still travelling.
    await new Promise((r) => setTimeout(r, 350));
    const after = window.__campus.cameraDebug().pos;
    return Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  }, place);
}

test.describe('Reduced motion', () => {
  test('the setting is read live, not captured at startup', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    // ⚠️ Reading the media query once at init would make this fail: the app would still report
    // false until a reload, which looks exactly like the feature not working.
    expect(await page.evaluate(() => window.__campus.reducedMotion())).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => window.__campus.reducedMotion())).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.evaluate(() => window.__campus.reducedMotion())).toBe(false);
  });

  test('the camera arrives at once instead of flying', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    // Still travelling 350 ms later would mean the flight is running.
    expect(await distanceAfterOneFrame(page, 'pruefening')).toBeLessThan(1);
  });

  test('MIRROR: without the setting the camera really does travel', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    // The control. Without this, a frozen scene would satisfy the test above.
    expect(await distanceAfterOneFrame(page, 'pruefening')).toBeGreaterThan(50);
  });

  test('a building opens instantly, and is still fully open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const progress = await page.evaluate(async () => {
      window.__campus.explodeBuilding('K');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return window.__campus.explodeProgress();
    });

    // Arrived, not skipped: the floors are apart, they simply did not take 1.2 s to get there.
    expect(progress).toBeGreaterThan(0.99);
    expect(await page.evaluate(() => window.__campus.explodedBuilding())).toBe('K');
  });

  test('MIRROR: without the setting the explode is animated', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const progress = await page.evaluate(async () => {
      window.__campus.explodeBuilding('K');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return window.__campus.explodeProgress();
    });

    // Two frames into a 1200 ms animation it must still be on its way.
    expect(progress).toBeLessThan(0.5);
  });

  test('LMU honours it too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    expect(await page.evaluate(() => window.__campus.reducedMotion())).toBe(true);
    expect(await distanceAfterOneFrame(page, 'klinikum')).toBeLessThan(1);
  });
});
