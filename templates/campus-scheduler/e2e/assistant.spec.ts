import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

import { demoSurname } from './demoTeacher';

/**
 * The planner assistant, end to end against the deployed backend.
 *
 * ⚠️ This test talks to the real Container App and the real Foundry model, so it is slower and
 * less deterministic than the rest of the suite. That is deliberate: the thing worth guarding
 * here is not the React rendering, it is the claim that asking a question in German produces an
 * answer computed by a solver. A mocked version of this test would pass forever while the
 * integration rotted.
 *
 * It skips rather than fails when no backend is configured, so a fresh clone with no `.env` still
 * gets a green suite for everything that does not need Azure.
 */

/**
 * ⚠️ READ THE ENV FILES, do not trust `process.env`.
 *
 * The first version of this guard checked `process.env.VITE_SCHEDULER_API` and the test SKIPPED
 * — reported as "1 skipped, 1 passed", which reads like success at a glance. But Vite loads
 * `.env.local` for the BROWSER; Playwright's Node process never sees those variables. The
 * integration was working the whole time and the suite was quietly not testing it. A skip that
 * looks like a pass is worse than a failure, because nobody investigates it.
 */
function backendConfigured(): boolean {
  if (process.env.VITE_SCHEDULER_API || process.env.RAYFIN_PUBLIC_SCHEDULER_API) return true;
  for (const file of ['.env.local', 'rayfin/.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      if (/^(VITE_|RAYFIN_PUBLIC_)SCHEDULER_API=\S+/m.test(text)) return true;
    } catch {
      // Absent file is a legitimate "not configured", not an error.
    }
  }
  return false;
}

const CONFIGURED = backendConfigured();

/**
 * ⚠️ WAIT FOR THE SCENE FIRST, even though this file is about the chat.
 *
 * These specs failed with "element(s) not found" for `planner-chat` while a diagnostic run
 * listed it in the DOM along with everything else. The difference was a COLD Vite: this file is
 * often the first thing to touch the dev server, so the run pays for dependency optimisation and
 * the first transform of a three.js-sized graph. The twin suite never sees it because it runs
 * second, against a warm server. Waiting on the canvas is the honest way to say "the app has
 * finished starting" — the same thing the twin suite does, for the same reason.
 */
async function waitForApp(page: import('@playwright/test').Page) {
  await waitForCampusReady(page);
  await expect(page.getByTestId('planner-chat')).toBeVisible({ timeout: 30_000 });
}

test.describe('Planning assistant', () => {
  test('is present as the first thing in the side panel', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForApp(page);
    await expect(page.getByTestId('planner-input')).toBeVisible();
  });

  test('answers a cascade question by calling the solver', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(240_000);

    // ⚠️ ASK ABOUT SOMEBODY WHO EXISTS. This named "Hinterberger", and the surname pool moves every
    // time the timetable is regenerated — once it stopped matching, the agent had no lecturer to
    // cascade and the test failed on a two-minute timeout that looked like a broken solver.
    const cascadeSurname = await demoSurname();
    test.skip(!cascadeSurname, 'this backend does not name a lecturer to demo with');

    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForApp(page);

    await page.getByTestId('planner-input').fill(
      `Prof. ${cascadeSurname} kann freitags nicht mehr. Was ist betroffen und wie planen wir um?`
    );
    await page.getByTestId('planner-send').click();

    // The visible tool trace is the point: it is what separates a solver-backed answer from a
    // language model producing five plausible-looking room numbers.
    //
    // Assert the RESULT lines, not just any line mentioning the tool. A bare name matches both
    // the call and its result, which is ambiguous — and worse, the call line alone would pass
    // even if the tool threw. The result summary only exists once the tool actually returned.
    await expect(page.getByText(/get_affected_sessions: \d+ Termine/)).toBeVisible({
      timeout: 120_000,
    });

    // `verschiebt 0 Termine` was a real bug: the solver was handed no `forbid` set, correctly
    // moved nothing, and the model reported that no conflict-free plan existed. Requiring a
    // non-zero move count means that regression fails the build instead of sounding plausible.
    await expect(page.getByText(/propose_repairs: \d+ Optionen, beste verschiebt [1-9]\d* Termine/)).toBeVisible({
      timeout: 150_000,
    });

    // And the answer must contain real slot codes, not a paraphrase.
    await expect(page.getByTestId('planner-chat')).toContainText(/Fr-\d/, { timeout: 150_000 });
  });

  test('answers an inventory question instead of refusing it', async ({ page }) => {
    test.skip(!CONFIGURED, 'no scheduler backend configured');
    test.setTimeout(240_000);

    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForApp(page);

    // This exact question used to produce "Es gibt kein Werkzeug, das die Anzahl der Hörsäle
    // ausgibt." The solver tools could repair a plan but could not describe the estate, so the
    // agent refused the simplest question a planner would open with. `get_plan_overview` exists
    // to close that gap, and this test is what stops it reopening.
    await page.getByTestId('planner-input').fill('Wie viele Hörsäle gibt es?');
    await page.getByTestId('planner-send').click();

    const trace = page.getByText(/get_plan_overview: .*\d+ Räume/);
    await expect(trace).toBeVisible({ timeout: 120_000 });

    /*
     * ⚠️ DERIVED FROM THE TOOL, NOT PINNED. This asserted `/12/`, the hall count on the day it was
     * written. The stock later fell to 8 because the generator stopped inventing lecture halls in
     * buildings whose real ones are published — a CORRECTION — and this test failed for it, which
     * teaches the reader to edit the number rather than read the diff.
     *
     * What must never regress is the property the test actually cares about: the agent reports the
     * figure ITS TOOL returned, rather than one it remembered. So read the number off the tool
     * trace and require the prose to carry that same number.
     */
    const halls = (await trace.textContent())?.match(/(\d+)\s+Räume/)?.[1];
    expect(halls, 'the tool trace carried no room count to check the answer against').toBeTruthy();
    await expect(page.getByTestId('planner-chat')).toContainText(new RegExp(`\\b${halls}\\b`), {
      timeout: 150_000,
    });
    await expect(page.getByTestId('planner-chat')).not.toContainText(/kein Werkzeug/);
  });
});
