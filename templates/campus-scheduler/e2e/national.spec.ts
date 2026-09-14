import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

// Read rather than `import`: Playwright's ESM loader rejects a plain JSON import without an
// import attribute, and the attribute syntax is not worth spending on one number.
const index = JSON.parse(
  readFileSync(join(process.cwd(), 'config', 'campus-index.json'), 'utf8')
) as { universities: unknown[] };

/**
 * The national view — the level of detail below a twin.
 *
 * ⚠️ WHAT THIS IS ACTUALLY PROTECTING IS THE LOAD BOUNDARY. The whole reason the map exists is
 * that fifty campuses cannot all be downloaded to look at one: the index is a few dozen kilobytes
 * of dots, and the terrain, buildings and rooms are fetched only for the university that gets
 * picked. A change that quietly starts loading a campus from the map would look identical in a
 * screenshot and undo the entire point, so the test asserts you are still on the map after
 * selecting.
 *
 * ⚠️ AND A DOT WITHOUT A TWIN MUST NOT OFFER A DOOR. Most of these universities are located but
 * not modelled. This repo has twice shipped a control that did nothing — a "Kalender öffnen"
 * button on a site with no timetable, lens cards that opened an empty panel — so the absence of
 * the enter button is asserted, not just the presence of the explanation.
 */

const SITE = '/?scheduler=oth&aoi=oth-regensburg';

// LMU: a built twin, reachable. Humboldt: located from OpenStreetMap, no twin.
const BUILT = 'HS132';
const UNBUILT = 'HS020';

async function openMap(page: import('@playwright/test').Page) {
  await page.goto(SITE);
  await waitForCampusReady(page);
  await page.getByTestId('site-menu-toggle').click();
  await page.getByTestId('open-national-map').click();
  await expect(page.getByTestId('national-map')).toBeVisible();
}

test('the map offers every university the app knows about, not just the built ones', async ({
  page,
}) => {
  await openMap(page);

  /*
    ⚠️ COUNTED AGAINST THE INDEX, NOT AGAINST A NUMBER TYPED HERE. The first version asserted 31
    and broke the moment the registry grew to 51 — which is a test failing for the data changing
    rather than for the app breaking, and the temptation then is to bump the number and move on.
    The property is "every university the app knows about has a dot", so the expected count comes
    from the same file the map renders. It still catches the failure worth catching: an index that
    silently narrows to the built sites collapses BOTH sides to four and the two id assertions
    below fail.
  */
  const dots = page.locator('[data-testid^="national-dot-"]');
  await expect(dots).toHaveCount(index.universities.length);
  await expect(page.getByTestId(`national-dot-${BUILT}`)).toBeVisible();
  await expect(page.getByTestId(`national-dot-${UNBUILT}`)).toBeVisible();
});

test('picking a dot does NOT load its campus — that is the whole point', async ({ page }) => {
  await openMap(page);

  await page.getByTestId(`national-dot-${BUILT}`).click();
  await expect(page.getByTestId('national-enter')).toBeVisible();

  // Still on the map, still on the university we arrived as. Selecting is not entering.
  await expect(page.getByTestId('national-map')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('aoi')).toBe('oth-regensburg');
});

test('a located university with no twin says so and offers no way in', async ({ page }) => {
  await openMap(page);

  await page.getByTestId(`national-dot-${UNBUILT}`).click();

  await expect(page.getByTestId('national-unbuilt')).toBeVisible();
  await expect(page.getByTestId('national-enter')).toHaveCount(0);
});

test('entering a built twin actually switches the university', async ({ page }) => {
  await openMap(page);

  await page.getByTestId(`national-dot-${BUILT}`).click();
  await page.getByTestId('national-enter').click();

  // switchAoi reloads, so this is a real navigation rather than a state change.
  await waitForCampusReady(page);
  expect(new URL(page.url()).searchParams.get('aoi')).toBe('lmu-muenchen');
  await expect(page.getByTestId('site-menu-toggle')).toContainText('LMU');
});
