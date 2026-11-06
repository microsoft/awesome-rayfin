// Make the layer `dwg app page` generates (src/dwg) speak English: the app is English only, the
// generator writes German UI strings and mounts the visuals with locale de-DE. Run after every `dwg app page`;
// idempotent, and it fails when a string it expects is gone (the generator changed: look again).
//
//   node tools/dwg-english.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../src/dwg/DwgPage.tsx');
const REPLACE = [
  ['Keine Berechtigung auf das Semantikmodell (Lesen und Erstellen nötig).', 'No permission on the semantic model (read and build needed).'],
  ['Die Fabric-Kapazität ist gerade ausgelastet. Bitte gleich neu laden.', 'The Fabric capacity is busy. Please reload in a moment.'],
  ['          lädt …', '          loading…'],
  [': Daten fehlen</p>', ': no data</p>'],
  ['              Erneut versuchen', '              Try again'],
  ['title="Filter aufheben"', 'title="Clear the filter"'],
  ['          columnTypes={page.columnTypes}\n', "          columnTypes={page.columnTypes}\n          locale=\"en-GB\"\n"],
];

let text = readFileSync(FILE, 'utf-8').replace(/\r\n/g, '\n');
let changed = 0;
for (const [de, en] of REPLACE) {
  if (text.includes(en)) continue;
  if (!text.includes(de)) throw new Error(`dwg-english: "${de.trim()}" not found in src/dwg/DwgPage.tsx (generator changed?)`);
  text = text.replace(de, en);
  changed++;
}
writeFileSync(FILE, text);
console.log(`src/dwg/DwgPage.tsx: ${changed} strings made English (${REPLACE.length - changed} already were)`);
