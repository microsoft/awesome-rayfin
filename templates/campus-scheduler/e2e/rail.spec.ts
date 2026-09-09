import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The navigation rail.
 *
 * ⚠️ THE ONE PROPERTY WORTH PROVING IS THAT THESE ARE TOGGLES, NOT TABS. The reason this app is
 * worth looking at is that the week grid, the lenses and the campus are on screen together — a
 * lecture moves in the drawer and the room lights up on the map. A rail built as a tab bar would
 * look identical in a screenshot and quietly destroy that, so the split-screen test below is the
 * point of this file and the rest is supporting detail.
 *
 * ⚠️ AND AN ITEM THAT DOES NOTHING IS ITS OWN BUG. This repo has shipped that fault twice — a
 * `Kalender öffnen` button under a notice saying the site has no timetable, and lens cards that
 * set state and opened a panel with nowhere to render. Garching is checked here for the absence
 * of the planner-only items, not merely for the presence of the rest.
 */

const PLANNER_SITE = '/?scheduler=oth&aoi=oth-regensburg';
// ⚠️ THIS WAS `garching` UNTIL GARCHING GOT A REAL TIMETABLE. When TUM's published week landed,
// this test kept asserting that Garching offers no week — and failed, correctly, because the rail
// now offers one. Tübingen is the remaining twin with no solver behind it, so the case this test
// exists to cover (rail entries ABSENT rather than dead) is still covered, just somewhere true.
const TWIN_SITE = '/?aoi=tuebingen';

async function openApp(page: Page, url: string) {
  await page.goto(url);
  await waitForCampusReady(page);
  await expect(page.getByTestId('nav-rail')).toBeVisible({ timeout: 30_000 });
}

