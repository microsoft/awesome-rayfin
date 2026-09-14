import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The side panel and the way in to the interiors.
 *
 * ⚠️ These exist because the exploded interiors were reported as "not implemented" while the
 * feature worked end to end. The camera flew, the floors opened, the rooms rendered — but the
 * only way to reach any of it was to open a lens first, and nothing said so. A feature nobody
 * can find is indistinguishable from a feature that is missing, so the reachability is now
 * asserted rather than the mechanism alone.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  // Terrain, drape, buildings, vegetation and rooms come to roughly 20 MB for this AOI.
  await page.waitForTimeout(9000);
}

test.describe('Side panel', () => {
  test('opens on a lens, so the building picker is reachable without a hunt', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    // No click required: the first implemented lens is already open.
    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    await expect(page.getByTestId('explode-K')).toBeVisible();
  });

  test('opening a building moves the camera to it', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const centre = await page.evaluate(() => {
      const b = window.__campus.rooms?.buildings.find((x) => x.code === 'K');
      return b ? [b.centre.x, b.centre.z] : null;
    });
    expect(centre).not.toBeNull();

    await page.getByTestId('explode-K').click();
    await page.waitForFunction(() => window.__campus.explodeProgress() >= 0.999, null, {
      timeout: 30_000,
    });

    // ⚠️ Progress alone is NOT enough. The floors can be fully open while the camera looks at the
    // other campus 2.5 km away, which is exactly what "the explosion is not there" looked like.
    const target = await page.evaluate(() => window.__campus.cameraDebug().target);
    const distance = Math.hypot(target[0] - centre![0], target[2] - centre![1]);
    expect(distance).toBeLessThan(120);
  });

  test('rooms occupy distinct positions across the campus', async ({ page }) => {
    // ⚠️ THE TEST THAT WAS MISSING.
    //
    // `rooms.bin` packed Int16 and CLAMPED anything out of range. Scene coordinates reach ±1.5 km,
    // so at 1 cm quantisation every vertex saturated at 32767 and all 2094 rooms collapsed onto a
    // single point — degenerate triangles, nothing visible when a building opened. Every count in
    // the app stayed correct throughout, because counts come from the JSON rather than the mesh,
    // so both the panel and the deploy verifier reported a healthy 2094 rooms.
    //
    // Geometry has to be asserted as geometry: distinct positions, and a spread that matches a
    // real campus rather than a point.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const stats = await page.evaluate(() => {
      const layer = window.__campus.rooms!;
      const seen = new Set<string>();
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const room of layer.rooms) {
        seen.add(`${room.centre.x.toFixed(1)},${room.centre.z.toFixed(1)}`);
        minX = Math.min(minX, room.centre.x);
        maxX = Math.max(maxX, room.centre.x);
        minZ = Math.min(minZ, room.centre.z);
        maxZ = Math.max(maxZ, room.centre.z);
      }
      return { total: layer.rooms.length, distinct: seen.size, spanX: maxX - minX, spanZ: maxZ - minZ };
    });

    // Rooms on different levels legitimately share a footprint, so this is not 1:1 — but it must
    // be most of them, not two.
    expect(stats.distinct).toBeGreaterThan(stats.total * 0.9);
    // The two campuses are 2.48 km apart, so the room stock cannot fit inside a few hundred metres.
    expect(stats.spanX).toBeGreaterThan(1500);
    expect(stats.spanZ).toBeGreaterThan(500);
  });

  test('a building modelled below its own height says so, and a complete one does not', async ({
    page,
  }) => {
    /*
     * ⚠️ THIS TEST NOW USUALLY PROVES THE ABSENCE, AND THAT IS THE POINT.
     *
     * It was written when Prüfening's six buildings held one modelled storey of three, because a
     * published ground-floor plan suppressed every invented floor above it — so opening one showed
     * sixteen plates in a dimmed void and the app said nothing about why. The note explained it.
     *
     * That suppression has since been undone: a plan for one floor no longer removes the others,
     * so every building at both generated sites is modelled to its full height and the note has no
     * subject. Rather than delete the mechanism — a future dataset can go partial again, and then
     * this is the difference between an explanation and an empty building — the test reads the
     * model and asserts whichever case the data actually presents. The negative half is the one
     * with teeth today: a note that appeared on a complete building would be a lie on screen.
     */
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&building=a');
    await waitForScene(page);

    const partial = await page.evaluate(
      () => window.__campus.rooms?.meta?.levelCoverage?.byBuilding ?? {}
    );
    const codes = Object.keys(partial);

    if (codes.length === 0) {
      // Every building is modelled to its full height: nothing may claim otherwise, anywhere.
      await expect(page.getByTestId('partial-building')).toHaveCount(0);
      const complete = await page.evaluate(
        () => (window.__campus.rooms?.buildings ?? []).map((b) => b.code)[0]
      );
      await page.goto(`/?scheduler=oth&aoi=oth-regensburg&building=${complete}`);
      await waitForScene(page);
      await expect(page.getByTestId('partial-building')).toHaveCount(0);
      return;
    }

    // Some building IS partial — it must say so, with the real figures, and only it.
    await page.goto(`/?scheduler=oth&aoi=oth-regensburg&building=${codes[0]}`);
    await waitForScene(page);
    const note = page.getByTestId('partial-building');
    await expect(note).toBeVisible();
    await expect(note).not.toHaveText(/^occupancy\./);
    await expect(note).toContainText(String(partial[codes[0]].modelled));
    await expect(note).toContainText(String(partial[codes[0]].levels));

    const complete = await page.evaluate((names) => {
      return (window.__campus.rooms?.buildings ?? [])
        .map((b) => b.code)
        .find((code) => !names.includes(code));
    }, codes);
    expect(complete, 'every building is partial — the control has nothing to stand on').toBeTruthy();
    await page.goto(`/?scheduler=oth&aoi=oth-regensburg&building=${complete}`);
    await waitForScene(page);
    await expect(page.getByTestId('partial-building')).toHaveCount(0);
  });

  test('collapses out of the way and comes back', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await expect(page.getByTestId('side-panel')).toBeVisible();
    await page.getByTestId('panel-collapse').click();
    await expect(page.getByTestId('side-panel')).toBeHidden();

    // Collapsing must not be a one-way door.
    await expect(page.getByTestId('panel-open')).toBeVisible();
    await page.getByTestId('panel-open').click();
    await expect(page.getByTestId('side-panel')).toBeVisible();
  });

  test('drags wider and remembers the width', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const before = (await page.getByTestId('side-panel').boundingBox())!.width;

    const handle = (await page.getByTestId('panel-resize').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 180, handle.y + handle.height / 2, { steps: 12 });
    await page.mouse.up();

    const after = (await page.getByTestId('side-panel').boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 100);

    // The layout choice has to survive a reload, or it is friction rather than a setting.
    await page.reload();
    await waitForCampusReady(page);
    const reloaded = (await page.getByTestId('side-panel').boundingBox())!.width;
    expect(Math.abs(reloaded - after)).toBeLessThan(8);
  });
});
