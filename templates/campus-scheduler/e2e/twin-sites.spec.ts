import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { GARCHING_HAS_PLANNER, GARCHING_LENS } from './release';

/**
 * The campus twins — Garching, Tübingen, FAU Erlangen and Köln — inside the planner build.
 *
 * Garching and Tübingen came from Campus-Insights, which has no solver behind it. FAU and Köln
 * were built later for the top-ten-by-students set and are twins for the same reason: neither
 * publishes a timetable this project can read. So the app ships SIX universities and only three
 * of them have a week, and the thing worth proving is not that the scenes are pretty — it is that
 * a site with no planner renders completely and says so, rather than rendering a planner UI that
 * cannot answer.
 *
 * ⚠️ EVERY ASSERTION HERE IS ABOUT AN ABSENCE BEING DELIBERATE. A missing calendar and a broken
 * calendar look identical from the outside, and the whole point of `hasPlanner` is that the app
 * distinguishes them out loud.
 *
 * ⚠️ Assumes the Campus-Insights terrain assets have been copied in:
 *   public/terrain/garching/  and  public/terrain/tuebingen/
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

async function sceneCounts(page: Page) {
  return page.evaluate(() => {
    const api = (window as unknown as { __campus: Record<string, unknown> }).__campus;
    const read = (key: string) => {
      const value = api[key];
      return typeof value === 'function' ? (value as () => unknown)() : value;
    };
    return {
      buildings: read('buildingCount') as number,
      colours: read('buildingColours') as { roofColours: number; wallColours: number },
      trees: read('treeCount') as number,
      hasTerrain: read('hasTerrain') as boolean,
      hasDrape: read('hasDrape') as boolean,
      orientation: read('rastersShareOrientation') as boolean,
    };
  });
}

/** How many distinct colours the rendered frame carries — a cheap fingerprint of the picture. */
async function canvasColours(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="campus-canvas"]');
    if (!canvas) return -1;
    const scratch = document.createElement('canvas');
    scratch.width = 240;
    scratch.height = 150;
    const ctx = scratch.getContext('2d');
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  });
}

