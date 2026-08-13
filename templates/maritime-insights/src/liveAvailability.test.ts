import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The live feed is offered only when a relay has actually been nominated.
 *
 * 🔴 **Why the control disappears rather than the code.** While the upstream AIS provider is down,
 * the relay stands in with the recorded day — so "Live" and "Aufzeichnung" both showed recorded
 * traffic, and the app was asking the reader to choose between two things that behaved the same.
 * A choice with no consequence is not a feature; it is a puzzle placed in front of a customer.
 *
 * It was worse on the second AOI. The stand-in holds the Kieler Förde recording only, so switching
 * to Live on the Schlei produced an empty sea — measured on the deployed build (2026-08-12):
 * `0 Schiffe` in area against 61 vessels reporting outside it. A control that promises traffic and
 * delivers blank water is the same failure as a verification link that 404s.
 *
 * ⚠️ **Nothing was deleted, and that is the point.** `liveSource`, `liveList` and the scene's live
 * buffers remain, with their ~48 tests, because the feed returns the day the provider does — one
 * environment variable, no code change. Deleting a working subsystem to hide a button would have
 * cost around eighty passing tests and surgery on the shared render buffers, and it would have to
 * be written again from scratch afterwards.
 *
 * ⚠️ Resolved from the project root, not `import.meta.url` — jsdom rewrites that to an `http://`
 * URL and `fileURLToPath` throws before any assertion runs.
 */
const APP_SOURCE = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

const APP_CODE = APP_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("live feed availability", () => {
  it("derives the offer from the configured relay, never from a constant", () => {
    expect(APP_CODE).toMatch(/const LIVE_OFFERED = RELAY_URL\.length > 0/);
  });

  it("has no built-in relay address to fall back on", () => {
    // 🔴 The default used to be the author's own container, so every clone pointed its visitors at
    // one private endpoint. It was then changed to 127.0.0.1, which silently broke the deployment
    // instead. Neither belongs in source: an unset variable must mean "no live feed offered".
    expect(APP_CODE).not.toContain("127.0.0.1:8788");
    expect(APP_CODE).not.toMatch(/RELAY_URL[^\n]*\?\?\s*"http/);
  });

  it("gates the toggle so no control appears without a relay", () => {
    expect(APP_CODE).toMatch(/LIVE_OFFERED && \(\s*<button/);
  });

  it("gates the connection too, so an unconfigured app dials nobody", () => {
    expect(APP_CODE).toContain("!liveWanted || !LIVE_OFFERED");
  });
});
