import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Putting an opened building away.
 *
 * Until now the only exit was the `collapse-building` button in the sidebar — the wrong place to
 * look when the thing you want to dismiss is in the scene. The sibling repo took this complaint
 * twice from a real user ("closing the exploded view is somewhat complicated", and then "still not
 * closing if I click next to the buildings"), so it is fixed here before anyone hits it again.
 *
 * ⚠️ Every case asserts BOTH halves — that the building opened, and then that it closed. Asserting
 * only the close would pass just as happily if the building had never opened at all, which is the
 * easiest way to ship a broken feature with a green test.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

async function openBuilding(page: Page, aoi: string, code: string) {
  await page.goto(`/?aoi=${aoi}&building=${code}`);
  await waitForScene(page);
  await page.waitForFunction((c) => window.__campus?.explodedBuilding() === c, code, {
    timeout: 20_000,
  });
  // Let the opening flight finish, so the camera has actually ARRIVED. The close-on-exit rule
  // only arms once it has, and testing before that would test nothing.
  await page.waitForFunction(() => (window.__campus?.explodeProgress() ?? 0) > 0.99, null, {
    timeout: 20_000,
  });
}

const SITES = [
  // `away` is a focus place on the OTHER campus, comfortably past the close distance: Prüfeninger
  // Straße is some 4 km from Seybothstraße, the Klinikum 2.4 km from the Stammgelände.
  { aoi: 'oth-regensburg', building: 'K', away: 'pruefening', label: 'OTH Regensburg' },
  { aoi: 'lmu-muenchen', building: 'ax', away: 'klinikum', label: 'LMU München' },
];

for (const site of SITES) {
  test.describe(`Dismissing a building — ${site.label}`, () => {
    test('flying away closes it', async ({ page }) => {
      await openBuilding(page, site.aoi, site.building);

      // Leave. The camera is the thing that dismisses it, not a button in a panel.
      await page.evaluate((place) => window.__campus.focusPlace(place), site.away);

      await page.waitForFunction(() => window.__campus?.explodedBuilding() === null, null, {
        timeout: 20_000,
      });
    });

    test('staying put does NOT close it', async ({ page }) => {
      await openBuilding(page, site.aoi, site.building);

      // ⚠️ The mirror image of the test above, and the one that actually has teeth. A rule with no
      // hysteresis closes the building the moment the viewer orbits or nudges the camera; without
      // this case, "closes when you leave" could be satisfied by "closes always".
      await page.waitForTimeout(5000);
      expect(await page.evaluate(() => window.__campus?.explodedBuilding())).toBe(site.building);
    });
  });
}

test.describe('Dismissing a building — clicks', () => {
  test('clicking beside the building closes it', async ({ page }) => {
    await openBuilding(page, 'oth-regensburg', 'K');

    // Up and to the left: above the horizon, so the ray hits neither a room nor any pick volume.
    const box = (await page.getByTestId('campus-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.12);

    await page.waitForFunction(() => window.__campus?.explodedBuilding() === null, null,
      { timeout: 15_000 });
  });

  test('and takes the camera back out to where it came from', async ({ page }) => {
    /**
     * ⚠️ CLOSING USED TO STRAND THE VIEWER INSIDE. The floors came back together and the camera
     * stayed exactly where the dive had put it — a close, low shot of nothing in particular, with
     * no way back to the campus except flying out by hand. Putting a building away should undo the
     * whole act of opening it, and the camera is most of that act.
     */
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const before = await page.evaluate(() => window.__campus.cameraDebug());

    await page.getByTestId('explode-K').click();
    await page.waitForFunction(() => (window.__campus?.explodeProgress() ?? 0) > 0.99, null, {
      timeout: 20_000,
    });

    // It really did dive: otherwise "came back" would be trivially true.
    const inside = await page.evaluate(() => window.__campus.cameraDebug());
    const dived = Math.hypot(inside.pos[0] - before.pos[0], inside.pos[2] - before.pos[2]);
    expect(dived).toBeGreaterThan(200);

    const box = (await page.getByTestId('campus-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.12);
    await page.waitForFunction(() => window.__campus?.explodedBuilding() === null, null, {
      timeout: 15_000,
    });

    // The return flight takes about as long as the dive did.
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => window.__campus.cameraDebug());
          return Math.hypot(now.pos[0] - before.pos[0], now.pos[2] - before.pos[2]);
        },
        { timeout: 15_000 }
      )
      .toBeLessThan(30);
  });

  test('flying away does NOT drag the camera back', async ({ page }) => {
    /**
     * The mirror control, and the reason the restore is conditional. Without this case "close
     * returns the camera" would be satisfied by a version that yanks the viewer back to the
     * overview the moment they deliberately fly somewhere else — undoing their own navigation.
     */
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);
    const before = await page.evaluate(() => window.__campus.cameraDebug());

    await page.getByTestId('explode-K').click();
    await page.waitForFunction(() => (window.__campus?.explodeProgress() ?? 0) > 0.99, null, {
      timeout: 20_000,
    });

    await page.evaluate(() => window.__campus.focusPlace('pruefening'));
    await page.waitForFunction(() => window.__campus?.explodedBuilding() === null, null, {
      timeout: 20_000,
    });

    // ⚠️ WAIT FOR THE CAMERA TO STOP. The building closes the moment the flight crosses the close
    // range, which is mid-journey — sampling there measures the flight still running, not where
    // the viewer ended up. The first version of this test failed on exactly that.
    await expect
      .poll(
        async () => {
          const a = await page.evaluate(() => window.__campus.cameraDebug().pos);
          await page.waitForTimeout(400);
          const b = await page.evaluate(() => window.__campus.cameraDebug().pos);
          return Math.hypot(b[0] - a[0], b[2] - a[2]);
        },
        { timeout: 20_000 }
      )
      .toBeLessThan(5);

    // Prüfening is ~2.5 km from Galgenberg. Having flown there, the viewer stays there.
    const settled = await page.evaluate(() => window.__campus.cameraDebug());
    const backHome = Math.hypot(settled.pos[0] - before.pos[0], settled.pos[2] - before.pos[2]);
    expect(backHome).toBeGreaterThan(800);
  });

  test('the panel stops offering rooms once the scene closes it', async ({ page }) => {
    await openBuilding(page, 'oth-regensburg', 'K');
    // While open the panel offers a way back out of the building.
    await expect(page.getByTestId('collapse-building')).toBeVisible();

    await page.evaluate(() => window.__campus.focusPlace('pruefening'));
    await page.waitForFunction(() => window.__campus?.explodedBuilding() === null, null, {
      timeout: 20_000,
    });

    // If the scene and the panel disagree, the sidebar keeps listing rooms for a shut building.
    await expect(page.getByTestId('collapse-building')).toBeHidden();
    // And the link must stop naming it, too.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('building'), { timeout: 10_000 })
      .toBeNull();
  });
});
