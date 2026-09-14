import { expect, type Page } from '@playwright/test';

/**
 * Waiting for the campus to be READY, not merely PRESENT.
 *
 * ⚠️ `campus-canvas` IS VISIBLE FROM THE FIRST PAINT. The canvas element is rendered
 * unconditionally by `Twin3DView`; the loading card sits on top of it. So
 * `expect(getByTestId('campus-canvas')).toBeVisible()` — which is how roughly twenty specs in this
 * folder gated their setup — resolves while the scene is still downloading tens of megabytes of
 * terrain, buildings and aerial photography. Everything after that line ran against a loading
 * screen that merely happened to contain a canvas.
 *
 * This is not theoretical. It cost most of a session: a "severe performance regression" was
 * measured, isolated and nearly fixed before the screenshot that was supposed to confirm the fix
 * showed `Campus wird geladen · Schritt 3 von 4` instead of a campus. The 3D scene had not started,
 * so the WebGL drawing buffer was still at its untouched 300×150 default and every frame was
 * cheap; opening the report finished the load, the buffer went to full size, and the frame cost
 * that appeared was software rasterisation in a GPU-less headless browser. Nothing was wrong with
 * the app. The measurement had compared *not loaded* against *loaded* and called the difference a
 * regression.
 *
 * The real signal is the absence of the loading card: `Twin3DView` renders `twin3d-loading` while
 * `ready` is false and unmounts it the moment `initCampus3D` resolves — which is exactly when the
 * render loop, the labels and the room handle all exist.
 *
 * ⚠️ THE CANVAS CHECK IS KEPT ON PURPOSE. Waiting only for the overlay to disappear would also be
 * satisfied by the error branch, which unmounts the loading card and renders a failure message
 * instead. A test whose setup passes when the scene FAILED to build is worse than no setup at all,
 * so both conditions are asserted.
 */
export async function waitForCampusReady(page: Page, timeout = 90_000) {
  await expect(page.getByTestId('campus-canvas')).toBeVisible({ timeout });
  await expect(page.getByTestId('twin3d-loading')).toBeHidden({ timeout });
}
