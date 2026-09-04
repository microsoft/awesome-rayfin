import { expect, test, type Page } from "@playwright/test";

/**
 * The recorded day standing in for a live source that has gone quiet.
 *
 * 🔴 Why this exists: the live provider is a **free beta with no SLA and no second supplier**, and
 * it has been mute for a whole day — subscription accepted, zero frames, not even an error frame.
 * Live traffic is the thing that makes this app worth showing, so "their service is down" must not
 * render as an empty sea in front of a customer.
 *
 * ⚠️ And the opposite failure would be far worse. A recording presented as live is a false claim on
 * screen, so every assertion below is really one assertion: **the count and the caveat travel
 * together.**
 *
 * These skip when the relay is not standing in — which is the normal, healthy state, and also what
 * the other relay-dependent specs in this suite do rather than fail on someone else's uptime.
 */

const RELAY = process.env.VITE_AIS_RELAY ?? "http://127.0.0.1:8788";

async function relayStandingIn(): Promise<boolean> {
  try {
    const res = await fetch(`${RELAY}/ais/health`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return false;
    const health = await res.json();
    return health.fallback === true && (health.vessels ?? 0) > 0;
  } catch {
    return false;
  }
}

async function liveOn(page: Page): Promise<void> {
  await page.goto("/?theme=dark");
  await expect(page.locator('[data-testid="twin3d-canvas"]'))
    .toHaveAttribute("data-ready", "true", { timeout: 120_000 });
  await page.locator('[data-testid="twin3d-live-toggle"]').click();
  await page.locator('[data-testid="twin3d-live-vessels"]').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(5000);
}

test.describe("recorded stand-in", () => {
  test.slow();

  test("shows the ships AND says they are a recording, in the same line", async ({ page }) => {
    test.skip(!(await relayStandingIn()), "relay is not standing in — nothing to assert");
    await liveOn(page);

    const bar = page.locator('[data-testid="twin3d-live-vessels"]');
    await expect(bar).toHaveAttribute("data-feed", "fallback");

    // 🔴 The count and the word "Aufzeichnung" must be in the SAME string. A number here with the
    // caveat parked in a tooltip reads as live to everyone who does not hover.
    const headline = await bar.innerText();
    expect(headline).toMatch(/Aufzeichnung/);
    expect(headline).toMatch(/\d+\s*Schiffe/);

    // …and there is a second, unmissable statement next to it.
    await expect(page.locator('[data-testid="twin3d-live-synthetic"]'))
      .toContainText("keine Echtzeitdaten");

    // Real vessels, really moving.
    expect(await page.locator('[data-testid="twin3d-live-row"]').count()).toBeGreaterThan(0);
  });

  test("never offers an external lookup for an invented identity", async ({ page }) => {
    test.skip(!(await relayStandingIn()), "relay is not standing in — nothing to assert");
    await liveOn(page);

    // 🔴 The stand-in emits made-up MMSIs (900000000 + index). Handing one to a public AIS service
    // gives a failed lookup, and a verification link that fails is worse than none: it withdraws
    // the offer the panel is making. The place is real even when the identity is not.
    const href = await page.locator('[data-testid="twin3d-live-verify"]').first()
      .getAttribute("href");
    expect(href, "external link is missing").toBeTruthy();
    // Host-agnostic on purpose: what must never happen is a *per-vessel lookup* of an identity the
    // relay invented, whichever service that lookup would go to.
    expect(href, "a synthetic MMSI was sent to a vessel lookup").not.toMatch(/vessels\/details/);
    expect(href, "a synthetic MMSI was sent to a vessel lookup").not.toMatch(/mmsi=9\d{8}/);
    expect(href).toContain("centerx:");
  });

  test("credits the recording, not the live provider it never received from", async ({ page }) => {
    test.skip(!(await relayStandingIn()), "relay is not standing in — nothing to assert");
    await liveOn(page);

    const footer = await page.locator('[data-testid="twin3d-notice"]').innerText();
    // Attribution follows what is actually on the wire — crediting the live provider for vessels
    // it did not send would be a false claim on a permanent notice.
    expect(footer).toMatch(/aufgezeichneter Tag/);
    expect(footer).not.toMatch(/Quelle\s+aisstream/);
    // ⚠️ And it must be a SENTENCE, not the internal enum. The stand-in branch once fell through to
    // `status.source`, so the footer read "Quelle replay" — a code token shown to the reader as
    // attribution, which is unreadable to the audience and looks like a bug in the data.
    expect(footer, "the internal source enum leaked into the notice")
      .not.toMatch(/Quelle\s+replay/);
    // And the identity claim branches on what the data carries.
    expect(footer).toMatch(/Kennungen synthetisch/);
  });
});
