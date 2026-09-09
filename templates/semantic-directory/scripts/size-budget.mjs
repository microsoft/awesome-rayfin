//-----------------------------------------------------------------------
// Semantic Directory — bundle size budget check.
//
// Runs after `vite build`. Sums the gzipped JS/CSS in dist/assets and fails
// the build if the initial payload blows past budget. Deterministic, no extra
// dependencies (uses Node's built-in zlib), so it works anywhere `npm` does.
// This is the guardrail that keeps the code-split wins from silently eroding.
//-----------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

// Budgets are gzipped kB. Generous enough not to nag, tight enough to catch a
// regression like re-bundling everything into one chunk.
const BUDGETS = {
    // Largest single JS chunk (app or vendor). Catches "one giant blob" regressions.
    maxChunkKb: 90,
    // Total gzipped JS across all chunks.
    totalJsKb: 260,
    // The single CSS bundle.
    maxCssKb: 20,
};

const assetsDir = join(process.cwd(), "dist", "assets");

function gzipKb(path) {
    return gzipSync(readFileSync(path)).length / 1024;
}

let files;
try {
    files = readdirSync(assetsDir);
} catch {
    console.error(`\n[size-budget] dist/assets not found — run \`npm run build\` first.\n`);
    process.exit(1);
}

let totalJs = 0;
let biggestChunk = { name: "", kb: 0 };
let cssKb = 0;
const rows = [];

for (const name of files) {
    const full = join(assetsDir, name);
    if (!statSync(full).isFile()) continue;
    if (name.endsWith(".js")) {
        const kb = gzipKb(full);
        totalJs += kb;
        rows.push({ name, kb });
        if (kb > biggestChunk.kb) biggestChunk = { name, kb };
    } else if (name.endsWith(".css")) {
        cssKb = Math.max(cssKb, gzipKb(full));
    }
}

rows.sort((a, b) => b.kb - a.kb);
console.log("\n[size-budget] gzipped JS chunks:");
for (const r of rows) console.log(`  ${r.kb.toFixed(1).padStart(6)} kB  ${r.name}`);
console.log(`  ${totalJs.toFixed(1).padStart(6)} kB  (total JS)`);
console.log(`  ${cssKb.toFixed(1).padStart(6)} kB  (CSS)\n`);

const failures = [];
if (biggestChunk.kb > BUDGETS.maxChunkKb) {
    failures.push(
        `largest chunk ${biggestChunk.name} is ${biggestChunk.kb.toFixed(1)} kB > ${BUDGETS.maxChunkKb} kB budget`,
    );
}
if (totalJs > BUDGETS.totalJsKb) {
    failures.push(`total JS ${totalJs.toFixed(1)} kB > ${BUDGETS.totalJsKb} kB budget`);
}
if (cssKb > BUDGETS.maxCssKb) {
    failures.push(`CSS ${cssKb.toFixed(1)} kB > ${BUDGETS.maxCssKb} kB budget`);
}

if (failures.length) {
    console.error("[size-budget] FAILED:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    console.error("");
    process.exit(1);
}

console.log("[size-budget] ✓ within budget\n");
