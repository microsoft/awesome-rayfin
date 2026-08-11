import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Attribution must be READ from the data, never typed into the UI.
 *
 * 🔴 Why this is a source-text test rather than a behavioural one. The footer lives inside a
 * ~2500-line component that needs a WebGL context, a loaded terrain and a running scene before it
 * renders a single character, so asserting on the rendered string would mean standing all of that
 * up to check one sentence. What actually went wrong is much simpler and is visible in the source:
 * somebody typed a licence credit as a literal. This pins exactly that.
 *
 * The failure it guards against is not cosmetic. Both credits were hardcoded to the two coasts this
 * repo happens to ship, while the whole argument of the app is that an AOI is configuration. The
 * first fork onto another coast would have gone on crediting a German state survey for somebody
 * else's survey data — a false licence attribution, which is the one error a data owner is
 * guaranteed to notice, and it would have been invisible to every other test in this suite because
 * the app still works perfectly while telling that lie.
 *
 * Same bug class as the hardcoded "30 m" horizon posting (which silently became false when the
 * shell was rebuilt at 90 m) and the vegetation caveat that was a literal in two files at once.
 */
/**
 * ⚠️ Resolved from the project root, not from `import.meta.url`. These tests run under the `jsdom`
 * environment the drone camera needs, and jsdom rewrites `import.meta.url` to an `http://` URL —
 * so `fileURLToPath` throws `ERR_INVALID_URL_SCHEME` before a single assertion runs.
 */
const APP_SOURCE = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/**
 * Names of data owners that must only ever reach the screen via a descriptor.
 *
 * ⚠️ Deliberately NOT a blanket ban on the word appearing anywhere in the file: a comment
 * explaining the rule has to be able to name the thing it is about, or the rule cannot be
 * documented next to the code it governs. Only JSX text and string literals are searched.
 */
const DATA_OWNERS = [
  "LVermGeo",
  "Landesamt für Vermessung",
  "Copernicus",
  "DLR",
  "Airbus",
  "ESA",
];

/**
 * The file with every comment removed, so the search sees only code and rendered text.
 * Block comments in this repo are long and quote the very strings being banned.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("footer attribution", () => {
  const code = withoutComments(APP_SOURCE);

  it.each(DATA_OWNERS)("never names %s outside a descriptor", (owner) => {
    expect(code).not.toContain(owner);
  });

  it("renders the credit the loaded AOI supplied", () => {
    // The core survey credit is not optional: every AOI has ground under it.
    expect(code).toContain("{geobasis.core}");
    // The horizon tier is optional, so its credit must be guarded rather than assumed.
    expect(code).toContain("{geobasis?.shell && ");
  });

  it("clears the credit when the AOI changes, so a stale owner cannot survive a switch", () => {
    // 🔴 The switcher swaps the core without a page load. Without this reset the previous coast's
    // licence line would stay on screen over the new coast's terrain until the fetch resolved —
    // briefly crediting the wrong survey for data already being rendered.
    expect(code).toContain("setGeobasis(null)");
  });
});
