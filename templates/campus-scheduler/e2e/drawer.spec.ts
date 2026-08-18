import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The drawer's two tabs — the fix for "I don't get the difference between the three elements".
 *
 * The three lenses used to be named after the machinery (Belegung, Lehrdeputat, Planqualität) and
 * their readouts lived in a 384 px column on the far side of the screen from the week they
 * described. Now they are named after WHO the question is about — Räume, Lehrende, Studierende —
 * and each readout opens as a tab on the drawer, next to the grid.
 *
 * ⚠️ Räume deliberately does NOT move. It is a control, not a report: it opens buildings and picks
 * rooms on the twin, and a drawer covering the campus hides the thing it steers. This is asserted,
 * because "make everything consistent" is exactly the tidy-looking change that would break it.
 */

test.describe('Lens drawer', () => {
  test('names the lenses after who the question is about', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);

    await expect(page.getByTestId('lens-occupancy')).toContainText(/Räume/i);
    await expect(page.getByTestId('lens-staffing')).toContainText(/Lehrende/i);
    await expect(page.getByTestId('lens-quality')).toContainText(/Studierende/i);
  });

  test('opens the drawer on the lens you asked for, and keeps the week one click away', async ({
    page,
  }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);
    await page.waitForTimeout(9000);

    // ⚠️ Clicked, not deep-linked — and the distinction is load-bearing, see the test below.
    // One click has to reach the table: the first cut left the drawer shut, so picking "Lehrende"
    // looked like a dead button while the table rendered perfectly inside something closed.
    await page.getByTestId('lens-staffing').click();
    await expect(page.getByTestId('staffing-panel')).toBeVisible({ timeout: 60_000 });

    const week = page.getByTestId('drawer-tab-week');
    const detail = page.getByTestId('drawer-tab-detail');
    // The tab carries the lens's name, so it is obvious WHAT the second tab holds.
    await expect(detail).toContainText(/Lehrende/i);

    // The plan itself is never more than one click away from the analysis of it.
    await week.click();
    await expect(page.getByTestId('drawer-detail')).toBeHidden();
    await expect(page.getByTestId('calendar-subject')).toBeVisible();

    await detail.click();
    await expect(page.getByTestId('staffing-panel')).toBeVisible();
    await expect(page.getByTestId('calendar-subject')).toBeHidden();
  });

  test('a deep link to a lecturer lands on their WEEK, not on the lecturer table', async ({
    page,
  }) => {
    // ⚠️ THIS IS THE REGRESSION THE FIRST ATTEMPT SHIPPED. Revealing the readout was wired to lens
    // STATE rather than to a click, so it also fired on mount — and every link carrying a lens
    // (`?lens=staffing&teacher=…`, including the ones the lenses write themselves) threw the drawer
    // onto the analysis tab and hid the week it had just loaded. Fifteen tests caught it.
    //
    // The rule: a link to a PERSON means "show me their week"; only clicking "Lehrende" means
    // "show me the lecturer table".
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=staffing&teacher=M-T013');
    await waitForCampusReady(page);

    await expect(page.getByTestId('calendar-subject')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('drawer-detail')).toBeHidden();
  });

  test('keeps the room control beside the campus it drives', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=occupancy');
    await waitForCampusReady(page);
    await page.waitForTimeout(9000);

    // In the side panel, where the twin stays visible while you open a building.
    await expect(page.getByTestId('explode-K')).toBeVisible({ timeout: 30_000 });

    // ⚠️ And therefore NOT offered as a drawer tab. If this ever fails, someone has "unified" the
    // three lenses and buried the building picker under the campus it is meant to open.
    await expect(page.getByTestId('drawer-tab-detail')).toBeHidden();
  });
});
