import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The read-only week calendar (PLAN §13.3), against the deployed backend.
 *
 * The point of these tests is not that a table renders. It is that the grid a planner reads and
 * the answer the assistant gives are the SAME data — so a claim in the chat can be checked in the
 * calendar without either one being taken on trust.
 */

/** ⚠️ Read the env files, not `process.env` — Vite loads `.env.local` for the browser only, and a
 *  guard that checks the Node environment skips silently while reporting a pass. */
function backendConfigured(): boolean {
  if (process.env.VITE_SCHEDULER_API || process.env.RAYFIN_PUBLIC_SCHEDULER_API) return true;
  for (const file of ['.env.local', 'rayfin/.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      if (/^(VITE_|RAYFIN_PUBLIC_)SCHEDULER_API=\S+/m.test(text)) return true;
    } catch {
      // Absent file is a legitimate "not configured".
    }
  }
  return false;
}

const CONFIGURED = backendConfigured();

async function openCalendar(page: Page) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);
  await page.getByTestId('calendar-open').click();
  await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 30_000 });
  // The first subject loads from /api/calendar/suggestions; wait for a real cell rather than a
  // fixed pause, so a slow cold start does not look like an empty week.
  await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
    timeout: 60_000,
  });
}

test.describe('Week calendar', () => {
  test('opens as a drawer and leaves the campus as the main pane', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);

    // Closed by default: a drawer that takes half the screen before anyone asked is not a default.
    await expect(page.getByTestId('calendar-panel')).toBeHidden();
    await expect(page.getByTestId('calendar-open')).toBeVisible();

    await page.getByTestId('calendar-open').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible();
    // The canvas must still be there — the calendar overlays, it does not replace.
    await expect(page.getByTestId('campus-canvas')).toBeVisible();

    await page.getByTestId('calendar-close').click();
    await expect(page.getByTestId('calendar-panel')).toBeHidden();
  });

  test('renders the whole teaching week, not just the booked part', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    // 5 days x 7 blocks. Asserting the corners means a grid that quietly renders only the days
    // with bookings fails, which is the shape of "Friday looks free because Friday is missing".
    for (const slot of ['Mo-1', 'Fr-1', 'Mo-7', 'Fr-7']) {
      await expect(page.getByTestId(`calendar-cell-${slot}`)).toBeVisible();
    }
  });

  test('shows the same Friday the assistant talks about', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    // The busiest teacher is first in the suggestions, and in this dataset that is the person the
    // cascade demo is about. Their Friday is what the chat quotes when it proposes moving them off
    // it, so the calendar must show sessions there for the two surfaces to be checkable against
    // each other.
    //
    // ⚠️ THE COLUMN, NOT ONE CELL. This asked for `Fr-1` specifically, and reading OTH's published
    // floor plans into the dataset changed the room stock enough that the placer moved that
    // teacher's Friday to blocks 2 to 5 — a green suite turned red over a plan that is still
    // exactly as demonstrable. The claim was never about the first block; pinning one cell tested
    // the seed rather than the behaviour. A Friday that has genuinely emptied still fails this,
    // which is the failure worth catching.
    const friday = page.locator(
      '[data-testid^="calendar-cell-Fr-"] [data-testid^="calendar-entry-"]'
    );
    await expect(friday.first()).toBeVisible({ timeout: 60_000 });
  });

  test('marks slots the teacher cannot take, even when nothing is booked there', async ({
    page,
  }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    // An empty cell a teacher is unavailable for is NOT a free slot. Colouring only bookings would
    // invite a planner to move a session into a slot the person already said no to.
    //
    // ⚠️ PICK A TEACHER WHO HAS ONE, rather than trusting whoever the picker defaults to. The
    // calendar opens on the busiest teacher, and "busiest" is a property of the seed: correcting
    // OTH's block scheme regenerated the dataset, the session counts reshuffled, and the new
    // first teacher happens to have only `eingeschraenkt` slots and no `nicht_verfuegbar` one.
    // That turned a green test red without the feature changing at all — the same mistake the
    // `Fr-1` comment above records. 68 of the 80 teachers do have a blocked slot, so the marking
    // is demonstrably alive; this walks the picker until it finds one and then asserts.
    // A dataset where NOBODY is ever unavailable still fails, which is the failure worth catching.
    const picker = page.getByTestId('calendar-subject');
    const values = await picker
      .locator('option')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
    expect(values.length, 'no subjects offered').toBeGreaterThan(1);

    const blocked = page.getByText('nicht verfügbar').first();
    let found = false;
    /*
      ⚠️ TWO SEPARATE RACES LIVE HERE, AND FIXING ONLY THE FIRST MADE THE TEST WORSE. Both were
      measured rather than guessed.

      1. THE SCENE, NOT THE CALENDAR. This loop failed in the full lane on a 60 s wait for a grid
         repaint, which looks like a slow calendar and is not: the API answers every teacher in
         229–728 ms, and the DOM of a "slow" teacher is identical to a fast one (567 vs 568 nodes,
         the same 35 cells). What is actually happening is that the campus is still loading behind
         the drawer — rooms.bin, occupancy.bin, flows.json, 9105 LoD2 buildings, 21681 trees — and
         decoding it blocks the main thread, so every query queues behind it. The same switch costs
         ~100 ms once the scene has settled and 10.9 s while it has not. Hence `networkidle`:
         raising the timeout instead would treat a busy main thread as a slow calendar.

      2. THE MARKER PAINTS AFTER THE GRID. `isVisible()` is a point-in-time check with NO retry,
         and the "nicht verfügbar" cell lands up to 269 ms after the first entry does. Waiting for
         the scene made every iteration fast, which removed the accidental settle time the old
         60 s stall had been providing — so the check began racing the paint on every teacher and
         the loop reported that nobody is blocked. Measured: all 12 of the first teachers DO have a
         blocked slot, and 11 of 12 show it within 54 ms.

      A `catch` here is legitimate where the earlier one was not. The grid is ASSERTED visible
      first, so "no blocked cell within 2 s of a painted grid" is a real observation about this
      teacher. The attempt that was wrong skipped teachers whose grid never painted at all, and a
      teacher that was never rendered cannot support the conclusion "nobody is blocked".
    */
    await page.waitForLoadState('networkidle');

    for (const value of values.slice(0, 12)) {
      await picker.selectOption(value);
      await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
        timeout: 30_000,
      });
      const hasBlocked = await blocked
        .waitFor({ state: 'visible', timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (hasBlocked) {
        found = true;
        break;
      }
    }
    expect(found, 'no teacher in the first 12 has a slot marked "nicht verfügbar"').toBe(true);
  });

  test('switches scope to rooms and cohorts', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    await page.getByTestId('calendar-scope-room').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });

    await page.getByTestId('calendar-scope-cohort').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('a session in the grid is the same object as a room in the campus', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    // Clicking a booking opens its building and selects its room. This is the join between the
    // timetable and the twin: every booked roomId exists as a geometry code, so the click needs no
    // translation table — and if that ever stops being true, this test is where it shows.
    //
    // ⚠️ Wait for the scene HANDLE, not just the canvas. `window.__campus` is assigned when the
    // terrain, buildings and rooms have finished loading, which is well after the canvas element
    // exists — evaluating too early throws "Cannot read properties of undefined" and looks like a
    // broken feature rather than an impatient test.
    await page.waitForFunction(() => Boolean(window.__campus?.rooms), null, { timeout: 60_000 });
    await page.locator('[data-testid^="calendar-entry-"]').first().click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.explodedBuilding()), {
        timeout: 30_000,
      })
      .not.toBeNull();
  });

  /**
   * Finding a name in the picker.
   *
   * The list arrives busiest-first, which is right for picking a default and useless for finding
   * a person: with ~90 entries the only way to a specific lecturer was to read the whole list in
   * an order with no rule you could see. Two separate complaints — "sorting is not alphanumerical"
   * and "searchbox missing" — are really one.
   */
  test('the picker is in natural order, so a name can be found by reading', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    const labels = await page.locator('[data-testid="calendar-subject"] option').allTextContents();
    expect(labels.length, 'no subjects offered').toBeGreaterThan(2);

    // ⚠️ Compare against the SAME collation the component uses. Asserting plain `<=` would fail
    // on "Ö" vs "O" and on "G 10" vs "G 9" — the very cases numeric+base collation exists for,
    // so a naive assertion would reject the correct behaviour.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const expected = [...labels].sort(collator.compare);
    expect(labels, 'picker is not in natural alphanumeric order').toEqual(expected);

    // A guard against passing vacuously: if the API happened to return one entry, or the labels
    // were all equal, the sort assertion above proves nothing.
    expect(new Set(labels).size, 'all options carry the same label').toBeGreaterThan(2);
  });

  test('typing filters the picker, and never hides what is selected', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(180_000);
    await openCalendar(page);

    const options = page.locator('[data-testid="calendar-subject"] option');
    const before = await options.count();
    const selected = await page.getByTestId('calendar-subject').inputValue();

    // ⚠️ Use a WHOLE other name, not a prefix. The first attempt took four characters and every
    // OTH lecturer begins "Prof", so the query matched all 80 and the test failed while the
    // feature worked. Read values, not labels — the selected id never appears in the label text.
    const others = await options.evaluateAll((nodes, current) =>
      nodes
        .filter((n) => (n as HTMLOptionElement).value !== current)
        .map((n) => (n.textContent ?? '').split('·')[0].trim()),
      selected
    );
    const query = others.find((name) => name.length > 3);
    expect(query, 'no other subject to search for').toBeTruthy();

    await page.getByTestId('calendar-subject-search').fill(query!);
    await expect.poll(async () => options.count()).toBeLessThan(before);
    expect(await options.count(), 'filtered everything away').toBeGreaterThan(0);

    // THE POINT: the select still knows what it is showing. A filtered-out selection renders an
    // empty control over a fully populated week, which reads as a broken panel.
    await expect(page.getByTestId('calendar-subject')).toHaveValue(selected);
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible();

    // And clearing it brings everyone back.
    await page.getByTestId('calendar-subject-search').fill('');
    await expect.poll(async () => options.count()).toBe(before);
  });
});
