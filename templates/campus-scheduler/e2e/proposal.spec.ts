import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

import { demoSurname } from './demoTeacher';

/**
 * The confirm gate, end to end — PLAN §13.2 and §13.4.
 *
 * ⚠️ The assertion that matters is that the PUBLISHED plan does not move. Everything else here
 * could pass while the feature was quietly rewriting the live timetable, so the published week is
 * read straight from the API before and after and compared.
 *
 * This drives the real agent and the real solver, so it is slow. That is the point: a mocked
 * version would pass forever while the integration rotted.
 */

function envValue(name: string): string | null {
  if (process.env[name]) return process.env[name] as string;
  for (const file of ['.env.local', 'rayfin/.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      const match = text.match(new RegExp(`^(?:VITE_|RAYFIN_PUBLIC_)?${name}=(\\S+)`, 'm'));
      if (match) return match[1];
    } catch {
      // Absent file is a legitimate "not configured".
    }
  }
  return null;
}

const API =
  envValue('SCHEDULER_API') ??
  envValue('VITE_SCHEDULER_API') ??
  envValue('RAYFIN_PUBLIC_SCHEDULER_API');
const KEY = envValue('SCHEDULER_KEY') ?? envValue('VITE_SCHEDULER_KEY') ?? '';

/** Skip cleanly on a backend that predates the confirm gate, rather than failing on a 404. */
async function proposalsSupported(): Promise<boolean> {
  if (!API) return false;
  try {
    const r = await fetch(new URL('/api/proposal/none', API).toString(), {
      headers: KEY ? { 'X-App-Key': KEY } : {},
    });
    return r.status === 200; // a known route answers with {"error":"unknown_proposal"}
  } catch {
    return false;
  }
}

async function publishedWeek(teacher: string): Promise<string> {
  const url = new URL('/api/calendar', API!);
  url.searchParams.set('scope', 'teacher');
  url.searchParams.set('key', teacher);
  const r = await fetch(url.toString(), { headers: KEY ? { 'X-App-Key': KEY } : {} });
  const view = (await r.json()) as { entries: { sessionId: string; slotId: string }[] };
  return JSON.stringify(
    view.entries.map((e) => [e.sessionId, e.slotId]).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

async function askCascade(page: Page, surname: string) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);
  await page.getByTestId('planner-input').fill(
    `Prof. ${surname} kann freitags nicht mehr. Was ist betroffen und wie planen wir um?`
  );
  await page.getByTestId('planner-send').click();
  await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 240_000 });
}