test.describe('navigation rail', () => {
  test('gathers the surfaces that used to be three buttons on three different edges', async ({
    page,
  }) => {
    await openApp(page, PLANNER_SITE);

    for (const id of ['campus', 'week', 'analysis', 'assistant', 'changes', 'walks', 'help']) {
      await expect(page.getByTestId(`rail-${id}`)).toBeVisible();
    }
  });

  test('the week and the lens column are open AT THE SAME TIME', async ({ page }) => {
    await openApp(page, PLANNER_SITE);

    await page.getByTestId('rail-week').click();

    // Both surfaces on screen together. A tab bar passes every other assertion in this file and
    // fails this one, which is exactly why it is here.
    await expect(page.getByTestId('calendar-panel')).toBeVisible();
    await expect(page.getByTestId('side-panel')).toBeVisible();
    await expect(page.getByTestId('panel-lenses')).toBeVisible();
    await expect(page.getByTestId('rail-week')).toHaveAttribute('aria-pressed', 'true');

    // And the campus is still behind them — the whole point of layering rather than swapping.
    await expect(page.getByTestId('campus-canvas')).toBeVisible();
  });

  /**
   * ⚠️ `analysis` MOVED FROM THE COLUMN TO THE CANVAS and this is where that is pinned down.
   * It used to toggle the lens half of the 384 px aside. Utilisation is a report — every building
   * against every other — and at that width it could not be read down a column, so it now takes
   * the main area. The assertions that matter are that it covers the canvas AND that the canvas
   * survives underneath: unmounting the 3D view would dispose and rebuild the entire scene on
   * every visit to this tab, which is the cost §28 exists to describe.
   */
  test('Auswertung opens on the canvas, and does not tear the campus down to do it', async ({
    page,
  }) => {
    await openApp(page, PLANNER_SITE);

    const analysis = page.getByTestId('rail-analysis');
    await expect(page.getByTestId('analysis-view')).toHaveCount(0);

    await analysis.click();

    const view = page.getByTestId('analysis-view');
    await expect(view).toBeVisible();
    await expect(analysis).toHaveAttribute('aria-pressed', 'true');

    // A report, not a ribbon: the building table and the headline figures are both there.
    await expect(page.getByTestId('analysis-table')).toBeVisible();
    await expect(page.getByTestId('analysis-kpis')).toBeVisible();

    // It is over the MAIN area, not inside the aside — that is the whole request. Proven by
    // geometry rather than by DOM nesting, because "which box is it in" is not what was asked.
    const canvasBox = (await page.getByTestId('campus-canvas').boundingBox())!;
    const viewBox = (await view.boundingBox())!;
    expect(viewBox.width).toBeGreaterThan(500);
    expect(Math.abs(viewBox.x - canvasBox.x)).toBeLessThan(4);

    // The scene is still mounted underneath, so coming back is instant and the camera is where it
    // was left. If this ever starts failing, someone has swapped the overlay for a conditional
    // render of Twin3DView.
    await expect(page.getByTestId('campus-canvas')).toBeAttached();

    await analysis.click();
    await expect(page.getByTestId('analysis-view')).toHaveCount(0);
    await expect(page.getByTestId('campus-canvas')).toBeVisible();
  });

  test('Campus clears the overlays, and says so about itself', async ({ page }) => {
    await openApp(page, PLANNER_SITE);
    await page.getByTestId('rail-week').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();

    await page.getByTestId('rail-campus').click();

    await expect(page.getByTestId('calendar-panel')).toHaveCount(0);
    await expect(page.getByTestId('side-panel')).toHaveCount(0);
    // The item describes the screen, not a mode it put you in.
    await expect(page.getByTestId('rail-campus')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the assistant and the lenses share the column and can be shown one at a time', async ({
    page,
  }) => {
    await openApp(page, PLANNER_SITE);

    const assistant = page.getByTestId('rail-assistant');
    if ((await assistant.getAttribute('aria-pressed')) !== 'true') await assistant.click();

    // Both halves: the split, and the handle that drags between them.
    await expect(page.getByTestId('panel-chat')).toBeVisible();
    await expect(page.getByTestId('panel-lenses')).toBeVisible();
    await expect(page.getByTestId('panel-split')).toBeVisible();

    // Turn the assistant off: the lenses stay and take the whole column.
    await assistant.click();
    await expect(page.getByTestId('panel-chat')).toHaveCount(0);
    await expect(page.getByTestId('panel-lenses')).toBeVisible();
    await expect(page.getByTestId('side-panel')).toBeVisible();

    /*
      ⚠️ AND `Campus` IS NOW THE ONLY WAY TO CLEAR THE COLUMN, which is a deliberate loss worth
      stating. `analysis` used to be the lens toggle and took the column away when switched off;
      it owns the canvas now, so the lens half no longer has a switch of its own. Campus already
      meant "show me the model and nothing else", so the affordance survives — but if a future
      change wants the lenses hidden independently, this is the test that says there is no such
      control today rather than leaving someone to discover it.
    */
    await page.getByTestId('rail-campus').click();
    await expect(page.getByTestId('side-panel')).toHaveCount(0);
  });

  test('Wege reaches the walk list that was buried at the bottom of the drawer', async ({
    page,
  }) => {
    await openApp(page, PLANNER_SITE);
    await page.getByTestId('rail-walks').click();

    await expect(page.getByTestId('calendar-panel')).toBeVisible();
    await expect(page.getByTestId('lower-pane-walks')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Änderungen switches the lower pane, and the badge agrees with the list', async ({
    page,
  }) => {
    await openApp(page, PLANNER_SITE);
    await page.getByTestId('rail-changes').click();

    await expect(page.getByTestId('calendar-changes')).toBeVisible();
    await expect(page.getByTestId('lower-pane-changes')).toHaveAttribute('aria-pressed', 'true');

    // ⚠️ THE BADGE AND THE LIST MUST BE THE SAME NUMBER. They come from one fetch precisely so
    // they cannot disagree; a badge saying 4 over a list of 3 is worse than either alone.
    const badge = page.getByTestId('rail-badge-changes');
    const rows = await page.getByTestId('calendar-change-row').count();
    if (await badge.count()) {
      expect(Number((await badge.textContent())?.trim())).toBe(rows);
    } else {
      // No badge means no changes, and the pane has to say that rather than render an empty box.
      expect(rows).toBe(0);
      await expect(page.getByTestId('calendar-changes')).not.toBeEmpty();
    }
  });

  test('the rail collapses to icons and remembers it', async ({ page }) => {
    await openApp(page, PLANNER_SITE);
    const rail = page.getByTestId('nav-rail');
    await expect(rail).toHaveAttribute('data-collapsed', 'false');
    const wide = (await rail.boundingBox())?.width ?? 0;

    await page.getByTestId('rail-collapse').click();
    await expect(rail).toHaveAttribute('data-collapsed', 'true');
    const narrow = (await rail.boundingBox())?.width ?? 0;
    expect(narrow).toBeLessThan(wide);

    // Collapsed, the names still have to reach a screen reader — an icon-only control that is
    // unlabelled is not a smaller control, it is an unusable one.
    await expect(page.getByTestId('rail-week')).toHaveAttribute('title', /.+/);

    // A layout choice that dies on reload is friction, so it persists like every pane size here.
    await page.reload();
    await expect(page.getByTestId('nav-rail')).toHaveAttribute('data-collapsed', 'true');
  });

  test('Hilfe opens the guided tour', async ({ page }) => {
    await openApp(page, PLANNER_SITE);
    await page.getByTestId('rail-help').click();
    await expect(page.getByTestId('guide-card')).toBeVisible();
  });

  test('a twin with no timetable offers no week, no walks and no changes', async ({ page }) => {
    await openApp(page, TWIN_SITE);

    // Present, because the campus and its lenses are real here.
    await expect(page.getByTestId('rail-campus')).toBeVisible();
    await expect(page.getByTestId('rail-analysis')).toBeVisible();
    await expect(page.getByTestId('rail-help')).toBeVisible();

    // Absent rather than dead. Tübingen has no solver behind it, so these would set state and
    // open nothing at all.
    await expect(page.getByTestId('rail-week')).toHaveCount(0);
    await expect(page.getByTestId('rail-walks')).toHaveCount(0);
    await expect(page.getByTestId('rail-changes')).toHaveCount(0);
    await expect(page.getByTestId('rail-assistant')).toHaveCount(0);
  });
});
