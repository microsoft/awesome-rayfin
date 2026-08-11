import { expect, test } from '@playwright/test';

/**
 * The merged camera — the map and the drone as one mode.
 *
 * The arithmetic, the latch and the hand-back geometry are covered in
 * `src/twin3d/__tests__/flyControls.test.ts` against a stub. What only a real browser can show is
 * the two things that need a live OrbitControls:
 *
 *   **Two camera models being live at once.** OrbitControls rewrites the camera from its own
 *   target every frame, so if it is not disabled the drone is dragged back towards the orbit
 *   centre as fast as the keys push it away — and the symptom is not an error, it is a camera that
 *   feels sticky.
 *
 *   **The hand-back.** `OrbitControls.update()` enforces its polar and distance limits by *moving
 *   the camera*, unconditionally, on the frame after it gets the target back. With
 *   `maxPolarAngle` at 0.48π the old hand-back was out of bounds for any view pitched up by more
 *   than −3.6°, which is nearly all of them, and the massif jumped sideways every time free flight
 *   ended. A stub cannot show that; the real class can, and did.
 *
 * ⚠️ These assert on `data-cam`, not on pixels. The sky and the haze are recomputed from the
 * camera every frame, so two consecutive frames are never identical: a screenshot can show that
 * something changed but never that nothing did — which is exactly what the hand-back has to prove.
 */

const CANVAS = 'twin3d-canvas';

/** Comfortably longer than the module's two-second grace window. */
const HAND_BACK_MS = 4_000;

/**
 * The camera-state readout, which is what is left where the toggle used to be.
 *
 * ⚠️ `data-flying`, not `aria-pressed`. There is no button any more — the keys are the whole
 * control — so nothing here is pressable and a pressed state would be a lie.
 */
const state = (page: import('@playwright/test').Page) => page.getByTestId('drone-state');

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function cam(page: import('@playwright/test').Page): Promise<number[]> {
  const raw = await page.getByTestId(CANVAS).getAttribute('data-cam');
  expect(raw, 'the canvas publishes no camera position').not.toBeNull();
  return raw!.split(',').map(Number);
}

/**
 * Hold `key` until the camera has travelled `minMetres`, then let go.
 *
 * ⚠️ Not a timed press. The render loop clamps its frame delta, so a fixed hold measures the frame
 * rate as much as the speed — and this camera has inertia, so the first tenth of a second of any
 * press covers almost no ground at all. How many frames it took is the machine's business; that it
 * got there is the assertion.
 *
 * ⚠️ The key is re-asserted on every poll rather than pressed once, and that is not belt-and-braces.
 * The controls clear every held key on `blur` — they have to, or a key held while the window loses
 * focus leaves the camera drifting away on its own for ever — and a synthetic keydown does not need
 * focus to be delivered, so a suite tearing down the previous browser context can steal focus
 * between the press and the first poll. The camera then never moves at all, which is exactly the
 * failure this reported: `Received: 0` in a full run, passing on its own. `held` is a Set, so
 * repeating the press is free.
 */
async function flyUntilMoved(
  page: import('@playwright/test').Page,
  key: string,
  minMetres: number
): Promise<void> {
  const start = await cam(page);
  const press = () =>
    page.evaluate(
      (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })),
      key
    );
  await press();
  try {
    await expect
      .poll(
        async () => {
          await press();
          return distance(start, await cam(page));
        },
        {
          timeout: 30_000,
          message: `the drone never travelled ${minMetres} m with ${key} held`,
        }
      )
      .toBeGreaterThan(minMetres);
  } finally {
    // Always release, even when the assertion failed: a stuck key would drift the camera through
    // every test that follows in this file.
    await page.evaluate(
      (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })),
      key
    );
  }
}

/**
 * Wait until the camera has actually stopped, rather than for a stopwatch.
 *
 * ⚠️ This camera has mass. After the key comes up it sheds speed exponentially, and from cruise
 * that takes something over a second to fall under the threshold at which the module parks it. Two
 * assertions here are about the camera being *perfectly* still, and both of them failed against a
 * fixed 700 ms wait by half a metre — which was the coast, working exactly as designed.
 *
 * ⚠️ It reads the instrument rather than sampling positions. Two equal samples do not mean the
 * camera is parked, they mean no frame was drawn between them — and under the GPU contention of a
 * full suite run that happens often enough that both assertions flaked while passing alone.
 */
async function waitUntilParked(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('drone-hud')).toHaveAttribute('data-speed-ms', '0.00', {
    timeout: 15_000,
  });
}

/**
 * Hold an arrow key for the duration of `body`.
 *
 * ⚠️ This is how these specs buy time. Waiting for the coast to finish takes over a second, the
 * grace window is two, and anything measured after that is measuring OrbitControls instead. An
 * arrow key resets the window on every frame and turns the view *in place*, so the camera's
 * position — which is the only thing asserted below — is untouched by it.
 */
async function holdingTheCamera(
  page: import('@playwright/test').Page,
  body: () => Promise<void>
): Promise<void> {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  );
  try {
    await body();
  } finally {
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
    );
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?aoi=oberstdorf');
  await expect(page.getByTestId(CANVAS)).toHaveAttribute('data-ready', 'true', {
    timeout: 180_000,
  });
});

