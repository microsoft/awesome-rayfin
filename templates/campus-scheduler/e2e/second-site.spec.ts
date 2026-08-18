import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The second-site gate.
 *
 * `render.spec.ts` proves the twin renders. This proves it renders THE SITE IT WAS ASKED FOR —
 * a different question, and the one that was repeatedly answered wrongly while LMU was being
 * added. Every defect below is one that actually occurred, and not one of them would have failed
 * a single existing test:
 *
 *   * `rooms.json` was written with `"aoi": "oth-regensburg"` hard-coded, for every site
 *   * the room-geometry join silently matched nothing and reported "0 vermessen, 8796 generiert",
 *     drawing invented plates over the only surveyed interior on the site
 *   * the ownership rules were copied from OTH's vocabulary, matched no LMU building, and put
 *     all 797 placed sessions on one campus while reporting success
 *   * the chat panel offered a question about a teacher from the OTHER university's name pool
 *
 * The pattern is always the same: the app works, the scene is beautiful, and it is showing or
 * saying something that belongs to the first customer. So these assertions are deliberately about
 * IDENTITY and DIFFERENCE rather than about pixels being present.
 *
 * ⚠️ Assumes BOTH AOIs have been built — the LMU geodata pipeline, dataset and room geometry:
 *   python tools/geodata/pipeline.py --aoi lmu-muenchen
 *   python tools/data/generate_timetable.py --site lmu
 *   python tools/data/build_room_geometry.py --site lmu
 */

const errors: string[] = [];

function collectErrors(page: Page) {
  errors.length = 0;
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
}

async function waitForScene(page: Page) {
  await waitForCampusReady(page);
  await page.waitForTimeout(8000);
}

/** What the engine says it loaded, straight off the testing handle. */
async function sceneCounts(page: Page) {
  return page.evaluate(() => {
    const api = (window as unknown as { __campus: Record<string, unknown> }).__campus;
    const read = (key: string) => {
      const value = api[key];
      return typeof value === 'function' ? (value as () => unknown)() : value;
    };
    return {
      buildings: read('buildingCount') as number,
      trees: read('treeCount') as number,
      rooms: read('roomCount') as number,
      hasTerrain: read('hasTerrain') as boolean,
      hasDrape: read('hasDrape') as boolean,
      orientation: read('rastersShareOrientation') as boolean,
    };
  });
}

test.describe('LMU München — the second site', () => {
  test('renders its own scene, lit and without errors', async ({ page }) => {
    collectErrors(page);
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    const counts = await sceneCounts(page);
    expect(counts.hasTerrain, 'no terrain').toBe(true);
    expect(counts.hasDrape, 'no orthophoto drape').toBe(true);
    // The flipY trap: a photo-textured layer uploaded the other way up sits mirrored on the
    // terrain and looks like the BUILDINGS are misplaced. Cheap to assert, expensive to diagnose.
    expect(counts.orientation, 'a raster is uploaded mirrored relative to the others').toBe(true);

    // Floors, not equalities — this catches a layer that failed to load, not a data update.
    // Measured 2026-07-31: 15 746 buildings, 29 580 trees, 9 316 rooms.
    expect(counts.buildings).toBeGreaterThan(10_000);
    expect(counts.trees).toBeGreaterThan(18_000);
    expect(counts.rooms).toBeGreaterThan(5_000);

    expect(errors).toEqual([]);
  });

  test('says it is LMU, in the heading and in the region', async ({ page }) => {
    // The dumbest possible check, and the one that would have caught the assistant greeting LMU
    // as "OTH Regensburg" if the site name had come from the same place.
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('LMU München');
    await expect(page.getByText('München, Bayern')).toBeVisible();
  });

  test('serves LMU room geometry, and knows which rooms are surveyed', async ({ page }) => {
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    const meta = await page.evaluate(async () => {
      const res = await fetch('/terrain/lmu-muenchen/rooms.json');
      if (!res.ok) return null;
      const data = await res.json();
      // ⚠️ NOT GENERATED, rather than one particular source. `measured` means OpenStreetMap's
      // survey and `plan` means the university's own drawing, and a room can be BOTH — LMU's
      // Raumfinder publishes 686 rooms for this building that the survey also mapped, and the
      // architect's outline wins where they overlap, so those rooms are now stamped `plan`. This
      // assertion asked for `measured` and read 21 where it wanted 400, on a building whose
      // interior had just got BETTER. What it always meant is "this interior is not invented".
      const real = data.rooms.filter(
        (r: { provenance?: string }) => r.provenance === 'measured' || r.provenance === 'plan'
      );
      return {
        aoi: data.aoi as string,
        total: data.rooms.length as number,
        real: real.length as number,
        heroHasReal: real.some((r: { building: string }) => r.building === 'ax'),
        levels: [...new Set(real.map((r: { level: number }) => r.level))].sort(),
      };
    });

    expect(meta, 'no rooms.json for lmu-muenchen').not.toBeNull();
    // ⚠️ THE FIELD THAT WAS HARD-CODED. `build_room_geometry.py` wrote "oth-regensburg" into
    // every site's metadata, so LMU's own room file claimed to belong to Regensburg.
    expect(meta!.aoi, 'the room file names the wrong AOI').toBe('lmu-muenchen');

    // ⚠️ THE SILENT LOSS. When the join broke, this was 0 while `total` stayed healthy — the
    // build reported success and drew generated plates over Oettingenstraße 67's real interior.
    // A floor rather than an equality, but a high one: the whole point of this building is that
    // its interior is not invented.
    expect(meta!.real, 'no real rooms — did the outline join fall through?').toBeGreaterThan(400);
    expect(meta!.heroHasReal, 'the hero building has no real rooms').toBe(true);

    // Three storeys of real interior, not one. OTH has a single mapped floor; if LMU collapses to
    // one level too, the ref-derived floors have been lost and the explode will be a pancake.
    expect(meta!.levels.length, 'real rooms are all on one level').toBeGreaterThan(2);
  });

  test('offers the occupancy lens, because its data exists', async ({ page }) => {
    // The engine's own rule: declare only lenses whose data requirements the site can meet. LMU
    // shipped with `lenses: []` until the room geometry was built, precisely so this could not
    // be a lie.
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    await expect(page.getByTestId('lens-flow')).toHaveCount(0);
  });

  test('labels resolve to names, not to keys or ids', async ({ page }) => {
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.gs-label')).map((n) => n.textContent ?? '')
    );
    expect(texts.length, 'no labels at all').toBeGreaterThan(3);
    for (const label of texts) {
      expect(label.trim(), 'a label is empty').not.toBe('');
      // A raw i18n key or an OSM id on screen is invisible to tsc and to any "element exists"
      // assertion. It is only ever caught by looking at the characters.
      expect(label, 'a label is showing an i18n key or an id').not.toMatch(/^[a-z0-9_.-]+$/);
    }
  });
});

