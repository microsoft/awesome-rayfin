import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The guided tour — PLAN §5, the "what am I looking at" problem.
 *
 * ⚠️ A TOUR CAN FAIL WITHOUT FAILING. Every step points at a real element by CSS selector, and a
 * selector that no longer matches does not throw: the overlay simply dims the whole screen and the
 * card still reads perfectly well, so a broken step looks like a deliberate centred one. That is
 * the failure this file exists to catch — the spotlight must actually land on something, and it
 * must land on the RIGHT something after the step has revealed it.
 */

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(9000);
}

/**
 * The element's box once it has stopped moving.
 *
 * Two identical reads in a row means the CSS transition has finished. Polling for stillness rather
 * than sleeping a fixed 200 ms keeps it fast when the animation is already done — which is nearly
 * always — and still correct on a loaded machine where it is not.
 */
async function settled(locator: ReturnType<Page['getByTestId']>) {
  let last = await locator.boundingBox();
  for (let i = 0; i < 20; i += 1) {
    await locator.page().waitForTimeout(50);
    const next = await locator.boundingBox();
    if (last && next && next.x === last.x && next.y === last.y) return next;
    last = next;
  }
  return last;
}

const stepsAtLeast = 12;

test('the tour opens from the header and explains itself', async ({ page }) => {
  await page.goto('/?scheduler=oth');
  await waitForScene(page);

  await expect(page.getByTestId('guide-overlay')).toBeHidden();
  await page.getByTestId('guide-open').click();

  const card = page.getByTestId('guide-card');
  await expect(card).toBeVisible();
  // The opening step is centred on purpose, so there is nothing to spotlight yet.
  await expect(page.getByTestId('guide-spotlight')).toBeHidden();
  await expect(page.getByTestId('guide-body')).not.toBeEmpty();
});

test('every step lands its spotlight on something that is actually there', async ({ page }) => {
  await page.goto('/?scheduler=oth');
  await waitForScene(page);
  await page.getByTestId('guide-open').click();

  const counter = page.getByTestId('guide-card').locator('span.tabular-nums');
  const total = Number((await counter.innerText()).split('/')[1].trim());
  expect(total, 'the tour has lost most of its steps').toBeGreaterThanOrEqual(stepsAtLeast);

  const centred: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    await expect(counter).toHaveText(new RegExp(`^${i}\\s*/`));
    await expect(page.getByTestId('guide-body')).not.toBeEmpty();

    const spot = page.getByTestId('guide-spotlight');
    if (await spot.isVisible()) {
      // ⚠️ A REAL RECTANGLE, not merely a present element. A spotlight glued to a hidden target
      // collapses to a sliver, which still counts as "visible" to a selector.
      const box = await spot.boundingBox();
      expect(box, `step ${i} has a spotlight with no box`).not.toBeNull();
      expect(box!.width, `step ${i} spotlight is a sliver`).toBeGreaterThan(24);
      expect(box!.height, `step ${i} spotlight is a sliver`).toBeGreaterThan(24);
    } else {
      centred.push(String(i));
    }

    if (i < total) await page.getByTestId('guide-next').click();
  }

  // The intro and the outro are centred by design; anything more means a selector stopped matching
  // and the step quietly turned into a full-screen dim.
  expect(centred.length, `steps with no spotlight: ${centred.join(', ')}`).toBeLessThanOrEqual(2);

  await page.getByTestId('guide-next').click();
  await expect(page.getByTestId('guide-overlay')).toBeHidden();
});

test('a step that reveals the week grid puts it back afterwards', async ({ page }) => {
  await page.goto('/?scheduler=oth');
  await waitForScene(page);
  await expect(page.getByTestId('calendar-panel')).toBeHidden();

  await page.getByTestId('guide-open').click();
  // Walk forward until the drawer has been revealed by a step.
  const calendar = page.getByTestId('calendar-panel');
  for (let i = 0; i < 6 && !(await calendar.isVisible()); i += 1) {
    await page.getByTestId('guide-next').click();
  }
  await expect(calendar, 'no step ever showed the week grid').toBeVisible();

  // ⚠️ CLOSING MID-TOUR MUST RESTORE, not only stepping to the end. The restore runs from the
  // effect cleanup for exactly this reason; wiring it to the "next" handler would leave the app
  // rearranged for anyone who pressed Escape.
  await page.getByTestId('guide-close').click();
  await expect(page.getByTestId('guide-overlay')).toBeHidden();
});