test('the map has the camera to begin with, and says which key takes it', async ({ page }) => {
  await expect(state(page)).toHaveAttribute('data-flying', 'false');
  await expect(page.getByTestId('drone-hud')).toHaveCount(0);
  // ⚠️ The keys are the only control; with no hint the merge is invisible and they may as well not
  // exist.
  await expect(state(page)).toContainText(/W A S D/);
});

/** The merge, in one test: the key you were going to press is the mode switch. */
test('W takes the camera, without anyone pressing a button', async ({ page }) => {
  await flyUntilMoved(page, 'w', 200);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');
  // The instruments are the only thing telling the viewer the wheel changed meaning.
  await expect(page.getByTestId('drone-hud')).toBeVisible();
  await expect(state(page)).toContainText(/Kollision|collision/i);
});

/**
 * ⚠️ The way out for anyone who does not want to wait out the grace window. It matters more than
 * it looks now that the toggle is gone: without it the only way to give the map back is to stop
 * touching anything and wait it out.
 */
test('Escape gives the map back at once', async ({ page }) => {
  await flyUntilMoved(page, 'w', 200);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  await page.keyboard.press('Escape');
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: 1_000 });
  await expect(page.getByTestId('drone-hud')).toHaveCount(0);
});

test('the orbit camera does not drag the drone back', async ({ page }) => {
  await flyUntilMoved(page, 'w', 200);

  await holdingTheCamera(page, async () => {
    await waitUntilParked(page);
    // With OrbitControls still live the camera would creep back towards its target with nothing
    // pushing it — and turning would swing it around that target rather than in place.
    const parked = await cam(page);
    await page.waitForTimeout(1_000);
    expect(distance(parked, await cam(page)), 'the camera drifted with nothing pushing it').toBe(0);
    await expect(state(page)).toHaveAttribute('data-flying', 'true');
  });
});

test('Q and E move in world up and down', async ({ page }) => {
  await flyUntilMoved(page, 'w', 100);
  const before = await cam(page);
  await flyUntilMoved(page, 'e', 50);
  const up = await cam(page);
  expect(up[1]).toBeGreaterThan(before[1]);

  await flyUntilMoved(page, 'q', 50);
  expect((await cam(page))[1]).toBeLessThan(up[1]);
});

// ── The hand-back ──────────────────────────────────────────────────────────

test('the map takes the camera back on its own once the keys stop', async ({ page }) => {
  await flyUntilMoved(page, 'w', 200);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  // ⚠️ The grace window is the design, not a delay to be tuned away: handing back the moment the
  // key comes up would change what the wheel does while the viewer is still flying — and with
  // inertia the camera is still moving then.
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: HAND_BACK_MS });
  await expect(page.getByTestId('drone-hud')).toHaveCount(0);
});

/** ⚠️ The regression the merged module exists to fix. See the file header. */
test('handing back does not move the camera', async ({ page }) => {
  await flyUntilMoved(page, 'w', 200);
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: HAND_BACK_MS });
  const parked = await cam(page);

  // A full second past the hand-back, so the orbit camera has had many frames to enforce its
  // limits. Metres, not exactness: damping settles a residual of well under one.
  await page.waitForTimeout(1_000);
  expect(
    distance(parked, await cam(page)),
    'the camera jumped when the map took it back'
  ).toBeLessThan(1);
});

// ── The contested inputs ───────────────────────────────────────────────────

test('the wheel is the throttle while flying, and the map zoom when not', async ({ page }) => {
  // ⚠️ The drone must not claim the wheel globally. Everyone who never flies still expects to zoom
  // the map, and OrbitControls owns the wheel to do it.
  const parked = await cam(page);
  await page.mouse.move(800, 300);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => distance(parked, await cam(page)), {
      message: 'the wheel no longer zooms the map',
    })
    .toBeGreaterThan(0);

  // Take the camera the only way there is now, then let the coast finish so the wheel test below
  // is measuring the wheel rather than the tail of the last keypress.
  await flyUntilMoved(page, 'w', 100);
  await expect(page.getByTestId('drone-hud')).toBeVisible();

  await holdingTheCamera(page, async () => {
    await waitUntilParked(page);
    const flying = await cam(page);

    // Now the same gesture is a throttle, so it changes how fast the camera would fly and moves
    // the camera not at all.
    await page.mouse.move(800, 300);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(400);
    expect(distance(flying, await cam(page)), 'the wheel still zoomed while flying').toBe(0);
  });
});

test('a drag looks around while flying, rather than orbiting', async ({ page }) => {
  await flyUntilMoved(page, 'w', 100);
  await holdingTheCamera(page, () => waitUntilParked(page));
  const before = await cam(page);

  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(1_000, 450, { steps: 20 });
  await page.mouse.up();

  // ⚠️ Looking is not moving. An orbit would have swung the camera around a centre; the gimbal
  // turns it where it stands, so the position is untouched.
  expect(distance(before, await cam(page)), 'the drag moved the camera').toBe(0);
});

test('starting a tour takes the camera back', async ({ page }) => {
  await flyUntilMoved(page, 'w', 100);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  // A tour drives the camera. Leaving the drone engaged would mean each stop flew somewhere and
  // the viewer's keys immediately pulled the camera off it.
  await page.getByTestId('toggle-tour').click();
  await expect(state(page)).toHaveAttribute('data-flying', 'false');
  await page.getByTestId('toggle-tour').click();
});
