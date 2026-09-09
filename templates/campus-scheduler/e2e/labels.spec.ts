import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Clicking a name on the map.
 *
 * ⚠️ THE LABELS USED TO DO NOTHING AT ALL, which is the worst of the available options: they are
 * the most obviously clickable thing on the screen, they are real DOM, and they name exactly the
 * objects the app is about. Now every one of them does the most useful thing that name can do —
 * and which of the two that is comes from the data, not from the label:
 *
 *   * a building this dataset has rooms for → open it, exactly as clicking the building does
 *   * a campus outline, or a building with no rooms → fly there and say what it is
 *
 * The second case is the one worth protecting. Guessing a nearby building for a campus name would
 * open an arbitrary building and present it as the campus — which is precisely what the first
 * version did, because "Campus Prüfeninger Straße" happens to stand 60 m from building `d`.
 */

async function waitForScene(page: Page) {
  /*
   * ⚠️ WAIT FOR REACT, NOT JUST FOR THE SCENE. `window.__campus` is published from inside the scene
   * builder, BEFORE the promise resolves and before `TwinShell` runs the effect that registers
   * `onBuildingPicked` / `onPlacePicked`. Clicking a label in that window reaches a scene with no
   * handlers attached and does nothing at all — which is why the same click passed in one test and
   * failed in the next depending on how many round-trips happened to precede it.
   *
   * The loading overlay is the right signal because it lifts on the SAME commit that wires the
   * handlers: `setReady(true)` and `onReady(created)` are called together. It is therefore also
   * exactly the moment a real user can first click, which is why the race never reaches them.
   *
   * That reasoning is now in `waitForCampusReady`, which every spec shares. It was correct here
   * and nowhere else for a long time, and the rest of the suite paid for it.
   */
  await waitForCampusReady(page);
}

const clickLabel = (page: Page, id: string) =>
  page.evaluate((placeId) => {
    // Clicked through the DOM rather than by coordinates: at overview zoom the declutterer hides
    // labels that collide, and a test that could only reach the visible ones would quietly cover
    // a shrinking subset as the map got busier.
    document.querySelector<HTMLElement>(`[data-place="${placeId}"]`)?.click();
  }, id);

test.describe('Clicking a map label', () => {
  test('a named building opens, the same way clicking the building does', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await clickLabel(page, 'informatik');

    // "Fakultät Informatik und Mathematik" is Gebäude K — the one building with surveyed rooms.
    await expect
      .poll(() => page.evaluate(() => window.__campus?.explodedBuilding()), { timeout: 20_000 })
      .toBe('K');
    await expect(page.getByTestId('place-note')).toHaveCount(0);
  });

  test('and the camera goes there', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const centre = await page.evaluate(() => {
      const b = window.__campus.rooms?.buildings.find((x) => x.code === 'K');
      return b ? [b.centre.x, b.centre.z] : null;
    });
    expect(centre).not.toBeNull();

    await clickLabel(page, 'informatik');
    await page.waitForFunction(() => (window.__campus?.explodeProgress() ?? 0) > 0.99, null, {
      timeout: 20_000,
    });

    const target = await page.evaluate(() => window.__campus.cameraDebug().target);
    expect(Math.hypot(target[0] - centre![0], target[2] - centre![1])).toBeLessThan(120);
  });

  test('a CAMPUS name explains itself instead of opening one arbitrary building', async ({
    page,
  }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await clickLabel(page, 'pruefening');

    const note = page.getByTestId('place-note');
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('place-note-name')).toContainText('Prüfeninger');

    // ⚠️ THE ASSERTION THAT MATTERS. Building `d` stands 60 m from this label, and the first
    // version opened it — a plausible-looking answer to a question nobody asked.
    expect(await page.evaluate(() => window.__campus?.explodedBuilding())).toBeNull();

    // It says it is a campus, not that something is missing.
    await expect(page.getByTestId('place-note-body')).toContainText(/Campus-Umriss|campus outline/i);
  });

  test('a real building with no rooms says so, and cites where it comes from', async ({ page }) => {
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    // Tierärztliche Fakultät is genuinely LMU's and genuinely carries no teaching rooms here.
    await clickLabel(page, 'tiermedizin');

    const note = page.getByTestId('place-note');
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('place-note-body')).toContainText(/keine Räume|no rooms/i);

    // The OSM id is the evidence that the place is real rather than a gap in the data.
    await expect(note.getByRole('link')).toHaveAttribute('href', /openstreetmap\.org\/(way|relation|node)\/\d+/);
  });

  test('the note can be dismissed', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await clickLabel(page, 'pruefening');
    await expect(page.getByTestId('place-note')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('place-note-close').click();
    await expect(page.getByTestId('place-note')).toHaveCount(0);
  });

  test('every label on both universities does SOMETHING', async ({ page }) => {
    /*
     * The regression this whole feature is about. A label that resolves to neither a building nor a
     * note is a dead click, and dead clicks are invisible: nothing errors, nothing logs, the user
     * simply learns the map does not respond.
     */
    for (const aoi of ['oth-regensburg', 'lmu-muenchen']) {
      await page.goto(`/?aoi=${aoi}`);
      await waitForScene(page);

      const ids = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.gs-label')].map((n) => n.dataset.place ?? '')
      );
      expect(ids.length).toBeGreaterThan(8);

      for (const id of ids) {
        await clickLabel(page, id);
        await expect
          .poll(
            async () =>
              page.evaluate(
                () =>
                  Boolean(window.__campus?.explodedBuilding()) ||
                  Boolean(document.querySelector('[data-testid="place-note"]'))
              ),
            { timeout: 15_000 }
          )
          .toBe(true);

        await page.evaluate(() => {
          window.__campus?.explodeBuilding(null, false);
          document.querySelector<HTMLElement>('[data-testid="place-note-close"]')?.click();
        });
      }
    }
  });
});
