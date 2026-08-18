import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * Render checks.
 *
 * The unit tests prove the arithmetic; this proves the pixels. A scene can typecheck perfectly and
 * still render a black rectangle — a lost WebGL context, a camera inside the ground plane, or a
 * texture whose mipmap chain failed to build all look identical from Node. That last one is not
 * hypothetical: in the app this engine was forked from, the orthophoto drape rendered the entire
 * campus black for several iterations, with nothing logged and no WebGL error raised. Hence the
 * brightness assertions below, which are the cheapest thing that would have caught it.
 *
 * ⚠️ Assumes the OTH AOI has been built: `npm run data:build`.
 *
 * ⚠️ THIS FILE IS DELIBERATELY SHORTER THAN THE ONE IT WAS FORKED FROM. The origin app's suite
 * asserted indoor rooms joined to real bookings, an occupancy lens with exploding buildings, a
 * campus-flow lens, a Sanierungsstau lens and a second AOI with a river. Campus-Scheduler has none
 * of those yet, and OTH has no indoor data at all (PLAN §5.4). Tests for another app's features
 * are not coverage: they fail for reasons that have nothing to do with this app, and a suite that
 * is expected to be red stops being read. They come back one at a time WITH the features — room
 * load when floor plates exist, flow when the timetable lands.
 */

const errors: string[] = [];

function collectErrors(page: Page) {
  errors.length = 0;
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
}

/** Summary statistics of what is actually on the canvas. */
async function canvasStats(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="campus-canvas"]');
    if (!canvas) throw new Error('no canvas');

    const off = document.createElement('canvas');
    off.width = 240;
    off.height = 150;
    const ctx = off.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // Only works because the renderer is created with preserveDrawingBuffer.
    ctx.drawImage(canvas, 0, 0, off.width, off.height);

    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    const colours = new Set<number>();
    let sum = 0;
    let darkPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      const luma = data[i] + data[i + 1] + data[i + 2];
      sum += luma;
      if (luma < 60) darkPixels += 1;
    }
    const pixels = data.length / 4;
    return {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      distinctColours: colours.size,
      meanChannel: sum / pixels / 3,
      darkFraction: darkPixels / pixels,
    };
  });
}

async function waitForScene(page: Page) {
  // ⚠️ THE GATE IS THE LOADING OVERLAY, NOT THE CANVAS. `toBeVisible()` on the canvas returns on
  // the first paint — the element is rendered unconditionally with the loading card on top of it —
  // so this helper used to hand back a canvas that WebGL had not touched, and covered the gap with
  // a fixed 8 s sleep. That sleep was the real gate, and it was both slower than necessary on a
  // warm cache and not long enough on a cold one: the original failure was 9 of 11 tests reporting
  // "element(s) not found" while the app worked perfectly, with the last 2 passing only because
  // the assets had been cached by then. Waiting for the scene to actually be ready removes the
  // guesswork, and the brightness assertions below remain the real gate.
  await waitForCampusReady(page);
  // A short settle after readiness, because these tests sample PIXELS: `setReady(true)` fires when
  // the scene is built, and the first frames still have the drape and vegetation fading in.
  await page.waitForTimeout(1500);
}

