import { expect, test } from '@playwright/test';

/**
 * The loading indicator — why the map is making you wait.
 *
 * Tens of megabytes of terrain, aerial photograph, LoD2 buildings and trees have to arrive before
 * the canvas shows anything. Until they do it is an empty rectangle, which reads as a broken page
 * rather than a loading one, and the first thing a viewer does with a broken page is reload it —
 * starting the download again.
 *
 * ⚠️ THE LOADING STATE IS A RACE BY NATURE, so these tests do not try to catch it. Assets are
 * delayed deliberately, which makes the assertions deterministic AND tests the case that actually
 * matters: the slow connection, where a blank screen is least forgivable. Without the delay this
 * spec would pass or fail depending on the disk cache.
 */

/** Hold every terrain asset back so the loading state is observable rather than incidental. */
const slowAssets = async (page: import('@playwright/test').Page, ms: number) => {
  await page.route('**/terrain/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
};

test('says what it is loading instead of showing an empty canvas', async ({ page }) => {
  await slowAssets(page, 400);
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');

  const overlay = page.getByTestId('twin3d-loading');
  await expect(overlay).toBeVisible({ timeout: 20_000 });

  // A bare spinner would satisfy "something is happening". The point of this panel is to answer
  // WHY the wait is happening, so it has to name the thing being fetched.
  const stage = page.getByTestId('twin3d-loading-stage');
  await expect(stage).not.toBeEmpty();

  // And the stage must be a real one from the loader, not a hardcoded string that would keep
  // saying "connecting" through a two-minute download.
  await expect
    .poll(async () => overlay.getAttribute('data-stage'), { timeout: 30_000 })
    .not.toBe('starting');
});

test('reports progress that actually advances', async ({ page }) => {
  await slowAssets(page, 250);
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');

  const bytes = page.getByTestId('twin3d-loading-bytes');
  await expect(bytes).toBeVisible({ timeout: 20_000 });

  // ⚠️ Asserting the counter MOVES, not merely that it exists. A byte counter stuck on 0.0 MB is
  // exactly as uninformative as no counter, and is what a mis-wired reporter produces.
  const readings = new Set<string>();
  await expect
    .poll(
      async () => {
        const text = (await bytes.textContent())?.trim() ?? '';
        if (text) readings.add(text);
        return readings.size;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(1);
});

test('gets out of the way once the campus is up', async ({ page }) => {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');

  // The overlay covers the whole canvas, so failing to dismiss it would hide the finished scene —
  // a worse outcome than never having shown it.
  await expect(page.getByTestId('twin3d-loading')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId('campus-canvas')).toBeVisible();
});
