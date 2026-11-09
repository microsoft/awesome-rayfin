// The shipped snapshots answer every query the Finance tab sends, under the app's own query text, with the
// columns its parsers read and English text values. Mirrors tools/finance/query-manifest.ts, but takes the
// years, the closed months and the P&L blocks from the snapshot itself, so it needs no generator output.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { tileFilters } from '@finance/dwg/dwg-page';
import { page as statement } from '@finance/dwg/pages/guv-statement';
import { buildCube } from '@finance/lib/cockpit/load';
import { buildCatalogue } from '@finance/lib/cockpit/kpis';
import { withPeriod } from '@finance/lib/dwg-period';
import { parseJahre, parseKonten, parseMonate, parseWerte } from '@finance/lib/pnl/data';
import { buildPnl, EMPTY_SIM } from '@finance/lib/pnl/engine';
import { answer, decodeTable, queryKey, type FinanceSnapshot, type QueryTable } from '@finance/lib/snapshot';
import { cockpitQueries } from '@finance/queries/cockpit';
import { fcMonate, jahre, konten, kontowerte, monatsverlauf } from '@finance/queries/guv';
import { daxQuery } from '@finance/vendor/dwg-visuals/dwg-visuals.js';

const root = resolve(__dirname, '../../../..');
const finance = JSON.parse(readFileSync(resolve(root, 'public/data/finance/snapshot.json'), 'utf8')) as FinanceSnapshot;
const reorder = JSON.parse(readFileSync(resolve(root, 'public/data/reorder/snapshot.json'), 'utf8')) as {
  stores: Record<string, { name: string; region: string }>;
  products: Record<string, { name: string }>;
  queries: Record<string, { columns: string[]; rows: unknown[][]; dict?: Record<string, string[]> }>;
};

const table = (query: string): QueryTable => {
  const r = answer(finance, query);
  if (r.status !== 'success') throw new Error(r.error.message);
  return r.table;
};
const names = (t: QueryTable) => t.columns.map((c) => c.name);

// Years and closed months from the snapshot's own frame query, P&L blocks from its account tree.
const years = parseJahre(table(jahre().query));
const accounts = parseKonten(table(konten().query));
const blocks = [...new Set(accounts.filter((k) => k.rowType === 'Account' && k.l1).map((k) => k.l1))].sort();
const lastMonth = (y: { lastActual: string }) => Number(y.lastActual.slice(5, 7)) || 12;

const STATEMENT_COLUMNS = ['AccountID', 'Name', 'L1', 'L2', 'L3', 'SortOrder', 'RowType', 'FormulaDef', 'SignConvention', 'DisplayInvert', 'VarianceInvert', 'Comment']
  .map((c) => `dim-account[${c}]`)
  .concat(['[ac]', '[py]', '[pl]']);

/** Every query the app can send, with the columns the snapshot must answer it with. */
function appQueries(): { source: string; query: string; columns: string[] }[] {
  const out: { source: string; query: string; columns: string[] }[] = [];
  const cockpitColumns: Record<keyof typeof cockpitQueries, string[]> = {
    info: ['[lastAC]', '[year]', '[month]'],
    kpis: ['[kpi]', '[group]', '[unit]', '[higherIsBetter]', '[sort]'],
    maerkte: ['[market]', '[region]', '[maturity]'],
    produkte: ['[product]', '[category]', '[line]'],
    szenarien: ['[scenario]', '[name]', '[ibcs]', '[sort]'],
    wuerfel: ['dim-market[Country]', 'dim-product[Product]', 'Calender[Month]', 'dim-kpi[KPI]', '[AC]', '[PL1]', '[PL2]', '[FC1]', '[FC2]', '[FC3]'],
    vorjahr: ['dim-market[Country]', 'dim-product[Product]', 'Calender[Month]', 'dim-kpi[KPI]', '[PY]'],
  };
  for (const [name, query] of Object.entries(cockpitQueries)) out.push({ source: `cockpit/${name}`, query, columns: cockpitColumns[name as keyof typeof cockpitQueries] });
  out.push({ source: 'guv/konten', query: konten().query, columns: ['[id]', '[parent]', '[name]', '[l1]', '[l2]', '[l3]', '[rowType]', '[formula]', '[sign]', '[displayInvert]', '[varianceInvert]', '[sort]'] });
  out.push({ source: 'guv/jahre', query: jahre().query, columns: ['Calender[Year]', '[rows]', '[lastActual]'] });
  for (const { year } of years) {
    out.push({ source: `guv/kontowerte ${year}`, query: kontowerte(year).query, columns: ['fact-pnl[AccountID]', '[AC]', '[FC]', '[PL]', '[PY]', '[PLYTD]', '[PYYTD]'] });
    out.push({ source: `guv/monatsverlauf ${year}`, query: monatsverlauf(year).query, columns: ['fact-pnl[Month]', 'dim-account[L1]', 'dim-account[SignConvention]', '[AC]', '[FC]', '[PL]', '[PY]'] });
  }
  for (const y of years.filter((j) => lastMonth(j) < 12)) {
    for (const b of blocks) {
      out.push({ source: `guv/fcmonate ${y.year} ${b}`, query: fcMonate(y.year, b).query, columns: ['dim-account[AccountID]', 'dim-account[Name]', 'dim-account[L2]', 'dim-account[L3]', 'fact-pnl[Month]', '[FC]'] });
    }
  }
  for (const y of years) {
    const spec = withPeriod(statement, y.year, lastMonth(y));
    for (const tile of spec.tiles) {
      const q = daxQuery(tile.visual, tile.bindings, { filters: tileFilters(spec, tile.id, null, []), sortBy: tile.sortBy, showItemsWithNoData: tile.showItemsWithNoData });
      out.push({ source: `dwg/statement ${y.year}/${tile.id}`, query: q.query, columns: STATEMENT_COLUMNS });
    }
  }
  return out;
}

