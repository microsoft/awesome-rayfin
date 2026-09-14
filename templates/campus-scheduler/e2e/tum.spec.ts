import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';
import {
  GARCHING_HAS_INTERIORS,
  GARCHING_HAS_PLANNER,
  GARCHING_SHIPS,
  NAVIGATUM_MODE,
  POSTURE,
} from './release';

/**
 * TUM Garching — the one site whose timetable is REAL.
 *
 * OTH's and LMU's weeks are invented: nobody publishes them, so this project generates one and
 * badges it. TUM publishes 1,470 bookings through TUMonline, and they are what is on screen. That
 * difference is the most valuable thing in the app and also the most dangerous, because only PART
 * of the dataset is real — TUMonline names no lecturer and no cohort, so those are fabricated.
 *
 * ⚠️ THE COMBINATION IS WHAT THIS FILE GUARDS. A fabricated professor attached to a real, published
 * module is the most misleading pairing this project can produce, and it would look completely
 * normal on screen. Every assertion below is about the app declining to make that pairing while
 * still answering everything it legitimately can.
 *
 * ⚠️ AND ALL OF IT DEPENDS ON A DATASET THE PUBLISHED BUILD DOES NOT CARRY. `config/release.json`
 * withholds the TUMonline week in every posture but `include`, so these cases are gated — and
 * paired, below, with the ones that must hold when it is withheld. Gated rather than deleted,
 * because this is still the behaviour of the internal build and it is the behaviour that matters
 * most; and paired rather than merely skipped, because "we ship less" is a claim that needs
 * testing too.
 */

const AOI = '/?aoi=garching';

async function openTum(page: Page) {
  await page.goto(AOI);
  await waitForCampusReady(page);
  await expect(page.getByTestId('nav-rail')).toBeVisible({ timeout: 30_000 });
}

async function openWeek(page: Page) {
  await openTum(page);
  await page.getByTestId('rail-week').click();
  await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 30_000 });
}

test.describe('TUM Garching — a real timetable', () => {
  test.skip(
    !GARCHING_HAS_PLANNER,
    `the TUMonline week is withheld by config/release.json (${POSTURE})`,
  );

  test('has a planner at all, which it did not before', async ({ page }) => {
    await openTum(page);

    // The rail is the tell: these items are only rendered where a timetable exists, and Garching
    // was a campus twin with none.
    await expect(page.getByTestId('rail-week')).toBeVisible();
    await expect(page.getByTestId('rail-assistant')).toBeVisible();
    await expect(page.getByTestId('rail-walks')).toBeVisible();
  });

  test('shows the published week, and says that it is published', async ({ page }) => {
    test.setTimeout(180_000);
    await openWeek(page);

    // ⚠️ It opens on ROOM, not on a lecturer. A lecturer's week is the best first view everywhere
    // else and is the one question this site refuses, so opening there would greet the planner
    // with an explanation instead of a timetable.
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });

    // ⚠️ The badge is the whole point. Rooms have declared their provenance since the twin
    // shipped; the week never could, so a published TUMonline timetable and a generated one were
    // indistinguishable on screen.
    await expect(page.getByTestId('timetable-real')).toBeVisible();
  });

  test('does not offer a lecturer scope it would only refuse', async ({ page }) => {
    test.setTimeout(180_000);
    await openWeek(page);
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });

    // The people here are fabricated on top of real teaching, so every lookup is declined. A
    // button that is always refused is a dead control, and this repo has shipped two of those.
    await expect(page.getByTestId('calendar-scope-teacher')).toHaveCount(0);

    // The scopes that ARE answerable stay.
    await expect(page.getByTestId('calendar-scope-room')).toBeVisible();
    await expect(page.getByTestId('calendar-scope-cohort')).toBeVisible();
  });

  test('never prints a fabricated person against a real lecture', async ({ page }) => {
    test.setTimeout(180_000);

    /*
     * ⚠️ HIDING THE LECTURER SCOPE WAS NOT ENOUGH, AND THIS IS WHERE THAT SHOWED. `room` is the
     * scope TUM opens on, and every entry in it used to read
     *     "Höhere Mathematik 1 für MW/CIW [CIT513013] · 5510.EG.001 · Prof. Dr. R. Wimmer"
     * — the module code and the room are genuinely TUM's, the professor is invented, and the name
     * is ordinary enough that somebody there may well hold it. Refusing to DISCUSS a fabricated
     * person while displaying them beside a real course is not a refusal.
     *
     * The names come from the RESPONSE rather than from a string typed here: the server still
     * sends them, because the solver's conflict model needs them, so what is under test is what
     * the UI chose to print. A fixture would also pass the day the generator renames everyone.
     */
    const sent = new Set<string>();
    page.on('response', async (res) => {
      if (!res.url().includes('/api/calendar?')) return;
      try {
        const body = (await res.json()) as { entries?: { teacher?: string }[] };
        for (const e of body.entries ?? []) if (e.teacher) sent.add(e.teacher);
      } catch {
        // Not a JSON body — not the payload this is about.
      }
    });

    await openWeek(page);
    await page.getByTestId('calendar-scope-room').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1500);

    // ⚠️ Without this the test passes vacuously the moment the payload changes shape.
    expect(sent.size, 'the backend sent no lecturer names, so this proves nothing').toBeGreaterThan(
      0
    );

    const grid = (await page.getByTestId('calendar-panel').textContent()) ?? '';
    for (const name of sent) {
      expect(grid, `the week grid printed the invented lecturer "${name}"`).not.toContain(name);
    }
  });

  test('still answers everything that IS real — rooms', async ({ page }) => {
    test.setTimeout(180_000);
    await openWeek(page);

    // ⚠️ THE MIRROR OF THE TEST ABOVE, and the reason this file is not one-sided. A server that
    // withheld everything would pass "refuses to name a lecturer" and would have thrown away the
    // entire reason for using TUM's data. The rooms, hours and course titles are measured.
    await page.getByTestId('calendar-scope-room').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });
  });

  test('the guide explains that this week is real — only here', async ({ page }) => {
    await openTum(page);
    await page.getByTestId('rail-help').click();
    await expect(page.getByTestId('guide-card')).toBeVisible({ timeout: 30_000 });

    // Walk the tour and look for the step that only this site has.
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      seen.push((await page.getByTestId('guide-body').textContent()) ?? '');
      const next = page.getByRole('button', { name: /weiter|next/i });
      if (!(await next.count())) break;
      await next.click();
      await page.waitForTimeout(150);
    }
    expect(seen.join(' ')).toMatch(/TUMonline/);
  });
});

