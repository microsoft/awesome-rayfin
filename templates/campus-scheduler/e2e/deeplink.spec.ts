import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { openReadout } from './readout';
import { worstOverloaded } from './staffingModel';

/**
 * Deep links — the view someone actually wants to send.
 *
 * `activeAoiId` has always argued that a link is how this app gets shared, and then only the SITE
 * was linkable: every interesting view had to be described in prose. What is worth sending is
 * rarely a campus. It is `?lens=staffing&teacher=IM-T029` — the lecturer this plan puts at twice
 * his contract, with his week already open.
 *
 * ⚠️ Both universities are covered on purpose. A link carries an id, and ids do not travel between
 * sites: an OTH lecturer means nothing at LMU. A deep link that silently applied one to the other
 * would show a confidently wrong screen.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

const params = (page: Page) => new URL(page.url()).searchParams;

test.describe('Deep links', () => {
  test('a lens can be linked, on both universities', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=staffing');
    await waitForScene(page);
    await openReadout(page);
    await expect(page.getByTestId('staffing-panel')).toBeVisible();

    await page.goto('/?aoi=lmu-muenchen&lens=staffing');
    await waitForScene(page);
    await openReadout(page);
    await expect(page.getByTestId('staffing-panel')).toBeVisible();
  });

  test('a linked lecturer arrives selected, with their week open', async ({ page }) => {
    // The whole point of the link: not "here is a staffing screen" but "look at this person".
    // Derived rather than named — see `worstOverloaded`; this used to hard-code IM-T029.
    const lecturer = await worstOverloaded(page, 'oth-regensburg');
    await page.goto(`/?scheduler=oth&aoi=oth-regensburg&lens=staffing&teacher=${lecturer.teacherId}`);
    await waitForScene(page);

    // ⚠️ The WEEK is what a link to a person opens — asserted on the select's value, so this proves
    // the grid is scoped to them rather than merely that a drawer appeared. The readout now
    // shares that drawer, so "the panel is visible" would no longer distinguish the two.
    await expect(page.getByTestId('calendar-panel')).toBeVisible();
    await expect(page.getByTestId('calendar-subject')).toHaveValue(lecturer.teacherId, {
      timeout: 60_000,
    });

    // And the lens agrees with the link: the same person is selected in the table behind it.
    await openReadout(page);
    await expect(page.getByTestId(`staffing-lecturer-${lecturer.teacherId}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('LMU links to its own overloaded lecturer', async ({ page }) => {
    // ⚠️ THIS NAMED MIS-T044 AND DESCRIBED IT AS "the one LMU lecturer over contract — 20 of 18
    // SWS". Before that it named MIS-T023 with a different figure, and the comment decayed
    // silently because the assertion only checked that the id in the link was the one selected.
    // Then the plan moved again and MIS-T044 stopped being over contract at all, so the row
    // vanished and the test finally failed. Derive it, and the comment cannot rot.
    const lecturer = await worstOverloaded(page, 'lmu-muenchen');
    await page.goto(`/?aoi=lmu-muenchen&lens=staffing&teacher=${lecturer.teacherId}`);
    await waitForScene(page);
    await openReadout(page);

    await expect(page.getByTestId(`staffing-lecturer-${lecturer.teacherId}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('an id from the other university is dropped, not applied', async ({ page }) => {
    // ⚠️ The failure this guards against is a confident wrong answer: LMU showing a selection for
    // a lecturer it has never heard of, or an empty week that reads as a broken app.
    await page.goto('/?aoi=lmu-muenchen&lens=staffing&teacher=IM-T029');
    await waitForScene(page);
    await openReadout(page);

    await expect(page.getByTestId('staffing-panel')).toBeVisible();
    await expect(page.getByTestId('staffing-lecturer-IM-T029')).toHaveCount(0);
    // And the link repairs itself rather than leaving a lie in the address bar.
    await expect
      .poll(() => params(page).get('teacher'), { timeout: 10_000 })
      .toBeNull();
  });

  test('a lens this site cannot offer is ignored', async ({ page }) => {
    // OTH declares occupancy and staffing only. A stale `?lens=condition` must degrade to the
    // normal view rather than opening an empty panel.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=condition');
    await waitForScene(page);

    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    await expect(page.getByTestId('staffing-panel')).toHaveCount(0);
  });

  test('a linked building opens itself', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&building=K');
    await waitForScene(page);

    await page.waitForFunction(() => window.__campus?.explodedBuilding() === 'K', null, {
      timeout: 20_000,
    });
  });

  test('closing a linked building clears the link, and it stays closed', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&building=K');
    await waitForScene(page);
    await page.waitForFunction(() => window.__campus?.explodedBuilding() === 'K', null, {
      timeout: 20_000,
    });
    expect(params(page).get('building')).toBe('K');

    // ⚠️ Closed through the UI, not through `window.__campus`. Driving the scene handle directly
    // bypasses React state, so the URL would never update and this test would prove nothing about
    // the link — an earlier version of it did exactly that while claiming otherwise.
    await page.getByTestId('collapse-building').click();

    // A link that still names an open building is a lie.
    await expect.poll(() => params(page).get('building'), { timeout: 10_000 }).toBeNull();

    // Stays shut. ⚠️ This does NOT prove the opener's once-guard, and an earlier comment here
    // claimed it did. Removing the guard was tried and this test still passed — the opening effect
    // simply never re-runs, because none of its dependencies change once the scene has loaded.
    // What the wait genuinely covers is a late re-open from any source at all.
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => window.__campus?.explodedBuilding())).toBeNull();
    expect(params(page).get('building')).toBeNull();
  });

  test('picking a lecturer by hand makes the link, without a reload', async ({ page }) => {
    const lecturer = await worstOverloaded(page, 'oth-regensburg');
    await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=staffing');
    await waitForScene(page);
    await openReadout(page);

    await page.getByTestId(`staffing-lecturer-${lecturer.teacherId}`).click();
    await expect.poll(() => params(page).get('teacher')).toBe(lecturer.teacherId);
    await expect.poll(() => params(page).get('lens')).toBe('staffing');
  });
});
