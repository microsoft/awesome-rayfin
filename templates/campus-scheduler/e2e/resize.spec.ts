import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Every pane is sized by the person using it.
 *
 * ⚠️ These exist because the layout used to be decided by three constants: the calendar was pinned
 * at 58vh, the side panel could not exceed 760 px, and the split between the assistant and the
 * lenses was a hard-coded 3:2. Each of those is a reasonable default and a bad rule — a week grid
 * someone is reading through wants the screen, and the occupancy readout is the thing the twin
 * exists to show, so capping it at two fifths of a column was backwards.
 *
 * Dragging is tested in a real browser rather than in jsdom on purpose: every one of these handles
 * borders the WebGL canvas, and the canvas swallows pointer events. Pointer capture is what keeps
 * a drag alive across it, and only a real browser exercises that.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

async function dragBy(page: Page, testId: string, dx: number, dy: number) {
  const handle = (await page.getByTestId(testId).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

test.describe('Resizable panes', () => {
  test('the calendar drags taller and remembers it', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('calendar-open').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();

    const before = (await page.getByTestId('calendar-panel').boundingBox())!.height;
    await dragBy(page, 'calendar-resize', 0, -200);
    const after = (await page.getByTestId('calendar-panel').boundingBox())!.height;
    expect(after).toBeGreaterThan(before + 120);

    // A layout choice that does not survive a reload is friction rather than a setting.
    await page.reload();
    await waitForCampusReady(page);
    await page.getByTestId('calendar-open').click();
    const reloaded = (await page.getByTestId('calendar-panel').boundingBox())!.height;
    expect(Math.abs(reloaded - after)).toBeLessThan(8);
  });

  test('double clicking the calendar handle reaches full height exactly', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('calendar-open').click();
    const available = (await page.getByTestId('campus-canvas').boundingBox())!.height;

    // Cycling the stops must reach the top rather than stopping just short of it — "drag it to
    // full screen" is the request this exists to satisfy, and a mouse cannot land on it exactly.
    let height = 0;
    for (let i = 0; i < 4; i += 1) {
      await page.getByTestId('calendar-resize').dblclick();
      height = (await page.getByTestId('calendar-panel').boundingBox())!.height;
      if (height > available - 8) break;
    }
    expect(height).toBeGreaterThan(available - 8);
  });

  test('the calendar handle takes the keyboard, for sizes a mouse cannot hit', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('calendar-open').click();
    const handle = page.getByTestId('calendar-resize');
    await expect(handle).toBeVisible();

    /**
     * ⚠️ Measured from `aria-valuenow`, NOT from the rendered box.
     *
     * The first version read `boundingBox().height` before and after, and failed inside the full
     * suite with a delta of 179.6 px instead of 48 — the drawer had not finished settling when the
     * baseline was taken, so the measurement included the opening as well as the key presses. In
     * isolation it passed, which is the worst kind of green.
     *
     * The separator publishes the number the keys actually change, so this now tests the thing it
     * claims to and cannot be moved by layout timing.
     */
    const value = async () => Number(await handle.getAttribute('aria-valuenow'));
    const before = await value();

    await handle.focus();
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowUp');

    // Three nudges of 16 px, precisely.
    expect((await value()) - before).toBe(48);

    // Shift is the coarse step, and Home goes to the minimum — both exact, which is the point.
    await page.keyboard.press('Shift+ArrowUp');
    expect((await value()) - before).toBe(48 + 64);
  });

  test('the split gives the occupancy lens more room', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const before = (await page.getByTestId('panel-lenses').boundingBox())!.height;

    // Dragging the split upward shrinks the assistant and grows the analysis below it.
    await dragBy(page, 'panel-split', 0, -150);

    const after = (await page.getByTestId('panel-lenses').boundingBox())!.height;
    expect(after).toBeGreaterThan(before + 100);

    // And the assistant must still be present, not collapsed to nothing.
    expect((await page.getByTestId('panel-chat').boundingBox())!.height).toBeGreaterThan(100);
  });

  test('the side panel drags past the old 760 px ceiling', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await dragBy(page, 'panel-resize', -700, 0);

    const width = (await page.getByTestId('side-panel').boundingBox())!.width;
    expect(width).toBeGreaterThan(780);

    // The campus must survive: the drag can make the panel dominant but never total. Hiding the
    // scene completely is the collapse button's job.
    const canvas = (await page.getByTestId('campus-canvas').boundingBox())!.width;
    expect(canvas).toBeGreaterThan(50);
  });

  test('the week grid and the walk list divide the drawer between them', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await page.getByTestId('calendar-open').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();

    // Make the drawer tall enough that both panes have somewhere to go, otherwise the drag is
    // fighting the minimums rather than testing the split.
    await dragBy(page, 'calendar-resize', 0, -220);

    const grid = page.getByTestId('calendar-grid-pane');
    const walks = page.getByTestId('calendar-walks-pane');
    const gridBefore = (await grid.boundingBox())!.height;
    const walksBefore = (await walks.boundingBox())!.height;

    await dragBy(page, 'calendar-split', 0, 120);

    const gridAfter = (await grid.boundingBox())!.height;
    const walksAfter = (await walks.boundingBox())!.height;

    // ⚠️ BOTH HALVES, because either one alone would pass for the wrong reason: the grid growing
    // while the drawer merely got taller is not a split, and the walks shrinking while the grid
    // stayed put would mean the space went nowhere.
    expect(gridAfter).toBeGreaterThan(gridBefore + 60);
    expect(walksAfter).toBeLessThan(walksBefore - 60);

    // Each pane scrolls on its own — that is the point of the split, and it is what the single
    // shared scroller could not do.
    await expect(grid).toHaveCSS('overflow-y', 'auto');
    await expect(walks).toHaveCSS('overflow-y', 'auto');

    // Same rule as every other pane here: a layout choice that dies on reload is friction.
    await page.reload();
    await waitForCampusReady(page);
    await page.getByTestId('calendar-open').click();
    const reloaded = (await page.getByTestId('calendar-grid-pane').boundingBox())!.height;
    expect(Math.abs(reloaded - gridAfter)).toBeLessThan(8);
  });
});