test.describe('OTH Regensburg — the built twin', () => {
  test('renders terrain, not a black or empty canvas', async ({ page }) => {
    collectErrors(page);
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const stats = await canvasStats(page);
    expect(stats.width).toBeGreaterThan(300);
    expect(stats.height).toBeGreaterThan(300);
    expect(stats.distinctColours).toBeGreaterThan(400);

    // ⚠️ The drape regression. A failed mipmap chain renders the whole core black while the
    // buildings and trees stay correctly lit, so "something was drawn" is not enough — the ground
    // has to be BRIGHT. With the orthophoto present this sits around 90; when the drape was broken
    // it measured under 20.
    expect(
      stats.meanChannel,
      'the ground is too dark — is the drape sampling black?'
    ).toBeGreaterThan(45);
    expect(stats.darkFraction, 'too much of the frame is near-black').toBeLessThan(0.35);

    expect(errors).toEqual([]);
  });

  test('reports the layers it loaded', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (msg) => messages.push(msg.text()));
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const joined = messages.join('\n');
    expect(joined).toContain('LoD2:');
    expect(joined).toContain('vegetation:');
    expect(joined).toContain('shell:');
  });

  test('the app and the pipeline project identically', async ({ page }) => {
    // Both implement WGS84 -> UTM32 independently, one in TypeScript and one in Python. If they
    // drift, the campus renders a few metres from where the survey put it and every later layer
    // inherits the error silently.
    const messages: string[] = [];
    page.on('console', (msg) => messages.push(msg.text()));
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    expect(
      messages.find((m) => m.includes('projection agrees with the pipeline')),
      'no projection agreement was reported'
    ).toBeTruthy();
    expect(messages.some((m) => m.includes('projection drift'))).toBe(false);
  });

  test('has no terrain notice once the terrain is built', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);
    await expect(page.getByTestId('terrain-notice')).toHaveCount(0);
  });

  test('labels the focus places, including the far campus', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await expect(page.locator('.gs-label').first()).toBeVisible();

    // ⚠️ Name resolution is asserted over EVERY label node, shown or not, and visibility is
    // asserted separately after flying to the place. The earlier version demanded that
    // "Fakultät Maschinenbau" be visible on the opening overview — which was only true because
    // the label layer had no decluttering and drew all ten Seybothstraße names on top of each
    // other. The moment overlapping labels were suppressed, a test written against the broken
    // behaviour started failing and looked like the fix was wrong. It was the test that was wrong.
    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.gs-label')).map((n) => n.textContent ?? '')
    );
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) {
      expect(t.trim(), 'a label is empty').not.toBe('');
      expect(t, 'a label is showing an i18n key or an id').not.toMatch(/^[a-z0-9_.-]+$/);
    }
    expect(texts.some((t) => t.includes('Maschinenbau'))).toBe(true);

    // The second campus is the whole point of this AOI and it sits 2.5 km from the first. Fly to
    // it: once it is the nearest thing to the camera it must win its label.
    await page.getByTestId('place-pruefening').click();
    await page.waitForTimeout(2500);
    await expect(page.locator('.gs-label:visible', { hasText: 'Prüfening' }).first()).toBeVisible();
  });

  test('visible labels never overlap each other', async ({ page }) => {
    // Ten named OTH buildings sit inside ~400 m. Before decluttering, the overview shot rendered
    // "Seminargebäudeaude" on top of "Laborgebäude Mikrosystemtechnik" — every label was drawn
    // because each was individually on screen, which is true and useless. This asserts the
    // property a reader actually needs: whatever is shown can be read.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.gs-label'))
        .filter((n) => n.style.display !== 'none' && n.offsetWidth > 0)
        .map((n) => {
          const r = n.getBoundingClientRect();
          return { text: n.textContent ?? '', l: r.left, r: r.right, t: r.top, b: r.bottom };
        })
    );

    expect(boxes.length, 'no labels are visible at all').toBeGreaterThan(0);

    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) {
          overlaps.push(`${a.text} / ${b.text}`);
        }
      }
    }
    expect(overlaps, 'labels are drawn on top of each other').toEqual([]);
  });

  test('camera crosses to the other campus when it is chosen', async ({ page }) => {
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const before = await canvasStats(page);
    await page.getByTestId('place-pruefening').click();
    // The move is eased over ~1.4 s; sample after it has settled.
    await page.waitForTimeout(2500);
    const after = await canvasStats(page);

    expect(after.distinctColours).not.toBe(before.distinctColours);
    // Still a real, lit scene after the move rather than a camera buried in the ground.
    expect(after.meanChannel).toBeGreaterThan(40);
  });

  test('every raster is the same way up', async ({ page }) => {
    // The drape was once uploaded flipped relative to the heightmap and land cover, so the
    // orthophoto sat on the terrain mirrored north-south — about 370 m out. The buildings, which
    // are placed in world metres and never sample a UV, stayed put, so the symptom presented as
    // "the buildings are on the field" and sent the search into the pipeline, where the data
    // turned out to be exactly right. This is the assertion that names the real fault.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const agree = await page.evaluate(
      () =>
        (window as unknown as { __campus: { rastersShareOrientation: boolean } }).__campus
          .rastersShareOrientation
    );
    expect(agree, 'a terrain raster is uploaded mirrored relative to the others').toBe(true);
  });

  test('the keys take the camera, and the instruments say so', async ({ page }) => {
    // ⚠️ This test used to click a `drone-toggle` button. There is none: the camera and the map
    // are one mode now, and pressing a movement key is what takes the camera. So the way IN is a
    // keypress, and the HUD appearing is the interface confirming that the wheel and the drag
    // have changed meaning.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await expect(page.getByTestId('drone-hud')).toBeHidden();
    // The only thing that says the keys exist, now that there is no button.
    await expect(page.getByTestId('drone-hint')).toContainText(/W A S D/);

    // Flying has to change something. Altitude is the cheapest honest proof, and E climbs.
    //
    // ⚠️ Not R. R used to be a duplicate of E; it now swings the camera around the point in the
    // middle of the view, which is deliberately a *horizontal* circle — altitude does not move, so
    // the assertion below would never fire.
    await page.keyboard.down('e');
    const hud = page.getByTestId('drone-hud');
    await expect(hud).toBeVisible();
    await expect(page.getByTestId('drone-hint')).toBeHidden();
    await expect(page.getByTestId('drone-altitude')).not.toHaveText('—');
    const before = await page.getByTestId('drone-altitude').innerText();
    await page.waitForTimeout(1200);
    await page.keyboard.up('e');
    await expect
      .poll(async () => page.getByTestId('drone-altitude').innerText(), { timeout: 5000 })
      .not.toBe(before);

    // Escape must work without aiming, because the camera is moving — and it matters more with no
    // button to click: otherwise the only way out is to stop touching anything and wait it out.
    await page.keyboard.press('Escape');
    await expect(hud).toBeHidden();
  });
});

