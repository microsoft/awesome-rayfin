import { expect, type Page } from '@playwright/test';

/**
 * Opening a lens READOUT, which lives in the bottom drawer beside the week it describes.
 *
 * ⚠️ The table lenses (staffing, quality) moved out of the side panel; the occupancy lens did not.
 * The rule is about what each one IS: occupancy is a control that drives the twin — open a
 * building, pick a room, scrub the slider — and a drawer covering the campus would hide the thing
 * it steers. Staffing and quality are tables of people and cohorts, and the 384 px column wrapped
 * every row into a ribbon.
 */
export async function openReadout(page: Page) {
  const tab = page.getByTestId('drawer-tab-detail');
  const reopen = page.getByTestId('calendar-open');

  // ⚠️ WAIT FOR EITHER, THEN DECIDE. The first version asked `reopen.count()` immediately after
  // `goto`, which is a race with React mounting: on a cold run the count came back 0 before the
  // button existed, so the drawer was never opened and the helper then waited a full minute for a
  // tab that only renders inside an open drawer. It failed under load and passed in isolation,
  // which is the signature of a test bug rather than an app one.
  await expect(tab.or(reopen).first()).toBeVisible({ timeout: 60_000 });
  if (!(await tab.isVisible())) await reopen.click();

  await expect(tab).toBeVisible({ timeout: 60_000 });
  await tab.click();
  await expect(page.getByTestId('drawer-detail')).toBeVisible({ timeout: 30_000 });
}