for (const site of [
  {
    aoi: 'garching',
    heading: 'TUM Garching Forschungszentrum',
    /*
     * ⚠️ DERIVED FROM `config/release.json`, NOT WRITTEN DOWN. Both of these used to be literals
     * — `lens: 'flow'` and `planner: true` — and both are facts about TUM's own data rather than
     * about this site. The published template withholds that data, so the literals described a
     * build nobody outside this repository can produce, and the suite failed on the posture it
     * actually ships in.
     *
     * What the switch does to this row is the interesting part: `flow` goes because it is routed
     * from real consecutive bookings, `occupancy` stays because the room polygons are
     * OpenStreetMap's, and the planner goes with the dataset. The row still asserts a lens and
     * still asserts a planner state — it just asks what they should be.
     */
    lens: GARCHING_LENS,
    panel: GARCHING_LENS ? `${GARCHING_LENS}-panel` : null,
    // Measured on this AOI's own build, not chosen to pass: 349 of 353 roofs sampled from the
    // DOP20 drape, and four wall classes in use (civic, render, utility, concrete). The floors
    // sit well under those so a re-run that shifts a few buildings does not fail the suite, and
    // well over 1 so the failure this exists to catch — everything one flat colour — still does.
    minRoofColours: 150,
    minWallColours: 3,
    planner: GARCHING_HAS_PLANNER,
  },
  {
    aoi: 'tuebingen',
    heading: 'Universität Tübingen — Altstadt & Neckarfront',
    lens: 'condition',
    panel: 'condition-panel',
    // 6 413 of 6 417 roofs measured, five wall classes including the whitewash of eleven churches.
    minRoofColours: 1500,
    minWallColours: 4,
    planner: false,
  },
  {
    aoi: 'fau-erlangen',
    heading: 'FAU Erlangen-Nürnberg',
    // ⚠️ NO LENS, AND THE ABSENCE IS ASSERTED RATHER THAN SKIPPED. FAU publishes no timetable and
    // has no indoor survey, so occupancy, staffing and quality are impossible; `condition` would
    // mean seeding an invented Sanierungsstau for a named real university. A site that offers no
    // lens is a correct site, and the test below checks that it offers NONE — the mirror of the
    // card-that-opens-nothing bug this file exists to catch.
    lens: null,
    panel: null,
    // Measured on this AOI's own build: 8 975 of 9 013 roofs sampled from the DOP20 drape and
    // 1 740 roof surfaces carrying their own material, with all five wall classes in use
    // (render 6 011, utility 2 628, civic 323, concrete 38, whitewash 13). The floors sit well
    // under those so a re-run that shifts a few buildings does not fail the suite.
    minRoofColours: 1500,
    minWallColours: 3,
    planner: false,
  },
  {
    aoi: 'koeln',
    heading: 'Universität zu Köln',
    lens: null,
    panel: null,
    // 5 917 of 5 928 roofs measured, 831 surfaces with their own material, five wall classes
    // (render 5 126, utility 502, civic 271, whitewash 15, concrete 14).
    minRoofColours: 1000,
    minWallColours: 3,
    planner: false,
  },
  {
    aoi: 'aachen',
    heading: 'RWTH Aachen',
    lens: null,
    panel: null,
    // ⚠️ 6 738 of 6 738 roofs measured — ONE HUNDRED PER CENT, and the first build to manage it.
    // That is not luck: this is the first AOI built after the pipeline was reordered to fetch the
    // drape BEFORE the mesh. FAU and Köln both shipped 0% on their first builds under the old
    // order and had to be rebuilt by hand.
    minRoofColours: 1200,
    minWallColours: 3,
    planner: false,
  },
  {
    aoi: 'muenster',
    heading: 'Universität Münster',
    lens: null,
    panel: null,
    minRoofColours: 1000,
    minWallColours: 3,
    planner: false,
  },
] as const) {
  test.describe(`${site.aoi} — a campus twin`, () => {
    test.beforeEach(async ({ page }) => {
      collectErrors(page);
      await page.goto(`/?aoi=${site.aoi}`);
      await waitForScene(page);
    });

    test('renders its own scene, lit and without errors', async ({ page }) => {
      const counts = await sceneCounts(page);
      // A twin that loaded nothing would still show a canvas, so assert the CONTENT.
      expect(counts.buildings).toBeGreaterThan(100);
      expect(counts.hasTerrain).toBe(true);
      expect(counts.hasDrape).toBe(true);
      // The raster-orientation invariant: the drape is an HTMLImageElement texture and the rest
      // are DataTextures, which default to opposite `flipY`. Getting this wrong mirrors the photo
      // north-south and looks like the buildings are in the wrong place.
      expect(counts.orientation).toBe(true);
      expect(errors).toEqual([]);
    });

    test('says which university it is', async ({ page }) => {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(site.heading);
    });

    /**
     * ⚠️ THIS IS THE TEST THAT WOULD HAVE CAUGHT THE TWINS SHIPPING DULL.
     *
     * Both AOIs arrived from Campus-Insights with their meshes built before this app measured roof
     * colour, so `buildings_colour.bin` simply did not exist for them — and the loader treats that
     * file as optional, correctly, because a build made before the drape must still render. The
     * result was two universities wearing ONE flat wall colour on every roof in the city while OTH
     * and LMU wore their own measured tile, and nothing anywhere failed. It is not a crash, it is
     * not an error in the console, and every count above still passed.
     *
     * So the assertion is on VARIETY, read off the buffer the shader samples. A rebuild that loses
     * the colour pass, a colour file rejected by the loader's shape check, or a drape fetched after
     * the mesh all collapse the roof count to 1 and fail here.
     */
    test('is painted from its own orthophoto, not one flat colour', async ({ page }) => {
      const { colours } = await sceneCounts(page);
      expect(
        colours.roofColours,
        'roofs are all one colour — the measured colour file is missing or was rejected'
      ).toBeGreaterThan(site.minRoofColours);
      expect(
        colours.wallColours,
        'every wall is the same class — building_class did not classify this site'
      ).toBeGreaterThanOrEqual(site.minWallColours);
    });

    test('is honest about whether it has a timetable', async ({ page }) => {
      if (site.planner) {
        // The site has a published week. Saying "no timetable" here would be a lie on screen, and
        // withholding the button would hide real data.
        await expect(page.getByTestId('no-planner')).toHaveCount(0);
        await expect(page.getByTestId('calendar-open')).toBeVisible();
        return;
      }

      // The statement, not the silence.
      const note = page.getByTestId('no-planner');
      await expect(note).toBeVisible();
      // A raw i18n key on screen passes "element present and non-empty" — check it resolved.
      await expect(note).not.toHaveText(/^site\./);

      // And the planner surfaces are genuinely gone, not merely hidden behind the note.
      await expect(page.getByTestId('calendar-panel')).toHaveCount(0);
      // ⚠️ Including the control that OPENS it. This one was left ungated: the button sat over the
      // campus reading "Kalender öffnen" directly under a note saying the site has no timetable,
      // and pressing it hid the button and opened nothing at all.
      await expect(page.getByTestId('calendar-open')).toHaveCount(0);
    });

    test('still offers the lens its data supports — and it opens', async ({ page }) => {
      // ⚠️ A SITE WITH NO LENS IS A CORRECT SITE, AND THE ABSENCE IS WORTH A TEST OF ITS OWN.
      // FAU and Köln declare `lenses: []` because none of the four could be honestly filled: no
      // timetable, no indoor survey, and `condition` would be an invented Sanierungsstau on a
      // named real university. The failure this guards against is not a missing card but an
      // OFFERED one — the whole reason this test exists is that both original twins once showed a
      // lens card that set state and opened a panel with nowhere to render.
      if (!site.lens) {
        await expect(page.locator('[data-testid^="lens-"]')).toHaveCount(0);
        return;
      }

      await expect(page.getByTestId(`lens-${site.lens}`)).toBeVisible();

      // ⚠️ STATED, NOT ASSUMED. `lens` and `panel` are two independent fields of the table above
      // and TypeScript cannot correlate them, so a row that names a lens and forgets its panel
      // would otherwise fall through to a click with nothing checked afterwards — which is the
      // exact bug the next assertion exists for, reintroduced through the test.
      const panel = site.panel;
      if (!panel) throw new Error(`${site.aoi} declares lens "${site.lens}" with no panel to open`);

      // ⚠️ OFFERING IT IS NOT THE TEST. `lensDetail` renders inside the calendar drawer, and the
      // drawer is gated on `hasPlanner` — so on both twins the only lens each of them has was a
      // card you could click, that set the state, and that opened a panel with nowhere to render.
      // A visible card proved nothing about that; opening it does.
      await page.getByTestId(`lens-${site.lens}`).click();
      await expect(page.getByTestId(panel)).toBeVisible();
    });
  });
}

