import { expect, test, type Page } from "@playwright/test";

/**
 * Committing a sensor plan to Fabric, and getting it back.
 *
 * 🔴 Why this feature exists: a GIS or a radar-planning tool also draws a viewshed. What none of
 * them does is let a planner **commit** the decision into a governed store the rest of the estate
 * can read. Everything this app produced before this lived in browser memory and died with the tab.
 *
 * The property that matters, and the one asserted here, is that a restored plan reproduces the
 * **same solve** — not a similar one. If a committed plan came back with figures that differed even
 * slightly from the plan that was committed, the record would be worse than no record, because it
 * would look authoritative while quietly disagreeing with the document that was forwarded from it.
 *
 * Skips when no backend is configured, like the other service-dependent specs here.
 */

async function ready(page: Page): Promise<void> {
  await page.goto("/?theme=dark");
  await expect(page.locator('[data-testid="twin3d-canvas"]'))
    .toHaveAttribute("data-ready", "true", { timeout: 120_000 });
  await page.locator('[data-testid="twin3d-play"]').click();   // deterministic picking
}

/**
 * ⚠️ The FIRST site has to be placed by a real gesture. `applySites` on the scene handle moves the
 * scene but not React's `sitePlaced`, and the commit panel is gated on that — driving only the
 * handle hides the very panel under test. Cost me a confused test run.
 */
async function placeNetwork(page: Page): Promise<void> {
  const box = (await page.locator('[data-testid="twin3d-canvas"]').boundingBox())!;
  // ⚠️ 0.62 of the height: at 0.30 the ray hits sky and nothing is placed.
  await page.mouse.dblclick(box.x + box.width * 0.55, box.y + box.height * 0.62);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    (window as any).__maritimeScene.applySites([
      { col: 350, row: 520, mastM: 25 },
      { col: 300, row: 700, mastM: 40 },
    ]);
  });
  await page.waitForTimeout(1200);
}

const figures = (page: Page) => page.evaluate(() => {
  const h = (window as any).__maritimeScene;
  return {
    sites: h.sites().map((s: any) => ({ col: s.col, row: s.row, mastM: s.mastM })),
    visibleKm2: h.coverageStats().visibleKm2,
    observed: h.networkStats()?.observedPassages ?? null,
  };
});

test.describe("committing a plan to Fabric", () => {
  test.slow();

  test("writes the plan, lists it, and restores the identical solve", async ({ page }) => {
    await ready(page);
    await placeNetwork(page);

    const panel = page.locator('[data-testid="twin3d-plans"]');
    test.skip(!(await panel.count()), "no writeback backend configured");

    const before = await figures(page);
    expect(before.sites).toHaveLength(2);

    await page.locator('[data-testid="twin3d-plan-name"]').fill("E2E Roundtrip");
    await page.locator('[data-testid="twin3d-plan-commit"]').click();
    const message = page.locator('[data-testid="twin3d-plan-message"]');
    await message.waitFor({ timeout: 90_000 });
    // The path is part of the confirmation on purpose: "saved" without saying where is not a
    // confirmation anybody can check.
    await expect(message).toContainText("Files/sensor-plans");

    await expect(page.locator('[data-testid="twin3d-plan-row"]').first()).toBeVisible();

    // Replace the network with a deliberately wrong one, so a restore that silently does nothing
    // cannot pass.
    await page.evaluate(() => {
      (window as any).__maritimeScene.applySites([{ col: 350, row: 520, mastM: 5 }]);
    });
    await page.waitForTimeout(1000);
    expect((await figures(page)).sites).toHaveLength(1);

    await page.locator('[data-testid="twin3d-plan-load"]').first().click();
    await page.waitForTimeout(3000);

    const after = await figures(page);
    // 🔴 Identical, not close. The sites come back from the stored GRID CELL rather than from a
    // rounded lat/lon, which is what makes the figures reproduce exactly.
    expect(after.sites).toEqual(before.sites);
    expect(after.visibleKm2).toBe(before.visibleKm2);
    expect(after.observed).toBe(before.observed);
  });

  test("says what it wrote and where, and never quotes a price", async ({ page }) => {
    await ready(page);
    await placeNetwork(page);
    const panel = page.locator('[data-testid="twin3d-plans"]');
    test.skip(!(await panel.count()), "no writeback backend configured");

    // PLAN §13.7: mast cost depends on civil works, site access and frame agreements, none of
    // which is in any dataset here. The panel states mast metres — the quantity a price list is
    // applied to — and never a currency.
    const text = await panel.innerText();
    expect(text).not.toMatch(/[€$£]|Preis|Kosten/i);
    // And it admits what it cannot prove about the author.
    expect(text).toMatch(/behauptet/);
  });

  test("a committed plan can be withdrawn, and not by one stray click", async ({ page }) => {
    await ready(page);
    await placeNetwork(page);

    const panel = page.locator('[data-testid="twin3d-plans"]');
    test.skip(!(await panel.count()), "no writeback backend configured");

    // 🔴 Commit our OWN plan first. A delete test that reaches for whatever row happens to be at
    // the top would destroy real work the moment somebody used the app before running the suite.
    const name = `e2e-delete-${Date.now()}`;
    await page.locator('[data-testid="twin3d-plan-name"]').fill(name);
    await page.locator('[data-testid="twin3d-plan-commit"]').click();

    const rows = page.locator('[data-testid="twin3d-plan-row"]');
    const mine = rows.filter({ hasText: name });
    await expect(mine).toHaveCount(1, { timeout: 120_000 });
    const before = await rows.count();

    const del = mine.first().locator('[data-testid="twin3d-plan-delete"]');

    // ⚠️ The confirm step is the point of the test, not decoration. One click must ARM and change
    // the label; the row has to survive it. A single-click delete in a list of near-identical rows
    // destroys the wrong plan sooner or later, and nothing here can undo that.
    await expect(del).toHaveText(/löschen/);
    await del.click();
    await expect(del).toHaveText(/wirklich/);
    await expect(mine).toHaveCount(1);

    await del.click();
    await expect(mine).toHaveCount(0, { timeout: 120_000 });
    await expect(rows).toHaveCount(before - 1);

    // 🔴 And it must say what it has NOT deleted. The Delta tables the semantic model reads are a
    // projection refreshed by a separate tool, so until that runs Power BI still counts this plan.
    // Reporting a bare "gelöscht" would be true of one store and false of the other.
    await expect(page.locator('[data-testid="twin3d-plan-message"]'))
      .toContainText(/Semantikmodell/);
  });
});
