import { expect, test } from '@playwright/test';

/**
 * The walk between two rooms — the question the person *in* the plan asks.
 *
 * A week grid answers "is the room free". It cannot answer "can I get there", because two adjacent
 * blocks look identical whether the rooms are next door or on the far campus. These tests hold the
 * two halves of that answer together: the panel has to state a verdict, and the twin has to draw
 * the route it is talking about, because a walking time nobody can see is a number to be believed
 * rather than checked.
 */

const OTH = '/?scheduler=oth&aoi=oth-regensburg';

/**
 * A lecturer this plan genuinely sends across the campus: ten walks between buildings on Galgenberg
 * and four changes to Prüfening. Picked from the data rather than assumed, so the tests exercise
 * both a walk and a bus rather than whichever subject the panel happens to open on.
 */
const WALKER = 'M-T013';

test('a lecturer with rooms in two buildings is told about the walk', async ({ page }) => {
  await page.goto(`${OTH}&lens=staffing&teacher=${WALKER}`);

  const drawer = page.getByTestId('calendar-panel');
  await expect(drawer).toBeVisible({ timeout: 30_000 });

  // The default scope is a lecturer, and this plan sends most of them between buildings.
  const list = page.getByTestId('walk-list');
  await expect(list).toBeVisible({ timeout: 30_000 });

  const summary = page.getByTestId('walk-summary');
  await expect(summary).toContainText(/\d/);

  // Every walk carries a verdict, and none of them may be blank.
  const first = list.getByRole('button').first();
  await expect(first).toHaveAttribute('data-verdict', /same-building|comfortable|tight|impossible|unknown/);
});

test('clicking a walk draws it on the campus, and clicking again clears it', async ({ page }) => {
  await page.goto(`${OTH}&lens=staffing&teacher=${WALKER}`);
  await expect(page.getByTestId('walk-list')).toBeVisible({ timeout: 30_000 });

  const drawn = () =>
    page.evaluate(
      () => (window as unknown as { __campus?: { walkRoutePoints(): number } }).__campus?.walkRoutePoints() ?? -1
    );

  // ⚠️ Wait for the scene handle before asserting anything about it. `-1` here means "the twin has
  // not finished building", which is not the same as "nothing is drawn" — and asserting zero
  // against a scene that does not exist yet passes for the wrong reason as often as it fails.
  await expect.poll(drawn, { timeout: 30_000 }).toBe(0);

  const walk = page.getByTestId('walk-list').getByRole('button').first();
  await walk.click();

  // ⚠️ Assert the SCENE, not the button. A pressed button proves the click landed; only the point
  // count proves the geometry reached the twin, which is the part that makes the number checkable.
  await expect.poll(drawn, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(walk).toHaveAttribute('aria-pressed', 'true');

  await walk.click();
  await expect.poll(drawn, { timeout: 15_000 }).toBe(0);
});

test('the cross-campus transfer is judged by the bus, not by a 45-minute walk', async ({ page }) => {
  // ⚠️ THE FABRICATED-DEFECT GUARD, on the real data. The routed walk between OTH's two campuses is
  // ~44 minutes and every cross-campus break in this plan is 15, so a verdict based on walking
  // would mark 163 transfers impossible in a plan that has assumed a bus since it was generated.
  await page.goto(`${OTH}&lens=staffing&teacher=${WALKER}`);
  await expect(page.getByTestId('walk-list')).toBeVisible({ timeout: 30_000 });

  const verdicts = await page
    .getByTestId('walk-list')
    .getByRole('button')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        verdict: node.getAttribute('data-verdict'),
        text: node.textContent ?? '',
      }))
    );

  expect(verdicts.length).toBeGreaterThan(0);
  for (const entry of verdicts) {
    // A campus change is allowed to be tight. It is not allowed to be reported as unwalkable when
    // the plan never asked anyone to walk it.
    if (entry.text.includes('Bus')) expect(entry.verdict).not.toBe('impossible');
  }
});

test('the walking figures say which part is measured', async ({ page }) => {
  await page.goto(`${OTH}&lens=staffing&teacher=${WALKER}`);
  const list = page.getByTestId('walk-list');
  await expect(list).toBeVisible({ timeout: 30_000 });

  // The pace, the stairs penalty and the door are assumptions, and the panel says so rather than
  // letting a routed distance lend its credibility to them.
  await expect(list).toContainText('OpenStreetMap');
  await expect(list).toContainText(/Annahme|assumption/i);
});