/**
 * ⚠️ TÜBINGEN USED TO LAND ON AN INVENTED NUMBER PAINTED OVER A REAL CITY.
 *
 * It offers exactly one lens, `condition`, and the shell opened "the first available lens" on
 * arrival — so `setBuildingConditionMix(0.92)` replaced every measured roof in the old town with a
 * synthetic Sanierungsnote before anybody clicked anything. It made the university look worse than
 * the other three AND showed a figure no German university publishes as the first impression of a
 * named real one. The synthetic badge in the side panel was correct and arrived far too late.
 *
 * Two tests, because either alone passes for the wrong reason: an app that had simply DELETED the
 * lens would pass the first, and one that repaints everything always would pass the second.
 */
test.describe('a lens that repaints the city is chosen, never defaulted', () => {
  test('Tübingen opens on the campus, not on the condition model', async ({ page }) => {
    await page.goto('/?aoi=tuebingen');
    await waitForScene(page);
    await expect(page.getByTestId('condition-panel')).toHaveCount(0);
  });

  test('and opens it the moment it is asked for', async ({ page }) => {
    await page.goto('/?aoi=tuebingen');
    await waitForScene(page);
    const before = await canvasColours(page);

    await page.getByTestId('lens-condition').click();
    await expect(page.getByTestId('condition-panel')).toBeVisible();

    // The RENDERED frame, not the button's pressed state: the point of the lens is that it
    // repaints the buildings, and the point of the default is that it has not done so yet.
    await expect
      .poll(() => canvasColours(page), { timeout: 15_000 })
      .not.toBe(before);
  });
});

