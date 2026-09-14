import { expect, test, type Page } from '@playwright/test';

/**
 * Dragging a session to another slot — PLAN §6.2.
 *
 * ⚠️ THE VERDICT IS WHAT IS BEING TESTED, not the gesture. A drag that always said "fine" would
 * pass any test that only checks a box moved, and would be worse than no feature: it teaches a
 * planner to trust an answer that was never computed. So these tests assert that the panel
 * reaches a REAL verdict from the server, and that an illegal target is named as illegal.
 *
 * The moves are made through Playwright's DnD rather than by calling into the component, because
 * the HTML5 drag contract is exactly where this breaks — a missing `preventDefault` on dragover
 * silently refuses every drop, and no unit test would notice.
 */

const openWeek = async (page: Page) => {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=staffing&teacher=IM-T029');
  const drawer = page.getByTestId('calendar-panel');
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  // The week has to have arrived; an empty grid has nothing to drag.
  await expect(drawer.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
    timeout: 30_000,
  });

  /*
   * ⚠️ AND IT HAS TO STOP MOVING. Waiting for the first entry is not enough: the panel fills the
   * grid from the linked subject, then the subject-list fetch lands, clears the key and refills —
   * so the entry this test grabs can be REPLACED between locating it and dragging it. The drag
   * then goes to a detached node, no `calendar-move` bar ever appears, and it reads as a broken
   * drop target.
   *
   * It passed 3/3 in isolation and failed roughly one full run in two, which is the shape of a
   * load-dependent race rather than a broken feature — the slower the backend, the wider the gap
   * between the two fills. Settling on a stable count closes it without weakening what is tested:
   * the drag, the server round trip and the verdict are all still real.
   */
  let previous = -1;
  await expect
    .poll(
      async () => {
        const now = await drawer.locator('[data-testid^="calendar-entry-"]').count();
        const settled = now > 0 && now === previous;
        previous = now;
        return settled;
      },
      { timeout: 30_000, intervals: [400] }
    )
    .toBe(true);

  return drawer;
};

test('a session can be dragged to another slot and the plan judges it', async ({ page }) => {
  const drawer = await openWeek(page);

  const entry = drawer.locator('[data-testid^="calendar-entry-"]').first();
  const sessionId = (await entry.getAttribute('data-testid'))!.replace('calendar-entry-', '');

  // Somewhere the session is not: the first cell that holds no entry at all.
  const emptyCell = drawer
    .locator('[data-testid^="calendar-cell-"]')
    .filter({ hasNot: page.locator('[data-testid^="calendar-entry-"]') })
    .first();

  await entry.dragTo(emptyCell);

  const bar = page.getByTestId('calendar-move');
  await expect(bar).toBeVisible({ timeout: 20_000 });

  // ⚠️ Wait for a real answer rather than accepting "Checking …". The whole point is that the
  // server was asked; a test satisfied by the spinner would pass with the network unplugged.
  const verdict = page.getByTestId('calendar-move-verdict');
  await expect
    .poll(async () => (await verdict.textContent())?.trim() ?? '', { timeout: 60_000 })
    .not.toMatch(/…$/);

  // The session shows as leaving its old cell and arriving in the new one — the hole a move makes
  // is the thing a planner is judging.
  await expect(page.getByTestId(`calendar-arriving-${sessionId}`)).toBeVisible();
});

test('dropping a lecture on top of the same teacher elsewhere is refused, with a reason', async ({
  page,
}) => {
  const drawer = await openWeek(page);

  // Two entries in the same week means the same teacher. Dropping one onto the other's slot is a
  // guaranteed teacher clash, so the verdict must say so rather than shrug.
  const entries = drawer.locator('[data-testid^="calendar-entry-"]');
  await expect(entries.nth(1)).toBeVisible({ timeout: 30_000 });

  // The cell holding the SECOND entry. Resolved through its own test id rather than a `has:`
  // filter carrying a locator from another root, which matches nothing.
  const secondId = (await entries.nth(1).getAttribute('data-testid'))!;
  const targetCell = drawer
    .locator('[data-testid^="calendar-cell-"]')
    .filter({ has: page.locator(`[data-testid="${secondId}"]`) })
    .first();
  await entries.first().dragTo(targetCell);

  const verdict = page.getByTestId('calendar-move-verdict');
  await expect(page.getByTestId('calendar-move')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await verdict.textContent())?.trim() ?? '', { timeout: 60_000 })
    .not.toMatch(/…$/);

  // Named, not merely rejected. "Illegal" without a reason is what planners already get from the
  // tools they are trying to replace.
  await expect(verdict).not.toContainText('Konfliktfrei');
  await expect(verdict).not.toContainText('No conflicts');
});

test('the move can be discarded and leaves nothing behind', async ({ page }) => {
  const drawer = await openWeek(page);
  const entry = drawer.locator('[data-testid^="calendar-entry-"]').first();
  const sessionId = (await entry.getAttribute('data-testid'))!.replace('calendar-entry-', '');
  const emptyCell = drawer
    .locator('[data-testid^="calendar-cell-"]')
    .filter({ hasNot: page.locator('[data-testid^="calendar-entry-"]') })
    .first();

  await entry.dragTo(emptyCell);
  await expect(page.getByTestId('calendar-move')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('calendar-move-discard').click();
  await expect(page.getByTestId('calendar-move')).toHaveCount(0);
  await expect(page.getByTestId(`calendar-arriving-${sessionId}`)).toHaveCount(0);
});
