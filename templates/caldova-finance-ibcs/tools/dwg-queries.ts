// Every query the original P&L visual can send, built by the app's own builders (src/domain/dwgPeriod.ts):
// three pages × every slice the month picker leads to. tools/bake-snapshot.mjs runs this with vite-node, sends
// each text to the model and stores the answer under that exact text.
//
//   npx vite-node tools/dwg-queries.ts <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

import { allSlices, DWG_PAGES, sliceQueries, withSlice, type StatementId } from '@/domain/dwgPeriod';
import type { Snapshot } from '@/domain/types';

const out = process.argv[2];
if (!out) throw new Error('usage: dwg-queries.ts <out.json>');
const snapshot = JSON.parse(readFileSync('public/data/statements.json', 'utf-8')) as Snapshot;

const entries: { source: string; query: string }[] = [];
const slices = allSlices(snapshot.months);
for (const [id, page] of Object.entries(DWG_PAGES) as [StatementId, (typeof DWG_PAGES)[StatementId]][]) {
  for (const slice of slices) {
    for (const q of sliceQueries(withSlice(page, id, slice))) {
      entries.push({ source: `${id} ${slice.year}-${String(slice.lastMonth).padStart(2, '0')} ${q.tile}`, query: q.query });
    }
  }
}
writeFileSync(out, JSON.stringify(entries));
console.log(`dwg query manifest: ${entries.length} queries (${slices.length} slices × ${Object.keys(DWG_PAGES).length} pages)`);
