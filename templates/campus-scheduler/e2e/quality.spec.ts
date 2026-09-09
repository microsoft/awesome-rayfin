import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { openReadout } from './readout';

/**
 * Plan quality — REQUIREMENTS §5.1's last two rules, on screen for both universities.
 *
 * The app could already prove a plan is conflict-free. This is the other half of the planner's
 * question: is it any good to study under. What the browser can prove and a unit test cannot is
 * that the answer is reachable from the same panel and drives the same week grid.
 *
 * ⚠️ These also pin the HONESTY of the lens. It deliberately measures whole-cohort lecture days
 * rather than per-student days, because the dataset holds group sizes but not membership — and an
 * earlier attempt to invent that mapping reported 147 impossible transfers in a plan that is
 * genuinely conflict-free. The limitation has to stay on screen, so it is asserted.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

const SITES = [
  { aoi: 'oth-regensburg', label: 'OTH Regensburg', cohort: 'IM-INFO-1' },
  { aoi: 'lmu-muenchen', label: 'LMU München', cohort: 'MIS-INFO-1' },
];

test.describe('Plan quality lens', () => {
  test('is offered on both universities, in the same panel', async ({ page }) => {
    for (const site of SITES) {
      await page.goto(`/?aoi=${site.aoi}&lens=quality`);
      await waitForScene(page);
      await openReadout(page);
      await expect(page.getByTestId('quality-panel')).toBeVisible();
      // Alongside the others, not instead of them.
      await expect(page.getByTestId('lens-occupancy')).toBeVisible();
      await expect(page.getByTestId('lens-staffing')).toBeVisible();
    }
  });

  test('reports the shape of the student day', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=quality');
    await waitForScene(page);
    await openReadout(page);

    // Every headline figure must be a number, not an empty box or a raw i18n key.
    for (const id of ['quality-idle', 'quality-gapdays', 'quality-longest', 'quality-campus']) {
      await expect(page.getByTestId(id)).toHaveText(/\d/);
    }
    await expect(page.getByTestId('quality-unpopular')).toHaveText(/\d/);
  });

  test('states that no transfer is too tight, because none is', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=quality');
    await waitForScene(page);
    await openReadout(page);

    // The solver forbids a walk longer than the break, and the plan honours it. Showing the
    // constraint holding is the point: a check nobody displays is one nobody notices breaking.
    const verdict = page.getByTestId('quality-tight');
    await expect(verdict).toBeVisible();
    await expect(verdict).not.toHaveText(/\d+ (Wechsel|transfers)/);
  });

  test('keeps its own limitation on screen', async ({ page }) => {
    await page.goto('/?aoi=lmu-muenchen&lens=quality');
    await waitForScene(page);
    await openReadout(page);

    // Naming what is NOT measured is load-bearing here: it is the difference between this lens
    // and the version that invented a student mapping and reported a defect that did not exist.
    const note = page.getByTestId('quality-limitation');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(/Untis/);
  });

  test('picking a cohort opens ITS week, populated, in the existing grid', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=quality');
    await waitForScene(page);
    await openReadout(page);

    const first = page.getByTestId('quality-cohorts').locator('button').first();
    await expect(first).toBeVisible();
    // Read the identity BEFORE clicking: the table unmounts with its tab, so afterwards this
    // locator resolves to nothing.
    const cohortId = (await first.getAttribute('data-testid'))!.replace('quality-cohort-', '');
    await first.click();

    // ⚠️ The click must HAND THE DRAWER BACK to the week. Both now live in the same drawer, so
    // "the panel opened" no longer proves anything — an earlier build changed scope and key
    // correctly while leaving the cohort table on screen, and the week it had just loaded sat one
    // tab away, invisible. That is what this asserts: the evidence arrives where you are looking.
    // (The table unmounts with its tab, so there is no aria-pressed left to check — which is why
    // the cohort identity is proved below, off the select's value, where it actually matters.)
    await expect(page.getByTestId('drawer-detail')).toBeHidden();
    await expect(page.getByTestId('calendar-subject')).toBeVisible();

    // ⚠️ Waiting for real ENTRIES, not just for the drawer. Selecting a cohort is a chain of
    // round trips — scope change, suggestions, key, calendar — and an earlier version of this
    // test screenshotted straight after the click and captured a completely empty week while
    // still passing. A grid that never fills is the failure worth catching here.
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });

    // ⚠️ And it must be the RIGHT cohort. This is the assertion that caught the real bug: the
    // week loaded and filled with Fahrzeugtechnik while the lens had Wirtschaftsinformatik
    // selected, because the pending subject was consumed by the previous scope's fetch. "The grid
    // has entries" would have passed forever. Asserted on the select's VALUE, not its text — a
    // <select> contains the text of every option, so toContainText matches any cohort at all.
    await expect(page.getByTestId('calendar-subject')).toHaveValue(cohortId);

    await page.screenshot({ path: 'C:/Users/alkorn/repos/temp/quality-lens.png' });
  });

  test('LMU has a harder day than OTH, and the lens shows it', async ({ page }) => {
    // A real difference between the two customers rather than a cosmetic one: LMU runs six c.t.
    // blocks against OTH's seven s.t., so its lecture days pack less tightly and gap more.
    const gapRatio = async (aoi: string) => {
      await page.goto(`/?aoi=${aoi}&lens=quality`);
      await waitForScene(page);
      await openReadout(page);
      const text = await page.getByTestId('quality-gapdays').innerText();
      const [withGap, total] = text.split('/').map((n) => Number(n.replace(/\D/g, '')));
      return withGap / total;
    };

    const oth = await gapRatio('oth-regensburg');
    const lmu = await gapRatio('lmu-muenchen');
    expect(lmu).toBeGreaterThan(oth);
  });
});