test.describe('the generated universities are unaffected', () => {
  test('OTH still answers a lecturer question', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);
    await page.getByTestId('rail-week').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 30_000 });

    // ⚠️ Everything at OTH is invented TOGETHER, so a question about a lecturer is a question about
    // a coherent fiction and must still be answered. A refusal here would mean the rule had been
    // written as "withhold lecturers" instead of "do not attach fiction to fact".
    await page.getByTestId('calendar-scope-teacher').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId('timetable-real')).toHaveCount(0);
  });

  test('OTH still prints its lecturer on the week grid', async ({ page }) => {
    test.setTimeout(180_000);

    /*
     * ⚠️ THE MIRROR OF THE TUM TEST, AND THE REASON THAT ONE IS NOT JUST "HIDE THE NAME". Blanking
     * the lecturer everywhere would pass it perfectly and would quietly strip a working, useful
     * field from the two sites where the whole week is one coherent fiction and the badge already
     * covers it. The rule is "do not attach fiction to fact", not "withhold lecturers".
     */
    const sent = new Set<string>();
    page.on('response', async (res) => {
      if (!res.url().includes('/api/calendar?')) return;
      try {
        const body = (await res.json()) as { entries?: { teacher?: string }[] };
        for (const e of body.entries ?? []) if (e.teacher) sent.add(e.teacher);
      } catch {
        // Not a JSON body.
      }
    });

    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);
    await page.getByTestId('rail-week').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('calendar-scope-room').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await page.waitForTimeout(1500);

    expect(sent.size, 'the backend sent no lecturer names to check against').toBeGreaterThan(0);
    const grid = (await page.getByTestId('calendar-panel').textContent()) ?? '';
    const shown = [...sent].filter((name) => grid.includes(name));
    expect(shown.length, 'OTH stopped naming its own lecturers on the grid').toBeGreaterThan(0);
  });
});

/**
 * The published posture: TUM's week is withheld and the campus is still worth opening.
 *
 * ⚠️ THE MIRROR OF THE BLOCK ABOVE, AND THE REASON THAT ONE IS GATED RATHER THAN DELETED. Skipping
 * the real-data cases leaves nothing asserting what replaces them, and "we withheld some data" can
 * be satisfied by a site that fails to load at all. Two different things have to hold at once:
 *
 *  - the timetable is GONE, in every surface that would have offered it, and
 *  - the twin is INTACT — the building still opens into its own floors, because those polygons
 *    are OpenStreetMap's under ODbL and were never TUM's to withhold. That survival is the entire
 *    argument for `synthetic` existing as a third option instead of a boolean.
 */
