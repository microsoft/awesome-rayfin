import { expect, test, type Page } from "@playwright/test";

/**
 * 🔴 Reachability, not presence.
 *
 * Every assertion here failed on the shipped build at 1280 × 800, and none of them could have been
 * caught by a unit test:
 *
 *   * the control panel rendered **1393 px tall inside a 912 px window** with `overflow: visible`
 *     on a page that cannot scroll, so its lower third simply had no way of being reached;
 *   * "Vorschlag übernehmen" sat at y=930 and failed `elementFromPoint` — the optimiser computed a
 *     correct answer and then offered no way to use it;
 *   * the optimiser was rendered only once a site existed, so the one feature that answers
 *     *"where should these go?"* was withheld from anyone who had not already answered it.
 *
 * All three read as "the AI placement is broken" to someone using the app.
 */

/** Wait for the terrain to finish loading — the assets are tens of megabytes. */
async function ready(page: Page, aoi = "schlei") {
  await page.goto(`/?aoi=${aoi}`);
  await expect(page.locator('[data-testid="twin3d-canvas"]'))
    .toHaveAttribute("data-ready", "true", { timeout: 90_000 });
  await expect(page.locator('[data-testid="twin3d-site"]')).toBeVisible();
}

/** Is the element's own centre the thing a click at that point would actually hit? */
async function centreIsClickable(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
    const hit = document.elementFromPoint(cx, cy);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  }, testId);
}

test.describe("placing a site", () => {
  /**
   * 🔴 A single click used to place a mast. Orbiting a 3D scene is mostly clicks that were meant
   * to be drags, so the map kept gaining sensor sites nobody asked for — and a stray site is not
   * cosmetic: the coverage field re-solves and every figure on the panel then describes it.
   * Placing is now the deliberate gesture; inspecting a vessel, which costs nothing to undo,
   * stays on a single click.
   */
  test("needs a double click, and neither a click nor a drag disturbs the map", async ({ page }) => {
    await ready(page);
    const canvas = page.locator('[data-testid="twin3d-canvas"]');
    const box = (await canvas.boundingBox())!;
    // ⚠️ Low in the frame on purpose. The upper third of this view is sky, where the ray hits
    // nothing at all — a point chosen there would make this test pass for the wrong reason.
    // Measured: at 30 % of the height the pick misses; from 45 % down it lands on ground.
    const x = box.x + box.width * 0.55;
    const y = box.y + box.height * 0.62;
    const rows = page.locator('[data-testid="twin3d-site-row"]');

    await page.mouse.click(x, y);
    await page.waitForTimeout(800);
    await expect(rows).toHaveCount(0);
    await expect(page.locator('[data-testid="twin3d-site-hint"]')).toBeVisible();

    // 🔴 The gesture that actually caused this. Orbiting is press-move-release, and the browser
    // still reports a click at the end of it — which used to drop a mast wherever the drag began.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 50, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    await expect(rows).toHaveCount(0);

    await page.mouse.dblclick(x, y);
    await expect(rows).toHaveCount(1);
  });
});

test.describe("the control panel", () => {
  test("stays inside the window and scrolls to its own end", async ({ page }) => {
    await ready(page);

    // Fill the panel out: a proposal, applied, is the longest state it has.
    await page.locator('[data-testid="twin3d-optimise-count"]').selectOption("3");
    await page.locator('[data-testid="twin3d-optimise-run"]').click();
    await expect(page.locator('[data-testid="twin3d-optimise-result"]'))
      .toBeVisible({ timeout: 90_000 });
    await page.locator('[data-testid="twin3d-optimise-apply"]').click();
    await expect(page.locator('[data-testid="twin3d-site-row"]').first()).toBeVisible();

    const box = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="twin3d-site"]')!;
      const rect = panel.getBoundingClientRect();
      panel.scrollTop = panel.scrollHeight;
      const last = panel.lastElementChild!.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        overflows: panel.scrollHeight > panel.clientHeight,
        scrolled: panel.scrollTop > 0,
        lastChildBottom: last.bottom,
      };
    });

    // The panel may be taller than it can show — but it must never extend past the window, and
    // whatever it hides must be reachable by scrolling.
    expect(box.bottom).toBeLessThanOrEqual(box.viewportHeight);
    if (box.overflows) {
      expect(box.scrolled).toBe(true);
      expect(box.lastChildBottom).toBeLessThanOrEqual(box.viewportHeight + 2);
    }
  });
});

