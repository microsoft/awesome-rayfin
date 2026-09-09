import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { openReadout } from './readout';
import { worstOverloaded } from './staffingModel';

/**
 * The staffing lens — the Einsatzplanung question asked of this app's own plan.
 *
 * ⚠️ The point under test is COHERENCE, not the arithmetic. The sums are pinned in
 * `src/lenses/staffing/__tests__/staffingData.test.ts`; what a browser can prove and a unit test
 * cannot is that this is one application — that a lecturer picked in the side panel becomes the
 * subject of the week grid that was already on screen, rather than opening a second, parallel
 * staffing view.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

async function openStaffing(page: Page) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForScene(page);
  await page.getByTestId('lens-staffing').click();
  // The readout is a table, so it lives in the drawer beside the week rather than in the 384 px
  // side column that used to wrap every row of it.
  await openReadout(page);
  await expect(page.getByTestId('staffing-panel')).toBeVisible();
}

/**
 * The most overloaded lecturer at OTH — derived, never named.
 *
 * ⚠️ THIS USED TO BE THE LITERAL `IM-T029` AT 200%, and it rotted. When the room stock was
 * corrected (buildings with a published floor plan stopped having storeys invented on top of
 * them), the timetable re-placed and that lecturer fell to 6 of 20 SWS — so the test failed while
 * the lens was working perfectly, naming twelve genuinely overloaded people.
 *
 * The seed was never the point: this spec's own docstring says it tests COHERENCE, not arithmetic
 * (the sums are pinned in `staffingData.test.ts`). The shared derivation lives in
 * `./staffingModel`, because `deeplink.spec` had hard-coded the same two lecturers.
 */
async function worstAtOth(page: Page) {
  return worstOverloaded(page, 'oth-regensburg');
}

test.describe('Teaching load lens', () => {
  test('is offered alongside the existing lenses, in the same panel', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    // Same list, same column — a lens, not a tab rail and not a second tool.
    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    await expect(page.getByTestId('lens-staffing')).toBeVisible();
  });

  test('names the lecturers this plan overloads', async ({ page }) => {
    await openStaffing(page);

    const over = page.getByTestId('staffing-over');
    await expect(over).toBeVisible();

    // Whoever the plan actually overloads must be named, and named FIRST: the list is a queue of
    // decisions, so its order is part of the answer.
    const worst = await worstAtOth(page);
    await expect(page.getByTestId(`staffing-lecturer-${worst.teacherId}`)).toBeVisible();
    await expect(over.locator('li').first()).toContainText(worst.name);
  });

  test('reports unused contracted capacity as well as overload', async ({ page }) => {
    await openStaffing(page);
    // An overload list alone would make the plan look merely busy. Three lecturers hold no course
    // at all, which is the other half of the same imbalance.
    await expect(page.getByTestId('staffing-idle')).toBeVisible();
  });

  test('withholds the professorial quota instead of reporting a meaningless 100%', async ({
    page,
  }) => {
    await openStaffing(page);
    // Every lecturer in this dataset is a professor, so the accreditation quota would be 100% by
    // construction. Saying so is the honest output; a green badge would not be.
    await expect(page.getByTestId('staffing-no-quota')).toBeVisible();
  });

  test('picking a lecturer hands the drawer back to THEIR week', async ({ page }) => {
    await openStaffing(page);

    const worst = await worstAtOth(page);
    await page.getByTestId(`staffing-lecturer-${worst.teacherId}`).click();

    // ⚠️ The finding and its evidence now share one drawer, so this asserts the HANDOVER: the
    // table gives way to the week it just scoped. Before this, the click changed scope and key
    // correctly under a still-visible table and the loaded week sat one tab away, unseen — which
    // reads exactly like a dead button.
    await expect(page.getByTestId('drawer-detail')).toBeHidden();
    await expect(page.getByTestId('calendar-scope-teacher')).toBeVisible();

    // And it must fill: an empty grid is indistinguishable from a failed fetch.
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });

    // Both surfaces on screen at once, for reviewing that they read as one application.
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'C:/Users/alkorn/repos/temp/staffing-lens.png' });
  });
});