test.describe('The app offers only what its data supports', () => {
  test('the occupancy lens exists now that room geometry does', async ({ page }) => {
    // ⚠️ REPLACED, not deleted. This test used to assert that NO lens was offered, because OTH
    // had no room data and a lens over an empty building reads as a bug rather than as missing
    // data. Its own comment said to replace it when the feature shipped — it has: Gebäude K's
    // ground floor is 28 surveyed OSM outlines and every other floor is generated inside the
    // real footprint. An assertion about an absence becomes an assertion about a regression the
    // moment the thing exists.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    await expect(page.getByTestId('lens-occupancy')).toBeVisible();
    // Flow is still unbuilt, so it must still be absent.
    await expect(page.getByTestId('lens-flow')).toHaveCount(0);
  });

  test('the real rooms are real and are marked as such', async ({ page }) => {
    // The honesty claim in one assertion: the twin must be able to say which of its rooms it
    // measured and which it drew itself. If everything reports `generated`, the join broke; if
    // nothing does, something is lying.
    //
    // ⚠️ REAL now means `plan` OR `measured`. Gebäude K's outlines come from OTH's published CAD
    // sheets, which superseded 24 of the 25 OpenStreetMap ones — counting only `measured` watched
    // the hero building fall from 25 real rooms to 1 and called it a pass, because 1 still
    // cleared a "greater than zero" bar. The floor is now set against the real total.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForScene(page);

    const stats = await page.evaluate(async () => {
      const res = await fetch('/terrain/oth-regensburg/rooms.json');
      if (!res.ok) return null;
      const meta = await res.json();
      const real = meta.rooms.filter(
        (r: { provenance?: string }) => r.provenance === 'measured' || r.provenance === 'plan'
      );
      return {
        total: meta.rooms.length,
        real: real.length,
        generated: meta.rooms.filter((r: { provenance?: string }) => r.provenance === 'generated')
          .length,
        withOccupancy: meta.withOccupancy,
        heroBuildingHasReal: real.some((r: { building: string }) => r.building === 'K'),
        namedExample: real.find((r: { name?: string }) => r.name)?.name ?? null,
      };
    });

    expect(stats, 'rooms.json did not load').not.toBeNull();
    expect(stats!.total).toBeGreaterThan(500);
    // 64 rooms are read off the floor plans plus whatever OSM still contributes. A floor near zero
    // means the join has silently broken; both provenances must still be present, because a build
    // that quietly reclassified everything as generated would also "pass" a one-sided check.
    expect(stats!.real).toBeGreaterThan(40);
    expect(stats!.generated).toBeGreaterThan(0);
    expect(stats!.heroBuildingHasReal, 'Gebäude K lost its real rooms').toBe(true);
    expect(stats!.withOccupancy, 'no room carries a booking').toBeGreaterThan(0);
    expect(stats!.namedExample).toMatch(/K \d/);
  });
});
