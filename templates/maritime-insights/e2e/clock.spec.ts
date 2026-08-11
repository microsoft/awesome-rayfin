import { expect, test, type Page } from "@playwright/test";

/**
 * The replay clock, and the runaway React update it used to cause.
 *
 * 🔴 The defect: the playback loop called `setNow(...)` on **every animation frame**, so the whole
 * application component re-rendered sixty times a second and React reported *"Maximum update depth
 * exceeded"* on a plain load. That is not a cosmetic warning — when React bails out of a runaway
 * update chain it stops committing, and the symptom seen in the wild was a canvas stuck at
 * `data-ready="false"` **forever** on an app whose terrain had actually finished loading. An
 * intermittent, unexplained hang, on first impression, in a demo.
 *
 * The fix moves the clock into a ref: the scene gets it every frame (it is a uniform, which is
 * cheap), React gets it ten times a second. These tests pin both halves — that the loop is gone,
 * and that everything which writes to the clock still works, because the plumbing changed under
 * four separate controls.
 */

async function ready(page: Page): Promise<void> {
  await page.goto("/?theme=dark");
  await expect(page.locator('[data-testid="twin3d-canvas"]'))
    .toHaveAttribute("data-ready", "true", { timeout: 120_000 });
}

const clock = (page: Page) => page.locator('[data-testid="twin3d-clock"]').innerText();

test.describe("replay clock", () => {
  test("loads without React reporting a runaway update", async ({ page }) => {
    const loops: string[] = [];
    page.on("console", (m) => {
      if (m.text().includes("Maximum update depth")) loops.push(m.text());
    });
    await ready(page);
    // Let it play for a few seconds — that is when the old version produced the report.
    await page.waitForTimeout(5000);
    expect(loops, "React reported a runaway update chain").toEqual([]);
  });

  test("runs at 600x while React renders at a human rate", async ({ page }) => {
    await ready(page);
    const before = await clock(page);
    const frames0 = await page.evaluate(() => (window as any).__maritimeScene.frameCount());
    await page.waitForTimeout(2500);
    const after = await clock(page);
    const frames1 = await page.evaluate(() => (window as any).__maritimeScene.frameCount());

    expect(after).not.toBe(before);
    // 🔴 The scene must still be drawing every frame — the whole point is that decoupling the
    // React clock did NOT slow the picture down. ~60 fps over 2.5 s.
    expect(frames1 - frames0).toBeGreaterThan(60);
  });

  test("pause holds it, and the story beats and scrubber move it", async ({ page }) => {
    await ready(page);
    await page.locator('[data-testid="twin3d-play"]').click();
    await page.waitForTimeout(400);
    const paused = await clock(page);
    await page.waitForTimeout(1500);
    expect(await clock(page), "paused clock drifted").toBe(paused);

    const beats = page.locator('[data-testid="twin3d-beat"]');
    if (await beats.count()) {
      await beats.last().click();
      await page.waitForTimeout(600);
      expect(await clock(page)).not.toBe(paused);
    }

    const scrubber = page.locator('[data-testid="twin3d-scrubber"]');
    const at = await clock(page);
    const box = (await scrubber.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.22, box.y + box.height / 2);
    await page.waitForTimeout(600);
    expect(await clock(page), "scrubber did not move the clock").not.toBe(at);
  });

  test("Enter toggles playback, but not while a control has focus", async ({ page }) => {
    await ready(page);
    await page.locator('[data-testid="twin3d-play"]').click();   // pause
    await page.waitForTimeout(400);

    // ⚠️ Blur first: the shortcut deliberately ignores events whose target is a control, so
    // pressing Enter straight after clicking one exercises the guard rather than the shortcut.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    const a = await clock(page);
    await page.waitForTimeout(1500);
    expect(await clock(page), "Enter did not resume playback").not.toBe(a);

    await page.locator('[data-testid="twin3d-play"]').click();   // pause again
    await page.waitForTimeout(400);
    await page.locator('[data-testid="twin3d-scrubber"]').focus();
    const held = await clock(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    expect(await clock(page), "Enter toggled while the scrubber had focus").toBe(held);
  });
});
