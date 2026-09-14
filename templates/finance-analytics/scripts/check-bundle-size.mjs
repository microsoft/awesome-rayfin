// Bundle-size budget gate. Measures the gzipped size of the initial (entry) JS
// chunk that index.html loads — NOT the lazy chunks (the heavy Vega graph is a
// deliberate lazy import and is excluded here). Fails CI if the entry grows past
// the budget, which is the number a user waits on before first paint.
//
// Run after `npm run build`. Dependency-free (node stdlib only).
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const DIST = "dist";
const ASSETS = join(DIST, "assets");

// Budget for the entry chunk, gzipped. Set with ~30% headroom over the current
// entry (~55 KB) so it catches a real regression (e.g. a heavy dep pulled into
// the initial chunk) while leaving room for a few more pages. Tune deliberately
// when the app grows. Lazy/vendor chunks are off the initial path and excluded.
const ENTRY_BUDGET_KB = 75;

function fail(msg) {
  console.error(`\u2717 bundle-size: ${msg}`);
  process.exit(1);
}

let html;
try {
  html = readFileSync(join(DIST, "index.html"), "utf8");
} catch {
  fail(`no ${DIST}/index.html — run \`npm run build\` first`);
}

// The entry is the <script type="module" src="..."> index.html boots from.
const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
if (!m) fail("could not find the entry module <script> in index.html");

const entryRel = m[1].replace(/^\//, "");
const entryPath = join(DIST, entryRel);

let bytes;
try {
  bytes = readFileSync(entryPath);
} catch {
  fail(`entry chunk not found at ${entryPath}`);
}

const entryGzipKb = gzipSync(bytes).length / 1024;

// Informational: total JS on disk (entry + all lazy chunks).
let totalKb = 0;
try {
  for (const f of readdirSync(ASSETS)) {
    if (f.endsWith(".js")) totalKb += readFileSync(join(ASSETS, f)).length / 1024;
  }
} catch {
  /* assets dir optional */
}

const entryStr = entryGzipKb.toFixed(1);
console.log(`entry chunk (gzip): ${entryStr} KB  [budget ${ENTRY_BUDGET_KB} KB]`);
console.log(`total JS on disk (raw, incl. lazy chunks): ${totalKb.toFixed(0)} KB`);

if (entryGzipKb > ENTRY_BUDGET_KB) {
  fail(`entry chunk ${entryStr} KB exceeds budget ${ENTRY_BUDGET_KB} KB (gzip)`);
}
console.log("\u2713 bundle-size within budget");
