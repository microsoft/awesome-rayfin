/**
 * Copy CesiumJS's static runtime assets into `public/cesium/`.
 *
 * CesiumJS loads workers, widget CSS, and asset files (terrain height lookup, IAU tables, star
 * map, icons) at run time from `window.CESIUM_BASE_URL`. `vite-plugin-cesium` sets that variable
 * but does not serve the files in dev - Vite's SPA fallback answers with index.html, and Cesium
 * then dies on `JSON.parse('<!doctype html...')`. Copying them into `public/` makes dev and the
 * production build behave identically.
 *
 * `public/cesium/` is generated and git-ignored; this runs from `predev` and `prebuild`.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const target = join(root, 'public', 'cesium');
const FOLDERS = ['Assets', 'ThirdParty', 'Widgets', 'Workers'];

try {
  await stat(source);
} catch {
  console.error(`[cesium] ${source} not found - run npm install first.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

for (const folder of FOLDERS) {
  await cp(join(source, folder), join(target, folder), { recursive: true });
}

console.log(`[cesium] copied ${FOLDERS.join(', ')} -> public/cesium/`);