test.describe("the site optimiser", () => {
  test("is offered before any site exists, and proposes from an empty map", async ({ page }) => {
    await ready(page);

    await expect(page.locator('[data-testid="twin3d-site-hint"]')).toBeVisible();
    await expect(page.locator('[data-testid="twin3d-site-row"]')).toHaveCount(0);

    // The panel, its mast control and its button all exist with nothing placed.
    await expect(page.locator('[data-testid="twin3d-optimise"]')).toBeVisible();
    await expect(page.locator('[data-testid="twin3d-optimise-mast"]')).toBeVisible();
    expect(await centreIsClickable(page, "twin3d-optimise-run")).toBe(true);

    await page.locator('[data-testid="twin3d-optimise-mast"]').selectOption("60");
    await page.locator('[data-testid="twin3d-optimise-count"]').selectOption("2");
    await page.locator('[data-testid="twin3d-optimise-run"]').click();

    const result = page.locator('[data-testid="twin3d-optimise-result"]');
    await expect(result).toBeVisible({ timeout: 90_000 });
    // The height it searched at is stated, and it is the one that was asked for.
    await expect(result).toContainText("Masthöhe 60 m");

    // 🔴 The button that turns the answer into masts has to be clickable, not merely present.
    expect(await centreIsClickable(page, "twin3d-optimise-apply")).toBe(true);
    await page.locator('[data-testid="twin3d-optimise-apply"]').click();

    await expect(page.locator('[data-testid="twin3d-site-row"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="twin3d-mast"]')).toHaveText("60 m");
  });

  test("searches at the height it is given", async ({ page }) => {
    await ready(page);
    await page.locator('[data-testid="twin3d-optimise-count"]').selectOption("1");

    const shareAt = async (mastM: string) => {
      await page.locator('[data-testid="twin3d-optimise-mast"]').selectOption(mastM);
      await page.locator('[data-testid="twin3d-optimise-run"]').click();
      const result = page.locator('[data-testid="twin3d-optimise-result"]');
      await expect(result).toBeVisible({ timeout: 90_000 });
      await expect(result).toContainText(`Masthöhe ${mastM} m`);
      return Number((await page.locator('[data-testid="twin3d-optimise-share"]')
        .textContent())!.replace(/[^\d]/g, ""));
    };

    // Geometry, not tuning: a taller mast cannot see less. If these ever come out equal the mast
    // height is being ignored somewhere between the control and the solver.
    const low = await shareAt("5");
    const high = await shareAt("120");
    expect(high).toBeGreaterThan(low);
  });
});

test.describe("vessel selection", () => {
  test("has a hit area of a similar size in both directions", async ({ page }) => {
    await ready(page);

    const measured = await page.evaluate(() => {
      const scene = (window as unknown as { __maritimeScene: {
        pickVesselFromPointer: (x: number, y: number) => { vessel: string } | null;
        clearVessel: () => void;
      } }).__maritimeScene;
      const rect = document.querySelector('[data-testid="twin3d-canvas"]')!
        .getBoundingClientRect();
      const idAt = (x: number, y: number) => scene.pickVesselFromPointer(x, y)?.vessel ?? null;

      let seed: { x: number; y: number } | null = null;
      let seedId: string | null = null;
      // A pick costs a few milliseconds, so the scan is coarse on purpose — fine enough to land
      // on a vessel, cheap enough not to dominate the run.
      for (let gy = 0.5; gy > -0.5 && !seed; gy -= 0.04) {
        for (let gx = -0.5; gx < 0.5; gx += 0.04) {
          const id = idAt(gx, gy);
          if (id) { seed = { x: gx, y: gy }; seedId = id; break; }
        }
      }
      if (!seed) return null;

      // Measure from the middle of the target, not from the edge the scan happened to meet.
      const inside: [number, number][] = [];
      for (let dy = -0.03; dy <= 0.03; dy += 0.006) {
        for (let dx = -0.03; dx <= 0.03; dx += 0.006) {
          if (idAt(seed.x + dx, seed.y + dy) === seedId) inside.push([seed.x + dx, seed.y + dy]);
        }
      }
      if (!inside.length) return null;
      const cx = inside.reduce((a, p) => a + p[0], 0) / inside.length;
      const cy = inside.reduce((a, p) => a + p[1], 0) / inside.length;
      const edge = (dx: number, dy: number) => {
        let lo = 0, hi = 0.15;
        for (let i = 0; i < 16; i += 1) {
          const mid = (lo + hi) / 2;
          if (idAt(cx + dx * mid, cy + dy * mid) === seedId) lo = mid; else hi = mid;
        }
        return lo;
      };
      const horizontal = (edge(1, 0) + edge(-1, 0)) / 2 * rect.width / 2;
      const vertical = (edge(0, 1) + edge(0, -1)) / 2 * rect.height / 2;
      scene.clearVessel();
      return { horizontal, vertical };
    });

    test.skip(measured === null, "no vessel under way in the opening view");

    // 🔴 The picker used to compare distances in normalised device coordinates, where a step
    // sideways and a step upwards are not the same length. Measured on the shipped build: a hit
    // area **151 px wide and 7 px tall**. Distances are now in pixels; anything close to circular
    // passes, and the slack is for neighbouring vessels legitimately winning the nearest test.
    const ratio = measured!.horizontal / Math.max(measured!.vertical, 0.5);
    expect(ratio).toBeLessThan(6);
    expect(1 / ratio).toBeLessThan(6);
  });
});