test.describe('TUM Garching — the published posture', () => {
  test.skip(
    !GARCHING_SHIPS || NAVIGATUM_MODE === 'include',
    `TUM's own data is included in this build (${POSTURE})`,
  );

  test('offers no planner surface at all, rather than one that refuses', async ({ page }) => {
    await openTum(page);

    // ⚠️ ALL FOUR, NOT JUST THE WEEK. `hasPlanner` gates the rail items individually, so a strip
    // that forgot one leaves a button whose panel has nothing behind it — this repo's most
    // repeated bug shape, and the one `rail.spec.ts` exists for on the other sites.
    await expect(page.getByTestId('rail-week')).toHaveCount(0);
    await expect(page.getByTestId('rail-assistant')).toHaveCount(0);
    await expect(page.getByTestId('rail-walks')).toHaveCount(0);
    await expect(page.getByTestId('rail-changes')).toHaveCount(0);

    // The campus itself is still there. Without this the test above is satisfied by a blank page.
    await expect(page.getByTestId('campus-canvas')).toBeVisible();
  });

  test('never claims a published week, on any surface', async ({ page }) => {
    await openTum(page);

    // The badge is the app asserting "these bookings are real". With the bookings gone it is the
    // single most wrong thing that could still be on screen.
    await expect(page.getByTestId('timetable-real')).toHaveCount(0);

    // ⚠️ AND NOT IN THE TOUR EITHER. The guide has a Garching-only step naming TUMonline as the
    // source; the step is dropped with the data, and a tour is exactly the kind of prose that
    // goes stale unwatched because nobody clicks through it after a config change.
    await page.getByTestId('rail-help').click();
    await expect(page.getByTestId('guide-card')).toBeVisible({ timeout: 30_000 });
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      seen.push((await page.getByTestId('guide-body').textContent()) ?? '');
      const next = page.getByRole('button', { name: /weiter|next/i });
      if (!(await next.count())) break;
      await next.click();
      await page.waitForTimeout(150);
    }
    expect(seen.join(' ')).not.toMatch(/TUMonline/);
  });
});

test.describe('TUM Garching — the interiors that are not TUM\u2019s to withhold', () => {
  test.skip(
    !GARCHING_HAS_INTERIORS || NAVIGATUM_MODE === 'include',
    `not the synthetic-interiors posture (${POSTURE})`,
  );

  test('a building still opens into real rooms, and says the week inside them is invented', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openTum(page);

    // The occupancy lens survives; the flow lens does not. Flow is routed from real consecutive
    // bookings, and inventing where several thousand people walk across a named real campus is a
    // materially bigger claim than inventing a utilisation percentage — and would look just as
    // authoritative.
    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    await expect(page.getByTestId('lens-flow')).toHaveCount(0);

    // ⚠️ ASSERT THE SCENE, NOT THE BUTTON. The explode is animated on the GPU from uniforms, so
    // the DOM cannot see it; `window.__campus` is the deliberate seam this repo uses for exactly
    // this. A click that set some state and drew nothing would pass any DOM assertion.
    await page.evaluate(() => {
      (window as unknown as { __campus: { explodeBuilding(code: string): void } }).__campus
        .explodeBuilding('5506');
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __campus: { explodeProgress(): number } }).__campus
                .explodeProgress(),
          ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0.9);

    const rooms = await page.evaluate(
      () =>
        (window as unknown as { __campus: { rooms: { distinct: { rooms: number } } | null } })
          .__campus.rooms?.distinct.rooms ?? 0,
    );
    expect(rooms, 'the OpenStreetMap room polygons went with the TUM data').toBeGreaterThan(1000);

    // The claim on screen has to track the data. The real note names TUMonline as the source of
    // the bookings, which is a false sentence in this posture — and false on a screen showing real
    // room numbers in a real building, which is the reading that would be taken as TUM's own.
    //
    // ⚠️ READ FROM THE OCCUPANCY PANEL, NOT THE CAMPUS SUMMARY. The `room-stats` block renders only
    // while NO lens is open, and Garching's landing lens is `occupancy` now that flow is withheld
    // — so the first version of this waited two minutes for a note that was correctly hidden. The
    // occupancy note is the stronger claim anyway: the summary describes the rooms, this one
    // describes the WEEK inside them, which is the part that was invented.
    await page.getByTestId('lens-occupancy').click();
    const provenance = (await page.getByTestId('occupancy-provenance').textContent()) ?? '';
    expect(provenance.length, 'no provenance note rendered at all').toBeGreaterThan(0);
    expect(provenance).not.toMatch(/TUMonline/);
  });
});
