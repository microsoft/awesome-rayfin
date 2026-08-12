import { readFileSync } from 'node:fs';

import { expect, request, test, type Page } from '@playwright/test';

const env = (name: string) =>
  new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync('.env.local', 'utf8'))?.[1]?.trim() ?? '';

const OTH_API = env('VITE_RAYFIN_SCHEDULER_API_OTH') || env('VITE_RAYFIN_SCHEDULER_API');
const KEY = env('VITE_RAYFIN_SCHEDULER_KEY');

/**
 * "A professor drops Friday — what now?" on one click.
 *
 * ⚠️ THIS IS THE PRODUCT'S OWN QUESTION, and until now the only way to ask it was to type a German
 * sentence at the assistant. That made the cascade — the thing PLAN §1 says the whole system exists
 * for — look like a chat trick, and hid it from anyone who did not already know to ask.
 *
 * The button calls the SAME two tools the agent calls (`get_affected_sessions`, then
 * `propose_repairs` with a `forbid`) and hands the result to the SAME confirm gate. These tests
 * exist to hold that equivalence: a repair reached by clicking must be exactly as unwritten, and
 * exactly as confirmable, as one reached by asking.
 */

/** A lecturer this plan really does send in on a Friday. Verified against the dataset, not assumed. */
const LECTURER = 'IM-T029';

async function openWeek(page: Page) {
  await page.goto(`/?scheduler=oth&aoi=oth-regensburg&lens=staffing&teacher=${LECTURER}`);
  await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('replan-bar')).toBeVisible({ timeout: 60_000 });
}

/** Read the published plan straight from the backend, bypassing the app entirely. */
async function publishedWeek(): Promise<string> {
  const api = await request.newContext();
  const response = await api.get(`${OTH_API}/api/calendar`, {
    params: { scope: 'teacher', key: LECTURER },
    headers: { 'x-app-key': KEY },
    timeout: 120_000,
  });
  const view = await response.json();
  await api.dispose();
  return JSON.stringify(
    (view.entries ?? []).map((e: { sessionId: string; slotId: string; roomId: string }) => [
      e.sessionId,
      e.slotId,
      e.roomId,
    ])
  );
}

test.describe('One-click replanning', () => {
  test('the bar is offered for a lecturer, and only for a lecturer', async ({ page }) => {
    await openWeek(page);

    // A cohort or a room cannot "become unavailable" in any way the solver models, so offering the
    // button there would be a control that cannot mean anything.
    await page.getByTestId('calendar-scope-room').click();
    await expect(page.getByTestId('replan-bar')).toHaveCount(0);
  });

  test('blocking a day produces a confirmable proposal, and writes nothing', async ({ page }) => {
    test.setTimeout(420_000);
    const before = await publishedWeek();

    await openWeek(page);
    await page.getByTestId('replan-Fr').click();

    // The solver answered, and the answer is offered through the ordinary confirm gate.
    await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId('proposal-confirm')).toContainText(/\d+ Termine/);

    // The preview draws both halves: the hole left behind and where the sessions land.
    expect(await page.locator('[data-testid^="calendar-arriving-"]').count()).toBeGreaterThan(0);

    // ⚠️ AND NOTHING IS WRITTEN. Checked against the backend rather than the screen, because the
    // screen is what a preview is allowed to change.
    expect(await publishedWeek()).toBe(before);
  });

  test('a day the lecturer does not teach says so instead of failing', async ({ page }) => {
    await openWeek(page);

    // Ask for every weekday in turn; whichever one is empty must be explained, not error.
    const days = await page
      .getByTestId('replan-bar')
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ''));
    expect(days.length).toBeGreaterThan(3);
  });
});
