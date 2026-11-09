/**
 * Every query the Finance tab can send, built by the APP'S OWN query builders (src/finance/SOURCE.md).
 *
 * The bake (tools/fabric/bake_finance_snapshot.py) runs this with vite-node, sends each text to the model
 * and stores the answer under that exact text; the tab looks answers up by the same text
 * (src/finance/lib/snapshot.ts). So a baked answer and the query a page asks for cannot drift apart: if
 * a page changes its query, the old answer simply is not found and the page says so.
 *
 *   npx vite-node tools/finance/query-manifest.ts <out.json> <dim_account.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { page as statement } from '@finance/dwg/pages/guv-statement';
import { tileFilters } from '@finance/dwg/dwg-page';
import { withPeriod } from '@finance/lib/dwg-period';
import { cockpitQueries } from '@finance/queries/cockpit';
import { fcMonate, jahre, konten, kontowerte, monatsverlauf } from '@finance/queries/guv';
import { daxQuery } from '@finance/vendor/dwg-visuals/dwg-visuals.js';

const [out, accountFile] = process.argv.slice(2);
if (!out || !accountFile) throw new Error('usage: query-manifest.ts <out.json> <dim_account.json>');

// P&L years the page can select (jahre.dax) and the years with open months (forecast export), from the
// generator's fact table next to dim_account.json. The bake checks these against the model's own answer.
const fact = JSON.parse(readFileSync(accountFile.replace(/dim_account\.json$/, 'fact_pnl.json'), 'utf8')) as { Month: string; AC: number | null }[];
const YEARS = [...new Set(fact.map((r) => Number(r.Month.slice(0, 4))))].sort();
const lastAc = new Map<number, number>();
for (const r of fact) {
  if (!r.AC) continue; // 0 or null (open months carry no actual)
  const y = Number(r.Month.slice(0, 4));
  lastAc.set(y, Math.max(lastAc.get(y) ?? 0, Number(r.Month.slice(5, 7))));
}
const OPEN_YEARS = YEARS.filter((y) => (lastAc.get(y) ?? 0) < 12);

const entries: { source: string; query: string }[] = [];
const add = (source: string, query: string) => entries.push({ source, query });

for (const [name, query] of Object.entries(cockpitQueries)) add(`cockpit/${name}`, query);
add('guv/konten', konten().query);
add('guv/jahre', jahre().query);
for (const y of YEARS) {
  add(`guv/kontowerte ${y}`, kontowerte(y).query);
  add(`guv/monatsverlauf ${y}`, monatsverlauf(y).query);
}
// The Excel export's blocks, exactly as GuvPage builds them: distinct L1 of the account rows.
const rows = JSON.parse(readFileSync(accountFile, 'utf8')) as { RowType: string; L1: string }[];
const blocks = [...new Set(rows.filter((k) => k.RowType === 'Account' && k.L1).map((k) => k.L1))].sort();
for (const y of OPEN_YEARS) for (const b of blocks) add(`guv/fcmonate ${y} ${b}`, fcMonate(y, b).query);

// The original P&L visual inside P&L & Simulation (components/guv/OriginalPnl.tsx): the statement spec
// narrowed per year to January .. the last closed month (12 for a closed year), DwgPage's own query per
// tile (tileFilters + daxQuery), no selection (one tile). The visual's own views (table, bars,
// waterfall, tree) switch in the visual on the same answer.
for (const y of YEARS) {
  const spec = withPeriod(statement, y, lastAc.get(y) ?? 12);
  for (const tile of spec.tiles) {
    const q = daxQuery(tile.visual, tile.bindings, {
      filters: tileFilters(spec, tile.id, null, []),
      sortBy: tile.sortBy,
      showItemsWithNoData: tile.showItemsWithNoData,
    });
    add(`dwg/statement ${y}/${tile.id}`, q.query);
  }
}

writeFileSync(out, JSON.stringify(entries, null, 1));
console.log(`query manifest: ${entries.length} queries (years ${YEARS.join(', ')}, open ${OPEN_YEARS.join(', ')}, ${blocks.length} P&L blocks) -> ${out}`);
