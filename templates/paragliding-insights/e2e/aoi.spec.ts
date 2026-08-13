import { expect, test } from '@playwright/test';

/**
 * The AOI swap — PLAN §4.4, decision 21 and 23.
 *
 * The claim this app makes is that the location is configuration rather than code. Phase 7 tested
 * that claim by adding a second site, and the interesting result was not that the swap worked: it
 * was the five things that silently did not swap with it. Each `test` below is one of them, and
 * each one passed a manual glance before it was measured, because every failure produced a page
 * that looked completely normal:
 *
 *  - the guided tour listed Oberstdorf place ids, and `createTour` skips stops it cannot find, so
 *    the second site got a tour of zero stops and a button that ran and did nothing;
 *  - the flight loader took `flights[0]` from a global index, so a site whose config says it has no
 *    flight showed the *other* site's 98 km cross-country, complete with scrubber and barogram;
 *  - the cable-car layer toggle was labelled "Nebelhornbahn" on a mountain served by the
 *    Tegelbergbahn;
 *  - the tab title named Oberstdorf whichever site was open;
 *  - the canvas `aria-label` — the only description of the map a screen-reader user gets — named
 *    Oberstdorf whichever site was open.
 *
 * So these assertions are deliberately about *content per site*, not about the switcher widget.
 * A test that only checked that the dropdown had two entries would have passed against every one
 * of those bugs.
 */

const SITES = {
  oberstdorf: {
    name: 'Oberstdorf / Nebelhorn',
    place: 'Nebelhorn',
    /** Oberstdorf ships the bundled flight; the Tegelberg deliberately does not. */
    hasFlight: true,
  },
  tegelberg: {
    name: 'Tegelberg / Schwangau',
    place: 'Schloss Neuschwanstein',
    hasFlight: false,
  },
} as const;

/**
 * Wait until the scene is actually up.
 *
 * ⚠️ **The "no flight" assertions below are worthless without this.** `toHaveCount(0)` is trivially
 * true on a page that has not finished loading, so a test that did not wait would have passed just
 * as happily against the bug it exists to catch. `data-ready` is the canvas's own signal that the
 * terrain is in.
 */
async function sceneReady(page: import('@playwright/test').Page, id: string): Promise<void> {
  await expect(page.getByTestId('twin-shell')).toHaveAttribute('data-aoi', id);
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 180_000,
  });
}

test.describe('area of interest', () => {
  test('the switcher offers every shipped site', async ({ page }) => {
    await page.goto('/');

    const switcher = page.getByTestId('aoi-switcher');
    await expect(switcher).toBeVisible();
    await expect(switcher.locator('option')).toHaveText([
      SITES.oberstdorf.name,
      SITES.tegelberg.name,
    ]);
  });

  for (const [id, site] of Object.entries(SITES)) {
    test(`${id} renders as itself`, async ({ page }) => {
      await page.goto(`/?aoi=${id}`);
      await sceneReady(page, id);

      // The header is nested inside <main>, so it is NOT a `banner` landmark — a nested <header> is
      // a generic section header. Located by element, not by a role it does not have.
      const header = page.locator('header');

      // The header, the tab title and the canvas description all have to agree with the shell.
      await expect(header).toContainText(site.name);
      await expect(page).toHaveTitle(new RegExp(site.name.replace(/[/]/g, '\\/')));
      await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute(
        'aria-label',
        new RegExp(site.name.replace(/[/]/g, '\\/'))
      );

      // A place that only exists at this site, proving the config actually drove the scene rather
      // than the page merely relabelling itself.
      await expect(header).toContainText(site.place, { ignoreCase: true });

      // The switcher reflects where we are, so the URL parameter and the control cannot disagree.
      await expect(page.getByTestId('aoi-switcher')).toHaveValue(id);
    });

    test(`${id} ${site.hasFlight ? 'shows its own flight' : 'shows no flight at all'}`, async ({
      page,
    }) => {
      await page.goto(`/?aoi=${id}`);
      await sceneReady(page, id);

      const flight = page.getByTestId('flight-panel');
      if (site.hasFlight) {
        await expect(flight).toBeVisible({ timeout: 30_000 });
      } else {
        // ⚠️ The assertion that matters. A borrowed flight is worse than no flight: it is a
        // plausible, precise, entirely fictional track drawn through terrain 35 km from where it
        // was actually flown, and nothing on screen says so.
        await expect(flight).toHaveCount(0);
      }
    });
  }

  test('the guided tour is the tour of the site being shown', async ({ page }) => {
    await page.goto('/?aoi=tegelberg');
    await sceneReady(page, 'tegelberg');

    await page.getByTestId('toggle-tour').click();

    // Reaching stop 1 of 5 is the whole point: before the tour moved into the AOI config this
    // button started a tour of zero stops, reported no error, and stopped immediately.
    const caption = page.getByTestId('tour-caption');
    await expect(caption).toBeVisible();
    await expect(caption).toContainText('1/5');
    await expect(caption).toContainText('Hohenschwangau');
  });

  /**
   * One world — PLAN §8.
   *
   * The switcher used to reload the page, so "the other site's content is gone" was guaranteed by
   * the browser rather than by this app. Flying between sites keeps the component mounted, and the
   * first thing that broke when it did was the flight panel: arriving at the Tegelberg left
   * Oberstdorf's 98 km track and its barogram on screen, under a header naming a different
   * mountain. That is the §4.4 leak again, reintroduced by the very change that removed the reload.
   */
  test('switching site flies rather than reloading, and takes the content with it', async ({
    page,
  }) => {
    await page.goto('/');
    await sceneReady(page, 'oberstdorf');
    await expect(page.getByTestId('flight-panel')).toBeVisible({ timeout: 30_000 });

    // A value that cannot survive a page load. If it is still here at the end, nothing reloaded.
    await page.evaluate(() => {
      (window as unknown as { __stayedPut?: boolean }).__stayedPut = true;
    });

    await page.getByTestId('aoi-switcher').selectOption('tegelberg');

    // The shell follows the chosen site...
    await expect(page.getByTestId('twin-shell')).toHaveAttribute('data-aoi', 'tegelberg');
    await expect(page).toHaveTitle(/Tegelberg/);
    await expect(page.locator('header')).toContainText('Schloss Neuschwanstein');

    // ...and so does everything that is per-site. The Tegelberg has neither a flight nor weather.
    await expect(page.getByTestId('flight-panel')).toHaveCount(0);
    await expect(page.getByTestId('day-panel')).toHaveCount(0);

    /**
     * The far site is fully dressed, not merely present.
     *
     * ⚠️ The first cut of the world loaded the far core's heightmap and nothing else, so flying to
     * the Tegelberg arrived at a bare mountain — no buildings, no trees, no cable car, no names —
     * while Oberstdorf, being the near site, still had all four. It read as the second site having
     * been stripped. `data-world-sites` is set only once a site's LAYERS are in, so this cannot go
     * green for a site that has terrain and nothing on it.
     */
    await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute(
      'data-world-sites',
      'oberstdorf,tegelberg',
      { timeout: 120_000 }
    );

    // The URL is kept in step so the view can still be handed to somebody...
    await expect(page).toHaveURL(/[?&]aoi=tegelberg/);

    // ...but it was a camera flight, not a navigation.
    const survived = await page.evaluate(
      () => (window as unknown as { __stayedPut?: boolean }).__stayedPut === true
    );
    expect(survived).toBe(true);
  });
});
