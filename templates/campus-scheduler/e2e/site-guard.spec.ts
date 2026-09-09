import { readFileSync } from 'node:fs';

import { expect, request, test } from '@playwright/test';

/**
 * The backend each university is configured against.
 *
 * ⚠️ Read from `.env.local` rather than `process.env`: Vite loads that file for the browser bundle,
 * but the Playwright runner is a plain node process and never sees it, so `process.env` here is
 * empty and the warm-up below would silently call an empty host.
 */
const env = (name: string) =>
  new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync('.env.local', 'utf8'))?.[1]?.trim() ?? '';

const OTH_API = env('VITE_RAYFIN_SCHEDULER_API_OTH') || env('VITE_RAYFIN_SCHEDULER_API');
const LMU_API = env('VITE_RAYFIN_SCHEDULER_API_LMU') || env('VITE_RAYFIN_SCHEDULER_API');
const KEY = env('VITE_RAYFIN_SCHEDULER_KEY');

/**
 * One backend per university — and a guard that still matters.
 *
 * ⚠️ THIS FILE USED TO ASSERT THE OPPOSITE. For most of this project there was ONE Container App
 * with one `SCHEDULER_SITE`, so selecting LMU genuinely pointed the calendar and the assistant at
 * OTH's plan, and these tests asserted that the app noticed and said so. LMU now has its own
 * container, so the honest expectation is inverted: **both universities work**.
 *
 * The guard is NOT redundant now, and deleting these tests would be the wrong lesson. What it
 * protects against has simply moved: a container pointed at the wrong dataset, an env var that did
 * not take, a build shipped with only one URL. That failure is silent — every request succeeds and
 * the numbers are real, they are just about someone else's campus — so it is still tested here,
 * against a stubbed health response rather than against a deployment that no longer misbehaves.
 */

test.beforeAll(async () => {
  /*
   * ⚠️ WARM BOTH BACKENDS, AND PROVE THEY ANSWERED. They scale to zero, so a cold start can outlast
   * an assertion timeout. More importantly the negative tests below are VACUOUS while a backend is
   * unreachable: with no health answer there is no mismatch either, so "no notice" would pass
   * whether the app worked or not. Warming makes a silent backend fail the run instead of quietly
   * hollowing it out.
   */
  const api = await request.newContext();
  for (const [site, base] of [
    ['oth', OTH_API],
    ['lmu', LMU_API],
  ] as const) {
    expect(base, `no backend configured for ${site}`).not.toBe('');
    const response = await api.get(`${base}/api/health`, {
      headers: { 'x-app-key': KEY },
      timeout: 180_000,
    });
    expect(response.ok(), `${site} backend must be awake for this file to mean anything`).toBe(true);
    expect((await response.json()).data.site, `${base} serves the wrong dataset`).toBe(site);
  }
  await api.dispose();
});

test('each university talks to its OWN backend', async ({ page }) => {
  // The whole point of the second container. Recorded from the browser rather than asserted about
  // configuration, because the bundle is what decides and configuration is only its input.
  //
  // ⚠️ Scoped to the CONTAINER hosts. A plain `/api/` filter also catches Fabric's own data-plane
  // endpoint, which lives on pbidedicated.windows.net and has nothing to do with which university
  // the scheduler is answering for — it made the first version of this test fail on a request that
  // was entirely correct.
  const seen: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).host;
    if (host.includes('azurecontainerapps.io')) seen.push(host);
  });

  await page.goto('/?aoi=lmu-muenchen');
  await expect(page.getByTestId('planner-input')).toBeVisible({ timeout: 60_000 });

  expect(seen.length, 'LMU made no scheduler calls at all').toBeGreaterThan(0);
  const lmuHost = new URL(LMU_API).host;
  expect(seen.every((host) => host === lmuHost), `LMU called ${[...new Set(seen)]}`).toBe(true);
});

test('LMU now has its assistant, because it has a backend of its own', async ({ page }) => {
  await page.goto('/?aoi=lmu-muenchen');

  await expect(page.getByTestId('planner-input')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId('site-mismatch')).toHaveCount(0);
});

test('OTH keeps its assistant too', async ({ page }) => {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');

  await expect(page.getByTestId('planner-input')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId('site-mismatch')).toHaveCount(0);
});

test('a lens link into the calendar reaches a real week on LMU', async ({ page }) => {
  // Previously this could only prove the drawer explained itself. Now it has to show an actual
  // timetable, which is the stronger claim and the one a planner cares about.
  await page.goto('/?aoi=lmu-muenchen&lens=staffing&teacher=MIS-T044');

  const drawer = page.getByTestId('calendar-panel');
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  await expect(drawer.getByTestId('site-mismatch')).toHaveCount(0);
  await expect(drawer.locator('[data-testid^="calendar-entry-"]').first()).toBeVisible({
    timeout: 60_000,
  });
});

test('the guard still fires when a backend serves the wrong university', async ({ page }) => {
  /*
   * ⚠️ THE REASON THIS FILE STILL EXISTS. Stubbing health is not a weaker test than the old live
   * mismatch — it is a more precise one: it reproduces the exact failure (a backend answering for
   * the other campus) without depending on a deployment being broken to do it.
   */
  await page.route('**/api/health*', (route) =>
    route.fulfill({ json: { status: 'ok', data: { site: 'oth', siteLabel: 'OTH Regensburg' } } })
  );

  await page.goto('/?aoi=lmu-muenchen');

  const notice = page.getByTestId('site-mismatch');
  await expect(notice).toBeVisible({ timeout: 60_000 });
  // Naming the site the backend IS on is what makes this diagnosable rather than a dead end.
  await expect(notice).toContainText('OTH');
  await expect(notice).toContainText('LMU München');

  // And the assistant is withheld, so it cannot answer confidently from the wrong plan.
  await expect(page.getByTestId('planner-input')).toHaveCount(0);
});
