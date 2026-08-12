import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The played week, and the shuttle between the two campuses.
 *
 * Two claims worth a test, and neither is "a button exists":
 *
 *   * pressing play MOVES THE WEEK — the hour advances on its own, which is the whole point of a
 *     transport control and the thing a wired-up-but-dead button would fail
 *   * the shuttle MOVES ALONG THE ROAD — a vehicle that renders but never leaves the kerb looks
 *     identical to a working one in a screenshot, and only differs over time
 */

async function openOccupancy(page: import('@playwright/test').Page) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);
  await page.waitForFunction(() => Boolean(window.__campus?.rooms), null, { timeout: 60_000 });
  // The occupancy lens owns the clock, and it is the lens the app opens on.
  await expect(page.getByTestId('week-play')).toBeVisible({ timeout: 30_000 });
}

test.describe('Playing the week', () => {
  test('play advances the hour on its own, and pause stops it', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    const readHour = () => page.getByTestId('hour-slider').inputValue();

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'true');

    // One teaching hour per second, so a few seconds must move it. Polling rather than sleeping a
    // fixed time keeps this honest on a slow machine.
    const started = await readHour();
    await expect
      .poll(async () => readHour(), { timeout: 20_000 })
      .not.toBe(started);

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'false');

    // ⚠️ THE POINT OF THIS HALF. A pause that only greys the button leaves the clock running, and
    // the bug is invisible until someone watches the panel for a few seconds.
    const paused = await readHour();
    await page.waitForTimeout(3000);
    expect(await readHour(), 'the clock kept running after pause').toBe(paused);
  });

  test('dragging the slider takes over from the playback', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'true');

    // Scrubbing by hand while the loop is running used to fight it: the drag moved the hour and
    // the next frame moved it back.
    await page.getByTestId('hour-slider').fill('14');
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(2000);
    expect(await page.getByTestId('hour-slider').inputValue()).toBe('14');
  });

  test('the shuttle drives the road between the campuses', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    // Hidden until the week is playing: a bus parked in the road reads as one that has broken down.
    expect(
      await page.evaluate(() => window.__campus.shuttlePosition()),
      'the shuttle was on screen before anyone pressed play'
    ).toBeNull();

    await page.getByTestId('week-play').click();

    const first = await page.evaluate(() => window.__campus.shuttlePosition());
    expect(first, 'no shuttle after play — is drive-route.json built?').not.toBeNull();

    // It has to actually travel, not merely exist. The route is ~3 km, so a couple of seconds of
    // driving is tens of metres — far outside any jitter.
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => window.__campus.shuttlePosition());
          if (!now || !first) return 0;
          return Math.hypot(now.x - first.x, now.z - first.z);
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(25);
  });
});
