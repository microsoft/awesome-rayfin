import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Smoke test: the static build assembles a complete deployable bundle.
test('build:fabric produces a complete hosting bundle', () => {
  execSync('node tools/build-fabric.mjs', { stdio: 'inherit' });
  const expected = [
    'fabric-dist/index.html',
    'fabric-dist/data-adapter.js',
    'fabric-dist/views/approach/index.html',
    'fabric-dist/views/liveops/index.html',
    'fabric-dist/views/liveops/data/DUS/snapshot.json',
  ];
  for (const f of expected) {
    assert.ok(existsSync(f), `expected bundle file missing: ${f}`);
  }
});