test.describe('The two sites are genuinely two sites', () => {
  test('switching site loads a different scene, not a relabelled one', async ({ page }) => {
    // ⚠️ THE FAILURE THIS EXISTS FOR is not "the switcher is broken" — it is a second site that
    // renders the FIRST site's assets under a new heading, which looks entirely convincing. The
    // building counts come from the loaded geometry, so they cannot agree unless the same scene
    // was served twice.
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);
    const lmu = await sceneCounts(page);

    // ⚠️ SWITCHING SITE IS A FULL RELOAD, not a scene swap — `switchAoi` sets `location.href`,
    // because a site change replaces the heightmap, the land cover, the buildings, the drape and
    // the vegetation, and the honest implementation of that is to tear everything down. So the
    // click must be followed by waiting for the NAVIGATION, not just for a canvas: under load the
    // old document is still up for a moment and every assertion races the reload.
    //
    // ⚠️ AND THE DEFAULT SITE IS THE ABSENCE OF THE PARAMETER. `switchAoi` DELETES `?aoi` when the
    // target is the default rather than setting it to the default's id, so waiting for
    // `aoi=oth-regensburg` waits forever — this test failed on exactly that for 30 s before the
    // predicate was written to match what the app actually does. Leaving the wrong wait in with a
    // longer timeout would have been the worst outcome: green, slow, and asserting nothing.
    // ⚠️ THE SWITCH IS BEHIND THE TITLE NOW. It is deliberately invisible until the heading is
    // clicked — one university on screen at a time, see `SiteMenu` — so the menu has to be opened
    // before the site button exists to click. Without this the click fails on a hidden element,
    // which is the correct failure: the way in IS the feature.
    await page.getByTestId('site-menu-toggle').click();
    await page.getByTestId('aoi-oth-regensburg').click();
    await page.waitForURL((url) => !url.search.includes('aoi=lmu-muenchen'), { timeout: 30_000 });
    await waitForScene(page);
    const oth = await sceneCounts(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('OTH Regensburg');
    expect(oth.buildings).not.toBe(lmu.buildings);
    expect(oth.trees).not.toBe(lmu.trees);
    expect(oth.rooms).not.toBe(lmu.rooms);
    // Both are real scenes. A zero on either side would satisfy "not equal" and mean the opposite
    // of what this test is claiming.
    expect(Math.min(oth.buildings, lmu.buildings)).toBeGreaterThan(1000);
    expect(Math.min(oth.rooms, lmu.rooms)).toBeGreaterThan(100);
  });

  test('each site serves its own room file, from its own directory', async ({ page }) => {
    await page.goto('/?aoi=lmu-muenchen');
    await waitForScene(page);

    const both = await page.evaluate(async () => {
      const load = async (aoi: string) => {
        const res = await fetch(`/terrain/${aoi}/rooms.json`);
        if (!res.ok) return null;
        const data = await res.json();
        return { aoi: data.aoi as string, count: data.rooms.length as number };
      };
      return { oth: await load('oth-regensburg'), lmu: await load('lmu-muenchen') };
    });

    expect(both.oth, 'no rooms.json for oth-regensburg').not.toBeNull();
    expect(both.lmu, 'no rooms.json for lmu-muenchen').not.toBeNull();
    expect(both.oth!.aoi).toBe('oth-regensburg');
    expect(both.lmu!.aoi).toBe('lmu-muenchen');
    expect(both.oth!.count).not.toBe(both.lmu!.count);
  });
});