test.describe('Confirm gate', () => {
  test('previews a shift without applying it, then applies only when confirmed', async ({
    page,
  }) => {
    test.skip(!(await proposalsSupported()), 'backend has no /api/proposal yet');
    test.setTimeout(420_000);
    // ⚠️ Derived, never typed — see ./demoTeacher.
    const surname = await demoSurname();
    test.skip(!surname, 'this backend does not name a lecturer to demo with');

    const before = await publishedWeek(surname!);
    await askCascade(page, surname!);

    // The preview: the vacated cells stay visible struck through, and the destinations are drawn
    // as outlines. Both halves matter — the hole and the landing.
    //
    // ⚠️ Generous timeout: the drawer now re-points itself at the lecturer the proposal is about,
    // so a fetch of THAT week stands between the answer arriving and the ghosts appearing. Five
    // seconds was enough only while the preview was drawing into whatever week was already open.
    await expect(page.locator('[data-testid^="calendar-arriving-"]').first()).toBeVisible({
      timeout: 60_000,
    });
    const arriving = await page.locator('[data-testid^="calendar-arriving-"]').count();
    const departing = await page.locator('[data-testid^="calendar-entry-"].line-through').count();
    expect(arriving).toBeGreaterThan(0);
    expect(departing).toBeGreaterThan(0);

    // ⚠️ EVERY ARRIVAL HAS ITS DEPARTURE, in a lecturer's week. This is the assertion that was
    // missing while the preview was quietly wrong: the cascade is about Prof. Hinterberger, the
    // drawer opens on the BUSIEST lecturer by default, and four of Hinterberger's lectures were
    // drawn as "arriving" into Kellermann's week with nothing struck through — four lectures that
    // were not his, presented as a consequence of the plan. A session keeps its lecturer when it
    // moves, so in this scope the two counts must agree; anything else means ghosts are being
    // drawn into a week they do not belong to.
    expect(departing, 'an arriving ghost with no departure is a session from another week').toBe(
      arriving
    );

    // And the week on screen is the one the question was ABOUT — asserted on the selected option's
    // name, not merely on "some teacher is selected", because the bug was that a real teacher was
    // selected and it was the wrong one. The server has always reported whose weeks a proposal
    // affects; the client simply never read it.
    await expect(
      page.locator('[data-testid="calendar-subject"] option:checked')
    ).toContainText(surname!);

    // The button says what it will do. "OK" would not be a confirmation.
    await expect(page.getByTestId('proposal-confirm')).toContainText(/\d+ Termine/);

    // ⚠️ NOTHING may have been written yet.
    expect(await publishedWeek(surname!)).toBe(before);

    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('proposal-applied')).toBeVisible({ timeout: 90_000 });

    // ⚠️ SAY WHETHER IT WAS KEPT. A confirmed change lives in a dict inside a container that
    // scales to zero, so "applied" alone is exactly the claim that made confirmed work vanish
    // silently. The panel must state which of the two happened.
    //
    // Under Playwright it can only be the honest negative: the durable store refuses writes
    // without a Fabric session, and Fabric SSO does not resolve outside the hosted app. So a
    // 'saved' here would mean the app is claiming durability it cannot have — which is the
    // failure this assertion exists to catch, not a passing case.
    const saved = page.getByTestId('proposal-saved');
    await expect(saved).toBeVisible();
    await expect(saved).toHaveAttribute('data-outcome', /no-session|not-configured|failed/);

    // ⚠️ And still nothing, because a confirmation writes a DRAFT. This is the whole design.
    expect(await publishedWeek(surname!)).toBe(before);

    // Once applied, the ghosts are gone: the draft contains those sessions for real, and drawing
    // both would show each moved session twice.
    expect(await page.locator('[data-testid^="calendar-arriving-"]').count()).toBe(0);
  });

  test('discarding a proposal writes nothing at all', async ({ page }) => {
    test.skip(!(await proposalsSupported()), 'backend has no /api/proposal yet');
    test.setTimeout(420_000);
    // ⚠️ Derived, never typed — see ./demoTeacher.
    const surname = await demoSurname();
    test.skip(!surname, 'this backend does not name a lecturer to demo with');

    const before = await publishedWeek(surname!);
    await askCascade(page, surname!);

    await page.getByTestId('proposal-discard').click();
    await expect(page.getByTestId('proposal-bar')).toBeHidden();
    await expect(page.getByTestId('proposal-applied')).toBeHidden();
    expect(await publishedWeek(surname!)).toBe(before);
  });

  test('a confirmed draft survives browsing to another week', async ({ page }) => {
    test.skip(!(await proposalsSupported()), 'backend has no /api/proposal yet');
    test.setTimeout(420_000);
    // ⚠️ Derived, never typed — see ./demoTeacher.
    const surname = await demoSurname();
    test.skip(!surname, 'this backend does not name a lecturer to demo with');

    await askCascade(page, surname!);
    await page.getByTestId('proposal-confirm').click();
    await expect(page.getByTestId('proposal-applied')).toBeVisible({ timeout: 90_000 });

    // ⚠️ The bug this guards: the draft used to be sticky only for the exact week that was open
    // when it was confirmed. Every read now carries the draft id, so changing scope keeps showing
    // the confirmed plan. Without this a planner watched five confirmed moves vanish the moment
    // they looked at a room — which reads as "the app lost my work".
    await expect(page.getByTestId('draft-switch')).toBeVisible();

    // Assert the REQUEST, not just that something rendered. A grid full of published data looks
    // exactly like a grid full of draft data unless you check which one was asked for.
    const draftCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/calendar?')) draftCalls.push(r.url());
    });

    await page.getByTestId('calendar-scope-room').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });
    expect(draftCalls.some((u) => u.includes('draftId=draft-'))).toBe(true);

    // And "published" is a real destination to switch back to, because comparing against it is the
    // whole reason a draft exists — so switching back must DROP the draft id again.
    //
    // ⚠️ Wait for the scope change to STOP fetching before clearing the buffer. Changing scope
    // issues a read and the suggestions effect issues a corrected one right behind it, so clearing
    // straight after the first entries appear can capture a second read that was still starting —
    // one that carried `draftId` entirely correctly, because it was issued while the draft was
    // still selected. That caught a legitimate request and failed intermittently on a cold
    // backend. The assertion below is unchanged; only the window it judges is honest now.
    await page.waitForLoadState('networkidle');
    draftCalls.length = 0;
    await page.getByTestId('draft-published').click();
    await expect(page.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
      timeout: 60_000,
    });
    expect(draftCalls.length).toBeGreaterThan(0);
    expect(draftCalls.every((u) => !u.includes('draftId=draft-'))).toBe(true);
  });
});