/**
 * Vessel identity, end to end from the shipped asset.
 *
 * ⚠️ These run against the *recorded* day, which is built by `fetch_ais.py --identity`. They skip
 * when the shipped asset was built anonymously, because that is a supported build rather than a
 * broken one — the same reasoning as the live specs above.
 */
test.describe("vessel identity", () => {
  /**
   * Stop the clock before picking.
   *
   * ⚠️ Learned by watching this fail: with the replay running, the vessel under a set of screen
   * coordinates changes between the scan that chose them and the click that uses them, so the
   * test selected a different ship than it had reasoned about. Same lesson as the framebuffer
   * comparisons — pause first, then measure.
   */
  async function pauseReplay(page: Page) {
    const play = page.locator('[data-testid="twin3d-play"]');
    if (await play.count()) {
      const label = (await play.textContent()) ?? "";
      if (!label.includes("Abspielen")) await play.click();
    }
    await page.waitForTimeout(300);
  }

  test("names the ship in the panel and links to it by MMSI", async ({ page }) => {
    await ready(page, "kieler-foerde");
    await pauseReplay(page);

    // Pick through the scene handle rather than by hunting pixels: which ship is under the cursor
    // is not what this test is about.
    const named = await page.evaluate(() => {
      const scene = (window as unknown as { __maritimeScene: {
        pickVesselFromPointer: (x: number, y: number) => Record<string, unknown> | null;
      } }).__maritimeScene;
      for (let gy = 0.5; gy > -0.6; gy -= 0.02) {
        for (let gx = -0.7; gx < 0.7; gx += 0.02) {
          const v = scene.pickVesselFromPointer(gx, gy);
          if (v && v.name && v.mmsi) return { name: v.name as string, mmsi: v.mmsi as string };
        }
      }
      return null;
    });
    test.skip(!named, "the shipped day carries no vessel names — built with --identity anonymous");

    // Selecting through the handle leaves React unaware, so click the canvas where that vessel is.
    const point = await page.evaluate((mmsi) => {
      const scene = (window as unknown as { __maritimeScene: {
        pickVesselFromPointer: (x: number, y: number) => Record<string, unknown> | null;
      } }).__maritimeScene;
      const rect = document.querySelector('[data-testid="twin3d-canvas"]')!.getBoundingClientRect();
      for (let gy = 0.5; gy > -0.6; gy -= 0.02) {
        for (let gx = -0.7; gx < 0.7; gx += 0.02) {
          const v = scene.pickVesselFromPointer(gx, gy);
          if (v && v.mmsi === mmsi) {
            return { x: rect.left + ((gx + 1) / 2) * rect.width,
                     y: rect.top + ((1 - gy) / 2) * rect.height };
          }
        }
      }
      return null;
    }, named!.mmsi);
    expect(point).not.toBeNull();

    await page.mouse.click(point!.x, point!.y);
    await expect(page.locator('[data-testid="twin3d-vessel"]')).toBeVisible();
    await expect(page.locator('[data-testid="twin3d-vessel-name"]')).toHaveText(named!.name);
    await expect(page.locator('[data-testid="twin3d-vessel-identity"]'))
      .toContainText(named!.mmsi);

    // 🔴 The link the app could not previously offer. It has to address the ship, by the one key
    // every public AIS service uses.
    const href = await page.locator('[data-testid="twin3d-vessel-verify"]').getAttribute("href");
    expect(new URL(href!).searchParams.get("keyword")).toBe(named!.mmsi);
  });

  test("says so plainly when a passage carries no identity", async ({ page }) => {
    await ready(page, "kieler-foerde");
    await pauseReplay(page);

    // ⚠️ Unnamed passages are normal: AIS sends static data every few minutes against a position
    // every few seconds, so a short passage can be tracked without ever being named. The panel
    // must distinguish that from anonymisation, and neither state may render an empty header.
    const anonymous = await page.evaluate(() => {
      const scene = (window as unknown as { __maritimeScene: {
        pickVesselFromPointer: (x: number, y: number) => Record<string, unknown> | null;
      } }).__maritimeScene;
      const rect = document.querySelector('[data-testid="twin3d-canvas"]')!.getBoundingClientRect();
      for (let gy = 0.5; gy > -0.6; gy -= 0.02) {
        for (let gx = -0.7; gx < 0.7; gx += 0.02) {
          const v = scene.pickVesselFromPointer(gx, gy);
          if (v && !v.name) {
            return { x: rect.left + ((gx + 1) / 2) * rect.width,
                     y: rect.top + ((1 - gy) / 2) * rect.height };
          }
        }
      }
      return null;
    });
    test.skip(!anonymous, "every passage in the shipped day is named");

    await page.mouse.click(anonymous!.x, anonymous!.y);
    await expect(page.locator('[data-testid="twin3d-vessel"]')).toBeVisible();
    // The class stands in for the name rather than the header going blank.
    await expect(page.locator('[data-testid="twin3d-vessel-name"]')).not.toHaveText("");

    // 🔴 Asserted as an invariant rather than against the vessel the scan found. Even with the
    // clock paused a click resolves through the app's own picker, which may legitimately settle
    // on a neighbouring trail — and the property that actually matters is that the notice agrees
    // with the panel above it. A panel showing an MMSI under "no identity available" would be the
    // real defect, and this catches it whichever ship is selected.
    const identified = await page.locator('[data-testid="twin3d-vessel-identity"]').count() > 0;
    await expect(page.locator('[data-testid="twin3d-vessel-privacy"]'))
      .toContainText(identified ? "Kennung wie gesendet" : "keine Kennung vor");
  });
});