test('a campus without a timetable is not walked through one', async ({ page }) => {
  // Garching and Tübingen have no planner, and the app withholds the calendar there. A tour step
  // about a week grid would reintroduce exactly the claim the rest of the app refuses to make.
  await page.goto('/?aoi=tuebingen');
  await waitForScene(page);
  await page.getByTestId('guide-open').click();

  const counter = page.getByTestId('guide-card').locator('span.tabular-nums');
  const total = Number((await counter.innerText()).split('/')[1].trim());

  const bodies: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    bodies.push((await page.getByTestId('guide-body').innerText()).toLowerCase());
    if (i < total) await page.getByTestId('guide-next').click();
  }
  const text = bodies.join(' ');
  /*
   * ⚠️ ASSERT IN GERMAN. The app opens in German (`useState<Locale>('de')`) and no test switches
   * it, so the previous check for the English "week grid" could never have matched anything and
   * had been passing vacuously. "cp-sat" survived only because the German copy spells the solver
   * the same way. These are the words that actually appear on screen.
   */
  expect(text, 'a site with no planner was told about its week grid').not.toContain('lehrwoche');
  expect(text).not.toContain('cp-sat');
  // ⚠️ The opening line is the newest way to break this. It promises a walkthrough of a lecturer
  // cancelling and the plan being repaired — which is the customer's problem, and a promise a
  // campus twin cannot keep. `welcomeTwin` exists so this site gets its own honest opening.
  expect(text, 'a campus twin was promised a replanning story').not.toContain('absage');
});

test('the tour is about ONE university and never advertises the others', async ({ page }) => {
  /*
   * ⚠️ THE TOUR USED TO OPEN THE SWITCHER AND NAME EVERY CUSTOMER IN THE BUILD. A step called
   * "Four universities, one build" spotlit the site menu and listed OTH, LMU, TUM and Tübingen —
   * in front of whichever one of them was in the room. `SiteMenu` goes to real trouble to keep
   * that switch inconspicuous (no chevron, no hover tint, default cursor, "one customer on screen"
   * in its own header comment); the tour was undoing that deliberately, one step in.
   *
   * REQUIREMENTS.md describes exactly one university, so this is also the tour answering a
   * question nobody in the room asked.
   */
  await page.goto('/?scheduler=oth');
  await waitForScene(page);

  const heading = (await page.getByTestId('site-menu-toggle').innerText()).trim();
  await page.getByTestId('guide-open').click();

  const counter = page.getByTestId('guide-card').locator('span.tabular-nums');
  const total = Number((await counter.innerText()).split('/')[1].trim());
  const menu = await page.getByTestId('site-menu-toggle').boundingBox();

  const bodies: string[] = [];
  for (let i = 1; i <= total; i += 1) {
    bodies.push(await page.getByTestId('guide-body').innerText());

    // No step may point at the switcher, whatever its copy says.
    const spot = page.getByTestId('guide-spotlight');
    if (menu && (await spot.isVisible())) {
      /*
        ⚠️ SETTLE THE BOX BEFORE MEASURING IT. The spotlight carries `transition-all duration-200`,
        so for a fifth of a second after Next it is somewhere between the old target and the new
        one — and the path from a rail item to a panel passes straight through the top-left corner
        where the switcher lives. Reading `boundingBox()` immediately therefore samples a position
        no step ever actually occupies.

        This failed exactly once, in the full lane and never in isolation, which is the signature:
        under parallel load the 200 ms animation outlives the read. The property this test is
        about is where the spotlight COMES TO REST, so waiting for it to stop is not a workaround
        for a flake, it is the difference between measuring the claim and measuring the tween.
      */
      const box = await settled(spot);
      const onMenu =
        box !== null && Math.abs(box.x - menu.x) < 40 && Math.abs(box.y - menu.y) < 40;
      expect(onMenu, `step ${i} spotlights the university switcher`).toBe(false);
    }

    if (i < total) await page.getByTestId('guide-next').click();
  }

  const text = bodies.join(' ');
  // Every other university in the build, by the name a viewer would recognise.
  for (const other of ['LMU', 'Garching', 'Tübingen', 'TUM']) {
    if (heading.includes(other)) continue;
    expect(text, `the tour named ${other} while showing ${heading}`).not.toContain(other);
  }
});
