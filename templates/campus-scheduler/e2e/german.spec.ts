import { expect, test } from '@playwright/test';

import { openReadout } from './readout';

/**
 * The interface is German. Nothing the backend or a generator wrote may reach the screen.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE AN ENGLISH SENTENCE APPEARED IN THE GERMAN UI. Opening Planqualität
 * on LMU and clicking a cohort printed `no cohort matches 'MED-MEDI-1'` — `calendar_view.py`'s
 * wording, echoed straight through `setError(view.message)`. Two separate defects met there:
 *
 *   1. the panel rendered the SERVER'S prose, which is English and written for a developer
 *   2. the site guard FAILED OPEN — `backendSite()` is async, and while the answer was in flight
 *      `mismatch` was false, so the panel asked OTH's backend for an LMU cohort and displayed the
 *      refusal instead of the notice explaining the situation
 *
 * The second is the reason the first was visible at all, and it is the more dangerous of the two:
 * "I do not know yet" was being treated as "everything is fine".
 */

/** Wording only the backend uses. If any of it reaches the DOM, something is echoing raw prose. */
const BACKEND_ENGLISH = [
  'no cohort matches',
  'no teacher matches',
  'no room matches',
  'not_found',
  'bad_scope',
  'HTTP 5',
  'Failed to fetch',
];

/**
 * `calendar_view.py`'s real refusal, byte for byte.
 *
 * ⚠️ Note what is NOT here: `subject`. The error paths return `{error, scope, key, message}` and
 * nothing more, so a client naming the failed lookup from `subject.id` quotes an empty string.
 */
const NOT_FOUND = {
  error: 'not_found',
  scope: 'cohort',
  key: 'MED-MEDI-1',
  message: "no cohort matches 'MED-MEDI-1'",
};

test('a refused lookup is explained in German, naming what was not found', async ({ page }) => {
  // Say the backend serves LMU so the guard is satisfied and the fetch actually happens — this
  // test is about the MESSAGE, not about the guard.
  await page.route('**/api/health*', (route) =>
    route.fulfill({ json: { status: 'ok', data: { site: 'lmu', siteLabel: 'LMU München' } } })
  );
  // ⚠️ STUB THE READ ONLY. This was a glob ending in `calendar?*`, and in a Playwright URL glob
  // `?` is a SINGLE-CHARACTER WILDCARD, not a literal query separator — so it also matched
  // `/api/calendar/suggestions`, the call that supplies the subject list. With no subjects the
  // panel had nothing to look up, never issued the read this test is about, and rendered an empty
  // week. The test was passing its stub through the wrong door.
  await page.route(
    (url) => url.pathname.endsWith('/api/calendar'),
    (route) => route.fulfill({ json: NOT_FOUND })
  );

  await page.goto('/?aoi=lmu-muenchen&lens=quality');

  const cohorts = page.getByTestId('quality-cohorts');
  await openReadout(page);
  await expect(cohorts).toBeVisible({ timeout: 30_000 });
  await cohorts.getByRole('button').first().click();

  const drawer = page.getByTestId('calendar-panel');
  await expect(drawer).toBeVisible({ timeout: 30_000 });

  // German, and specific: the reader is told which id came back empty.
  //
  // ⚠️ GENEROUS TIMEOUT ON PURPOSE. Selecting a cohort changes SCOPE, which re-fetches the subject
  // list before the week can be asked for at all — two round trips to a container that scales to
  // zero. The default 5 s asserted inside that window and reported "no message" for a panel that
  // was still legitimately loading.
  //
  // ⚠️ THE WORD IS "Semestergruppe", NOT "Kohorte". A cohort here is a programme AND a semester
  // (Informatik 1./3./5. — 10 programmes, 30 groups), so "Studiengang" would have been wrong as
  // well as friendlier. This assertion is the only place the German noun is pinned in a test.
  await expect(drawer).toContainText('Keine Semestergruppe', { timeout: 60_000 });
  await expect(drawer).toContainText('MED-MEDI-1');

  const text = (await drawer.textContent()) ?? '';
  for (const phrase of BACKEND_ENGLISH) {
    expect(text, `drawer leaked backend wording: ${phrase}`).not.toContain(phrase);
  }
});

test('a Planqualität cohort never answers in the backend’s English', async ({ page }) => {
  await page.goto('/?aoi=lmu-muenchen&lens=quality');

  const cohorts = page.getByTestId('quality-cohorts');
  await openReadout(page);
  await expect(cohorts).toBeVisible({ timeout: 30_000 });

  // The lens itself is static per-site data, so it works on both universities regardless of which
  // one the backend serves. Clicking a cohort is what crosses into the backend.
  await cohorts.getByRole('button').first().click();

  const drawer = page.getByTestId('calendar-panel');
  await expect(drawer).toBeVisible({ timeout: 30_000 });

  // Give a cold container longer than it needs to answer, so this cannot pass by asserting before
  // the failure would have arrived.
  await page.waitForTimeout(5_000);

  const text = (await drawer.textContent()) ?? '';
  for (const phrase of BACKEND_ENGLISH) {
    expect(text, `drawer leaked backend wording: ${phrase}`).not.toContain(phrase);
  }

  // Something must be said — silence would pass the check above while being just as unhelpful.
  expect(text.trim().length).toBeGreaterThan(20);
});

test('the guard does not fail open while the backend site is still unknown', async ({ page }) => {
  // Hold `/api/health` so the app stays permanently in the "do not know yet" state — exactly the
  // window the race lived in. Nothing may be fetched for a cohort during it.
  let calendarCalls = 0;
  await page.route('**/api/health*', async () => {
    // Never fulfilled: the answer stays in flight for the whole test.
    await new Promise(() => {});
  });
  await page.route('**/api/calendar*', async (route) => {
    calendarCalls += 1;
    await route.abort();
  });

  await page.goto('/?aoi=lmu-muenchen&lens=quality');

  // The lens is static per-site data, so it renders even with the backend unreachable.
  const cohorts = page.getByTestId('quality-cohorts');
  await openReadout(page);
  await expect(cohorts).toBeVisible({ timeout: 30_000 });
  await cohorts.getByRole('button').first().click();

  await page.waitForTimeout(5_000);

  expect(
    calendarCalls,
    'the week was fetched before the app knew which university the backend serves'
  ).toBe(0);

  // And the wait is explained rather than shown as an empty grid.
  await expect(page.getByTestId('calendar-panel')).toContainText(/geladen|loading/i);
});

test('the German UI shows German, and the English UI shows English', async ({ page }) => {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=quality');
  await openReadout(page);
  await expect(page.getByTestId('quality-panel')).toBeVisible({ timeout: 30_000 });

  // The synthetic-data caveat used to come from the JSON, which the generator writes in German —
  // so the English build displayed a German sentence.
  const panel = page.getByTestId('quality-panel');
  await expect(panel).toContainText('synthetisch');

  await page.getByTestId('lang-en').click();
  await expect(panel).toContainText('synthetic');
  await expect(panel).not.toContainText('synthetisch');
});
