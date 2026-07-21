import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Wait for the demo's simulated data latency (700ms) to resolve so we assert
// against loaded content, not skeletons.
async function waitForContent(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByText("Finance Analytics").first()).toBeVisible();
  // KPI values render once the query resolves; give the static adapter its
  // simulated latency plus headroom.
  await page.waitForTimeout(1500);
}

test.describe("Finance Analytics demo", () => {
  test("loads and shows the app shell", async ({ page }) => {
    await waitForContent(page);
    await expect(page.getByRole("navigation", { name: "Views" }).first()).toBeVisible();
    await expect(page.getByText("Finance Analytics · Fabric App Standard")).toBeVisible();
  });

  test("navigates to another view via the sidebar", async ({ page }) => {
    await waitForContent(page);
    const nav = page.getByRole("navigation", { name: "Views" }).first();
    await nav.getByRole("button", { name: /Detail Grid/i }).click();
    await expect(page).toHaveURL(/view=detail/);
  });

  test("has no serious or critical accessibility violations on Overview", async ({ page }) => {
    await waitForContent(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
  });
});
