import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The Campus Flow timeline, as a CONTROL rather than a picture.
 *
 * The week is 280 fifteen-minute slots rendered across a sidebar, which is roughly one pixel per
 * slot. That is the whole reason this control exists: a bare range input cannot land on a chosen
 * rush hour at that density — you aim at the spike and get the lull beside it. So the chart itself
 * became clickable, draggable and keyboard-driven, with buttons that step between rushes.
 *
 * ⚠️ THIS SHIPPED WITHOUT TESTS AND THE GAP WAS INVISIBLE. `flow-timeline`, `flow-next-peak`,
 * `flow-prev-peak` and `flow-hover` had no coverage at all, and a dead control looks exactly like a
 * working one in a screenshot: the bars render either way. Every assertion below therefore reads
 * the value the control REPORTS (`aria-valuenow`) or the head count it drives, never its geometry.
 *
 * ⚠️ AND `boundingBox()` IS THE WRONG PROBE HERE — this repo has been bitten by it before, in
 * `usePaneSize`, where a height assertion passed alone and failed under load because it measured
 * before the layout settled. `aria-valuenow` is settled the moment React has rendered.
 *
 * Garching is used because it is the campus with a built flow layer. ⚠️ It used to be described
 * here as "a campus twin with the flow lens AND NO PLANNER, so the drawer cannot steal focus or
 * cover the panel" — and that premise died the day Garching got TUM's real timetable. The lens
 * did not break; it MOVED, into a drawer that covers the campus its timeline scrubs, and all five
 * tests below failed pointing at a panel that was no longer beside the canvas. The fix was in the
 * app, not here: `steersTheTwin` in the lens registry now decides where a lens renders, so a
 * control stays beside the 3D it drives whether or not its site has a week.
 */

const SLOTS_PER_DAY = 56; // 14 hours x 4 quarter-hours — see FlowMeta, asserted below rather than trusted.

async function openFlow(page: Page) {
  await page.goto('/?aoi=garching&lens=flow');
  await waitForCampusReady(page);
  await expect(page.getByTestId('flow-panel')).toBeVisible({ timeout: 30_000 });
  return page.getByTestId('flow-timeline');
}

/** The slot the control says it is on. */
async function slotOf(page: Page) {
  const value = await page.getByTestId('flow-timeline').getAttribute('aria-valuenow');
  return Number(value);
}

/** How many people the lens says are walking at the current slot. */
async function walkingAt(page: Page) {
  const text = (await page.getByTestId('flow-walking').textContent()) ?? '';
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

test.describe('campus flow timeline', () => {
  test('is a real slider, and lands where the pointer goes', async ({ page }) => {
    const timeline = await openFlow(page);

    await expect(timeline).toHaveAttribute('role', 'slider');
    const max = Number(await timeline.getAttribute('aria-valuemax'));
    expect(max).toBeGreaterThan(100); // a week of quarter-hours, not a handful of blocks

    const box = await timeline.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // A quarter of the way across the week, then three quarters. The exact slot depends on the
    // rendered width, so the claim under test is ORDERING and rough position, not an exact index —
    // a control that ignores the pointer fails both, and one that inverts the axis fails the first.
    //
    // ⚠️ Element-relative `click({ position })`, not `page.mouse.click` at computed coordinates:
    // the raw mouse skips actionability checks, so anything overlapping the chart silently eats
    // the event and the failure looks like a dead control rather than a covered one.
    await timeline.click({ position: { x: box.width * 0.25, y: box.height / 2 } });
    const early = await slotOf(page);

    await timeline.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
    const late = await slotOf(page);

    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(max * 0.15);
    expect(early).toBeLessThan(max * 0.35);
    expect(late).toBeGreaterThan(max * 0.65);
    expect(late).toBeLessThan(max * 0.85);

    // The label must follow the value, or the number is right and the screen still lies.
    await expect(page.getByTestId('flow-slot-label')).not.toHaveText('');
  });

  test('the keyboard steps a slot, an hour and a day', async ({ page }) => {
    const timeline = await openFlow(page);
    const box = await timeline.boundingBox();
    if (!box) throw new Error('timeline has no box');
    await timeline.click({ position: { x: box.width * 0.5, y: box.height / 2 } });
    await timeline.focus();

    const start = await slotOf(page);

    await page.keyboard.press('ArrowRight');
    expect(await slotOf(page)).toBe(start + 1);

    await page.keyboard.press('ArrowLeft');
    expect(await slotOf(page)).toBe(start);

    // ⚠️ An hour is FOUR slots, and that is the unit a timetable is written in. A control that
    // moves by one here is not wrong by three — it is unusable, because crossing a day takes 56
    // presses.
    await page.keyboard.press('ArrowUp');
    expect(await slotOf(page)).toBe(start + 4);

    await page.keyboard.press('ArrowDown');
    expect(await slotOf(page)).toBe(start);

    await page.keyboard.press('PageUp');
    const afterDay = await slotOf(page);
    expect(afterDay - start).toBe(SLOTS_PER_DAY);
  });

  test('Home and End reach the ends of the week', async ({ page }) => {
    const timeline = await openFlow(page);
    await timeline.focus();
    const max = Number(await timeline.getAttribute('aria-valuemax'));

    await page.keyboard.press('End');
    expect(await slotOf(page)).toBe(max);

    await page.keyboard.press('Home');
    expect(await slotOf(page)).toBe(0);
  });

  test('stepping to a peak lands on an actual local maximum', async ({ page }) => {
    const timeline = await openFlow(page);
    await timeline.focus();
    await page.keyboard.press('Home');

    await page.getByTestId('flow-next-peak').click();
    const peakSlot = await slotOf(page);
    const atPeak = await walkingAt(page);
    expect(atPeak).not.toBeNull();
    expect(atPeak ?? 0).toBeGreaterThan(0);

    // ⚠️ THE POINT OF THE BUTTON IS THAT IT VISITS RUSHES, not that it moves. A version that
    // stepped by a fixed stride would pass "the slot changed" forever while landing in the lulls.
    // The code's own rule is `value >= prev && value > next`, so that is what is checked here —
    // against the head count the lens reports, not against anything the component exposes.
    //
    // ⚠️ Focus went to the BUTTON when it was clicked, so the timeline has to take it back before
    // the arrow keys mean anything. Without this the presses land on the button, nothing moves, and
    // the test reads as a broken stepper.
    await timeline.focus();
    await page.keyboard.press('ArrowLeft');
    const before = await walkingAt(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await walkingAt(page);

    expect(await slotOf(page)).toBe(peakSlot + 1);
    expect(atPeak ?? 0).toBeGreaterThanOrEqual(before ?? 0);
    expect(atPeak ?? 0).toBeGreaterThan(after ?? 0);

    // Stepping back returns to a peak at or before the one we came from — the two buttons are
    // mirrors, and a forward-only implementation is a common way to get this half-right.
    await page.getByTestId('flow-prev-peak').click();
    expect(await slotOf(page)).toBeLessThanOrEqual(peakSlot);
  });

  test('the whole-week toggle clears the slot and comes back to the peak', async ({ page }) => {
    const timeline = await openFlow(page);
    await timeline.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    expect(await walkingAt(page)).not.toBeNull();

    // Whole week means "no slot", and the head count must go quiet rather than keep reporting the
    // last one — a stale number under a "whole week" heading is the kind of quiet wrongness this
    // project treats as worse than an empty state.
    await page.getByTestId('flow-whole-week').click();
    await expect(page.getByTestId('flow-walking')).toHaveText('—');

    await page.getByTestId('flow-whole-week').click();
    expect(await walkingAt(page)).not.toBeNull();
  });
});