/**
 * ⚠️ AN EXPLODE YOU CANNOT SEE ALL OF READS AS NO EXPLODE AT ALL.
 *
 * Reported as "TUM has no more building explosions". It had them: the uniforms, the camera flight
 * and the click handler were all correct, and the same deep link rendered an identical frame in
 * Campus-Insights. What was wrong was the SHOT. The range was `max(radius * 1.5, spread * 1.6,
 * 190)` — a guess with neither the building's own height nor the viewport shape in it — and on
 * TUM's `5506`, 395 rooms over five levels, **7 % of the opened building's room corners landed off
 * screen**, the worst 1.39 in NDC. The upper floors flew out of the top of the frame.
 *
 * So the assertion is geometric and independent of the formula: project every room corner of the
 * OPENED building with the app's own camera and require all of them inside the frustum. It is
 * computed here rather than read from a handle on purpose — the producer must not be the only
 * witness.
 */
test.describe('an opened building is framed so all of it is visible', () => {
  for (const [aoi, building] of [
    ['garching', '5506'],
    ['oth-regensburg', 'K'],
  ] as const) {
    test(`${aoi} frames ${building} completely`, async ({ page }) => {
      await page.goto(`/?aoi=${aoi}&building=${building}`);
      await waitForScene(page);
      await page.waitForFunction(
        (code) => window.__campus?.explodedBuilding() === code && window.__campus.explodeProgress() === 1,
        building,
        { timeout: 30_000 }
      );
      // The flight has to land before the frame means anything — poll until the camera stops.
      let previous = '';
      await expect
        .poll(
          async () => {
            const now = await page.evaluate(() => JSON.stringify(window.__campus!.cameraDebug()));
            const settled = now === previous;
            previous = now;
            return settled;
          },
          { timeout: 20_000 }
        )
        .toBe(true);

      const fit = await page.evaluate((code) => {
        const api = window.__campus!;
        const layer = api.rooms!;
        const { pos, target } = api.cameraDebug();
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="campus-canvas"]')!;
        // The scene's own camera: 42° vertical field of view (src/twin3d/scene.ts).
        const tanY = Math.tan((42 * Math.PI) / 360);
        const tanX = tanY * (canvas.clientWidth / canvas.clientHeight);

        const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const cross = (a: number[], b: number[]) => [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ];
        const unit = (v: number[]) => {
          const l = Math.hypot(v[0], v[1], v[2]) || 1;
          return [v[0] / l, v[1] / l, v[2] / l];
        };
        const forward = unit(sub(target, pos));
        const right = unit(cross(forward, [0, 1, 0]));
        const up = cross(right, forward);

        // The same 26 m per level the room shader applies — see EXPLODE_GAP_M.
        const gap = 26;
        let total = 0;
        let inside = 0;
        for (const room of layer.rooms.filter((r) => r.building === code)) {
          for (const lift of [0, room.heightM]) {
            const world = [
              room.centre.x,
              room.baseM + lift + room.level * gap,
              room.centre.z,
            ];
            const d = sub(world, pos);
            const z = dot(d, forward);
            total += 1;
            if (z <= 0) continue;
            const x = dot(d, right) / (z * tanX);
            const y = dot(d, up) / (z * tanY);
            if (Math.abs(x) <= 1 && Math.abs(y) <= 1) inside += 1;
          }
        }
        return { total, inside };
      }, building);

      expect(fit.total).toBeGreaterThan(20);
      expect(
        fit.inside,
        `${fit.total - fit.inside} of ${fit.total} room corners of ${building} are off screen`
      ).toBe(fit.total);
    });
  }
});

test('the switch reaches all eight universities', async ({ page }) => {
  await page.goto('/?scheduler=oth');
  await waitForScene(page);

  // ⚠️ The list is behind the title on purpose — see `SiteMenu`. Opening it IS the feature, so
  // the test drives it the way a person would rather than reading the registry.
  await page.getByTestId('site-menu-toggle').click();
  const ids = [
    'oth-regensburg',
    'lmu-muenchen',
    'garching',
    'tuebingen',
    'fau-erlangen',
    'koeln',
    'aachen',
    'muenster',
  ];
  for (const id of ids) {
    await expect(page.getByTestId(`aoi-${id}`)).toBeVisible();
  }

  // ⚠️ AND THE COUNT, BECAUSE THE LIST ABOVE ONLY CATCHES A LOSS. This test was called "all four
  // universities" while six were shipping, and it passed — naming ids proves the named ones are
  // present and says nothing about a seventh appearing, or about new twins never reaching the menu
  // at all. Pinning both makes adding a site a deliberate edit here rather than a number that
  // quietly changed, which is the same rule the campus table in sites.test.ts follows.
  await expect(page.locator('[data-testid^="aoi-"]')).toHaveCount(ids.length);
});
