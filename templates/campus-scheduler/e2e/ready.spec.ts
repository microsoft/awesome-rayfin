import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * What "the campus is ready" has to MEAN.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE A READINESS GATE THAT DOES NOT GATE IS INVISIBLE. Every spec in this
 * folder opens with a wait, and for a long time that wait was `campus-canvas` being visible — which
 * the canvas is from the first paint, loading card and all. Nothing failed. The suite stayed green
 * while its setup was resolving against a download in progress, and the fault only surfaced when a
 * performance measurement built on that gate produced a regression that did not exist.
 *
 * So the gate is pinned here to a property of the SCENE rather than of the DOM: once
 * `waitForCampusReady` resolves, WebGL must have taken the canvas over. Three.js sizes the drawing
 * buffer to the element when the renderer is created, so a canvas still sitting at the untouched
 * HTML default of 300×150 proves the scene never started — which is precisely the state the old
 * gate let through.
 */
test('readiness means the renderer owns the canvas, not just that the element exists', async ({
  page,
}) => {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);

  const buffer = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="campus-canvas"]');
    if (!canvas) return null;
    return { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth };
  });

  expect(buffer).not.toBeNull();
  // 300×150 is the size a <canvas> reports when no context has ever sized it. Asserting "not the
  // default" rather than an exact figure keeps this independent of viewport and device pixel ratio,
  // both of which legitimately vary between the local run and CI.
  expect(buffer!.width).not.toBe(300);
  expect(buffer!.height).not.toBe(150);
  // And the buffer should track the element it is drawn into, which is what rules out a stale size
  // left behind by an earlier layout.
  expect(buffer!.width).toBeGreaterThanOrEqual(buffer!.cssWidth);
});