const GERMAN = /[äöüß]|\b(Umsatz\w*|Wareneinsatz|Aufwendungen|Ergebnis|Steuern|Abschreibungen|Ist|Kosten|Menge|Stück|Anzahl|Apotheke|Linksrheinisch|Rechtsrheinisch|Kerngebiet|Randgebiet)\b/i;
/** Cologne district names are proper nouns and stay German. */
const DISTRICT = /^(Ehrenfeld|Innenstadt|Kalk|Lindenthal|Mülheim|Nippes|Porz|Rodenkirchen)$/;
const textValues = (t: { rows: unknown[][] }) => t.rows.flat().filter((v): v is string => typeof v === 'string');

describe('finance snapshot', () => {
  const queries = appQueries();

  it('answers every query the app sends, and nothing else', () => {
    const missing = queries.filter((q) => !(queryKey(q.query) in finance.results)).map((q) => q.source);
    expect(missing).toEqual([]);
    expect(new Set(queries.map((q) => queryKey(q.query)))).toEqual(new Set(Object.keys(finance.results)));
    expect(queries.length).toBe(22);
  });

  it('answers each with the columns the app reads', () => {
    for (const q of queries) expect([q.source, names(table(q.query))]).toEqual([q.source, q.columns]);
  });

  it('carries English text values only (district names excepted)', () => {
    const german = new Set<string>();
    for (const t of Object.values(finance.results)) {
      for (const v of textValues(decodeTable(t))) if (GERMAN.test(v) && !DISTRICT.test(v)) german.add(v);
    }
    expect([...german]).toEqual([]);
  });

  it('feeds the cockpit and the P&L engine', () => {
    const t = (n: keyof typeof cockpitQueries) => table(cockpitQueries[n]);
    const cube = buildCube({ info: t('info'), kpis: t('kpis'), maerkte: t('maerkte'), produkte: t('produkte'), wuerfel: t('wuerfel'), vorjahr: t('vorjahr'), szenarien: t('szenarien') });
    expect(cube.year).toBe(2026);
    expect(buildCatalogue(cube).map((k) => k.id)).toContain('Revenue');

    const year = years[years.length - 1].year;
    const werte = parseWerte(table(kontowerte(year).query));
    const pnl = buildPnl({ konten: accounts, werte, mode: 'fy', sim: EMPTY_SIM });
    const line = (name: string) => [...pnl.lines.values()].find((l) => l.name === name);
    expect(line('Revenue')?.cols.base).toBeGreaterThan(0);
    expect(line('Cost of goods sold')?.cols.base).toBeLessThan(0);
    expect(line('Net income')).toBeDefined();
    expect(blocks).toContain('Operating expenses');
    expect(parseMonate(table(monatsverlauf(year).query)).length).toBeGreaterThan(0);
  });
});

describe('reorder snapshot', () => {
  it('names stores and products in English', () => {
    for (const s of Object.values(reorder.stores)) expect(s.name).toMatch(/^Caldova Partner Pharmacy \d{3}$/);
    const german = Object.values(reorder.products).map((p) => p.name).filter((n) => GERMAN.test(n));
    expect(german).toEqual([]);
    for (const [key, q] of Object.entries(reorder.queries)) {
      for (const col of ['Stores[name]', 'Products[name]']) {
        for (const v of q.dict?.[col] ?? []) expect([key, GERMAN.test(v)]).toEqual([key, false]);
      }
    }
  });
});
