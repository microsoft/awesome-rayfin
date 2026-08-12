import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * External AIS links must come from ONE definition, and the dead route must never come back.
 *
 * 🔴 This exists because the same defect shipped twice. `vesselUrl()` in `twin3d/liveList.ts` is the
 * single place that decides where "check this ship elsewhere" points, and it is covered by unit
 * tests. But the vessel panel in `App.tsx` hand-wrote its own copy of the URL, and that copy pointed
 * at MarineTraffic's search endpoint — which answers **404 for every MMSI**, verified in a real
 * browser (`?keyword=246403000` → "404 - Page Not Found | AIS Marine Traffic", 2026-08-12).
 *
 * The consequence is worse than a broken link. The panel offers the reader an independent check of a
 * claim the app is making about a specific ship; landing them on an error page withdraws the offer
 * and quietly damages every other notice on that panel. The correct target for that same MMSI
 * resolves fine: `vesselfinder.com/vessels/details/246403000` → "PEAK BELFAST … IMO 9544891".
 *
 * ⚠️ **Why a source-text test.** The existing suite passed the whole time, because it exercises
 * `vesselUrl` — the function App.tsx was not calling. No behavioural test of a module can see a
 * second, hand-written URL somewhere else; only reading the file can. Same lesson as the attribution
 * literal: a duplicate definition is invisible to tests aimed at the definition it duplicates.
 *
 * ⚠️ Resolved from the project root, not `import.meta.url` — jsdom rewrites that to an `http://` URL
 * and `fileURLToPath` throws before any assertion runs.
 */
const APP_SOURCE = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/** The file with comments removed, so the rule can be explained without tripping itself. */
const APP_CODE = APP_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("external vessel links", () => {
  it("never rebuilds MarineTraffic's dead search route", () => {
    // Both spellings were measured dead in a browser: ?keyword= and ?mmsi=.
    expect(APP_CODE).not.toContain("ais/index/search");
    expect(APP_CODE).not.toMatch(/marinetraffic\.com[^"'`]*keyword=/i);
  });

  it("builds no external AIS-service URL of its own", () => {
    // 🔴 The rule is not "don't use MarineTraffic" — it is "don't hand-write the target here".
    // liveList.ts owns both the per-vessel link and the positional one, and it is the file whose
    // tests pin them. Any hostname appearing in App.tsx is a second definition by construction.
    for (const host of ["marinetraffic.com", "vesselfinder.com", "myshiptracking.com"]) {
      expect(APP_CODE).not.toContain(host);
    }
  });

  it("routes the panel through the shared helpers instead", () => {
    expect(APP_CODE).toContain("vesselUrl(vessel.mmsi)");
    // Imported from the one module that owns external links.
    expect(APP_CODE).toMatch(/vesselUrl[\s\S]*?from "\.\/twin3d\/liveList"/);
  });
});