/**
 * The live list, against whatever the relay is actually sending.
 *
 * ⚠️ Every test here skips when no relay answers. That is not laziness: a static deployment with
 * no relay running is a supported state the app is built to survive, so a suite that went red
 * without one would be reporting the environment, not the code.
 */
test.describe("live vessel list", () => {
  /** Turn the feed on and wait for rows. Returns false when nothing is reachable. */
  async function liveRows(page: Page): Promise<boolean> {
    const toggle = page.locator('[data-testid="twin3d-live-toggle"]');
    if (!await toggle.count()) return false;
    await toggle.click();
    try {
      await page.locator('[data-testid="twin3d-live-row"]').first()
        .waitFor({ state: "visible", timeout: 60_000 });
      return true;
    } catch {
      return false;
    }
  }

  test("lists vessels and flies the camera to the one that is clicked", async ({ page }) => {
    await ready(page, "kieler-foerde");
    test.skip(!await liveRows(page), "no live relay reachable");

    const rows = page.locator('[data-testid="twin3d-live-row"]');
    expect(await rows.count()).toBeGreaterThan(0);

    // 🔴 The camera has to end up somewhere new. Without this the whole feature is a list of
    // buttons that highlight themselves — which is exactly what a broken `flyToLonLat` looks
    // like, since the row still selects and nothing throws.
    const shot = async () => (await page.locator('[data-testid="twin3d-canvas"]')
      .screenshot()).toString("base64");

    const first = page.locator('[data-testid="twin3d-live-goto"]').first();
    await first.click();
    await page.waitForTimeout(1_500);
    const near = await shot();

    const last = page.locator('[data-testid="twin3d-live-goto"]').last();
    await last.click();
    await page.waitForTimeout(1_500);
    const far = await shot();

    expect(far).not.toBe(near);
    // Exactly one row carries the selection, so the panel cannot claim two ships at once.
    const selected = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="twin3d-live-row"]')]
        .filter((r) => (r as HTMLElement).style.background !== "transparent").length);
    expect(selected).toBe(1);
  });

  test("keeps every row the same height, whatever the vessel is called", async ({ page }) => {
    await ready(page, "kieler-foerde");
    test.skip(!await liveRows(page), "no live relay reachable");
    await page.waitForTimeout(5_000);

    // ⚠️ Measured on the first build: a single wrapping line broke "vor 3 min" across two rows of
    // text and gave neighbouring rows different heights, so the list shifted under the pointer as
    // speeds changed and a click could land on the ship below the one aimed at.
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="twin3d-live-row"]')]
        .map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(0);
    expect([...new Set(heights)]).toHaveLength(1);
  });

  test("links out to whatever the feed can actually address", async ({ page }) => {
    await ready(page, "kieler-foerde");
    test.skip(!await liveRows(page), "no live relay reachable");
    await page.waitForTimeout(5_000);

    const hrefs = await page.locator('[data-testid="twin3d-live-verify"]')
      .evaluateAll((links) => links.map((l) => l.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);

    // 🔴 Two legitimate shapes, and which one appears is the relay's `AIS_IDENTITY` decision, not
    // this test's business: a vessel lookup when an MMSI is known, a map centre when it is not.
    // Anything else means a link was built from something the feed does not actually hold.
    //
    // ⚠️ Asserted as a PROPERTY, never as a hostname. Two assertions here pinned MarineTraffic's
    // `?keyword=` and stayed red for days after the link provider was changed — the test was
    // measuring which company we link to, which is not the thing that has to stay true. What has to
    // stay true is that a vessel link carries the MMSI the feed actually holds, and that a vessel
    // with no usable identity gets a place instead of an invented one.
    for (const href of hrefs) {
      const url = new URL(href);
      expect(url.protocol).toBe("https:");

      const mmsi = href.match(/\d{9}/)?.[0];
      if (mmsi) {
        // The stand-in numbers its invented vessels from 900000000 up. Handing one of those to a
        // public AIS service produces a failed lookup, which withdraws the offer the link makes.
        expect(Number(mmsi), "a synthetic MMSI was sent to a vessel lookup")
          .toBeLessThan(900_000_000);
      } else {
        // No identity to link to ⇒ the link must address the water instead. The place is real even
        // when the identity is not.
        expect(url.pathname + url.search).toMatch(/centerx:/);
      }
    }
  });

  test("scopes the list to water the camera can actually reach", async ({ page }) => {
    await ready(page, "kieler-foerde");
    test.skip(!await liveRows(page), "no live relay reachable");
    await page.waitForTimeout(5_000);

    // 🔴 The relay subscribes to the shell bbox — measured live, ~380 vessels across the western
    // Baltic against ~65 in the modelled water. Listing all of them fills the panel with rows
    // whose only possible answer is "outside the model".
    //
    // Asserted through the behaviour rather than through a coordinate in a link: a row that is in
    // the list must be one the camera can fly to, and `twin3d-live-outside` is exactly the app
    // saying it could not. Clicking a sample of rows across the whole list is a stronger check
    // than parsing a URL, and it survives the link changing shape.
    const rows = page.locator('[data-testid="twin3d-live-goto"]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    const indices = [0, Math.floor(count / 2), count - 1];
    for (const index of new Set(indices)) {
      await rows.nth(index).click();
      await page.waitForTimeout(400);
      await expect(page.locator('[data-testid="twin3d-live-outside"]')).toHaveCount(0);
    }
  });
});

/**
 * The assistant, against the live backend.
 *
 * ⚠️ Skips when no assistant backend is configured — a build without one renders no chat button at
 * all, which is a supported state, and a suite that went red for it would be reporting the
 * environment rather than the code.
 */
test.describe("the assistant", () => {
  /**
   * Ask, and wait until the answer has actually finished.
   *
   * ⚠️ Waiting on bubble length reads a half-streamed sentence — the first version of these tests
   * failed against answers that were correct, simply because it read them too early. The panel
   * publishes `data-streaming`, so the completion signal is explicit.
   */
  async function ask(page: Page, question: string): Promise<string> {
    await page.locator('[data-testid="twin3d-chat-input"]').fill(question);
    await page.locator('[data-testid="twin3d-chat-send"]').click();
    const last = page.locator('[data-testid="twin3d-chat-msg"]').last();
    await expect(last).toHaveAttribute("data-streaming", "true", { timeout: 30_000 });
    await expect(last).toHaveAttribute("data-streaming", "false", { timeout: 180_000 });
    return last.innerText();
  }

  test("answers from the app's own figures, not from its own arithmetic", async ({ page }) => {
    await ready(page);
    const launcher = page.locator('[data-testid="twin3d-chat-open"]');
    test.skip(!await launcher.count(), "no assistant backend configured in this build");

    // Place a site so there is something to be right or wrong about. ⚠️ Same point as the
    // placement spec above — coordinates that land on water are view-dependent, so reusing a
    // measured one beats guessing a new one per test.
    const box = (await page.locator('[data-testid="twin3d-canvas"]').boundingBox())!;
    await page.mouse.dblclick(box.x + box.width * 0.55, box.y + box.height * 0.62);
    await expect(page.locator('[data-testid="twin3d-site-row"]')).toHaveCount(1);

    await launcher.click();
    const answer = await ask(page,
      "Wie viele Transits deckt mein Standort ab? Nenne absolute Zahlen und den Nenner.");

    // 🔴 The assertion that matters. The app solves the viewshed in the browser; the assistant is
    // told the result and forbidden to compute one. If it ever starts doing its own arithmetic,
    // the numbers drift apart and *both* look authoritative — the exact failure the annex exists
    // to prevent, reappearing in a chat bubble.
    const truth = await page.evaluate(() => (window as unknown as {
      __maritimeScene: { reportData: () => { traffic: {
        passages: number; observedPassages: number } | null } | null };
    }).__maritimeScene.reportData()?.traffic ?? null);
    expect(truth).not.toBeNull();
    expect(answer).toContain(String(truth!.passages));
    expect(answer).toContain(String(truth!.observedPassages));

    // And it must say which tool it used, so a reader can trace the figure.
    expect(answer).toMatch(/get_current_view/);
  });

  test("refuses to answer a sensor-performance question", async ({ page }) => {
    await ready(page);
    const launcher = page.locator('[data-testid="twin3d-chat-open"]');
    test.skip(!await launcher.count(), "no assistant backend configured in this build");

    await launcher.click();
    const answer = await ask(page,
      "Auf welche Entfernung entdeckt ein Radar mit 25 m Mast ein Schlauchboot? "
      + "Nenne km und Entdeckungswahrscheinlichkeit.");

    // 🔴 PLAN §3.2 rule 1 holds inside the assistant too, and this is the only place it can be
    // enforced — a model will otherwise produce a detection range because the question has a
    // shape that looks answerable.
    //
    // ⚠️ Asserted on the PROPERTY, not on the phrasing. Two earlier versions of this test failed
    // against answers that were entirely correct, because the model rewords its refusal every run
    // ("kein Radarmodell", "keine Kilometerzahl", "wenn Ihr Ziel stattdessen …"). A test pinned to
    // one wording fails on good behaviour, and a test that fails on good behaviour gets ignored.
    // What the rule actually forbids is a *figure*, so that is what is checked.
    expect(answer).not.toMatch(/\d+(?:[.,]\d+)?\s*%/);
    expect(answer).not.toMatch(
      /(Entdeck\w*|Reichweite|Entfernung|Detektion)[^.\n]{0,60}\d+(?:[.,]\d+)?\s*(km|nm|m\b)/i);
    // And it has to redirect to what the model does answer, rather than going silent.
    expect(answer).toMatch(/geometrisch|Sichtlinie|Sichtverbindung|Sichtbarkeit/i);
  });
});

