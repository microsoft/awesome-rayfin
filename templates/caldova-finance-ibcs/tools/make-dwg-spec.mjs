// Build dwg/caldova-finance.json: the three statements as dwg pages (T04B, T05A, T05B), bound to the English contract
// tables (tools/contract_tables.py). The visual settings (objects) come from dwg's own showcase spec, so the templates
// render as Michael Tenner designed them; only bindings, titles and texts are Caldova's.
//
//   node tools/make-dwg-spec.mjs <path to a dwg-cli checkout>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DWG = process.argv[2];
if (!DWG) throw new Error('usage: node tools/make-dwg-spec.mjs <dwg-cli checkout>');
const showcase = JSON.parse(readFileSync(resolve(DWG, 'specs/showcase.json'), 'utf-8'));
const tileOf = (tpl) => {
  for (const p of showcase.pages) for (const t of p.tiles) if (t.objects?.columns?.template === tpl) return { page: p, tile: t };
  throw new Error(`no ${tpl} tile in the showcase`);
};

const accountRoles = (t) => ({
  levels: [`'${t}'[L1]`, `'${t}'[L2]`],
  account: `'${t}'[AccountID]`,
  accountName: `'${t}'[Account]`,
  sortOrder: `'${t}'[SortOrder]`,
  rowType: `'${t}'[RowType]`,
  formulaDef: `'${t}'[FormulaDef]`,
  signConvention: `'${t}'[SignConvention]`,
  displayInvert: `'${t}'[DisplayInvert]`,
  varianceInvert: `'${t}'[VarianceInvert]`,
  comment: `'${t}'[Comment]`,
});

const PAGES = [
  {
    tpl: 'T04B',
    name: 'Income statement',
    description: 'Caldova GmbH · P&L year to date: actual against plan up to the last closed month, with the ΔPL waterfall.',
    bindings: { ...accountRoles('P&L Account'), ac: "'P&L Fact'[P&L AC]", pl: "'P&L Fact'[P&L PL to date]" },
    numbers: { scaling: 'k', decimals: 0, pctDecimals: 1 },
    // Blocks first, like the app's table: 66 lines would not fit one screen.
    defaultLevel: 1,
  },
  {
    tpl: 'T05A',
    name: 'Balance sheet',
    description: 'Caldova GmbH · Balance sheet at the reporting date against the same date one year earlier.',
    bindings: { ...accountRoles('BS Account'), ac: "'BS Fact'[BS AC]", py: "'BS Fact'[BS PY]", period: "'Calendar'[Period]" },
    numbers: { scaling: 'k', decimals: 0, pctDecimals: 1 },
  },
  {
    tpl: 'T05B',
    name: 'Cash flow',
    description: 'Caldova GmbH · Cash flow from opening to closing cash, month and year to date, against the prior year.',
    bindings: { ...accountRoles('CF Account'), ac: "'CF Fact'[CF AC]", py: "'CF Fact'[CF PY]", period: "'Calendar'[Period]" },
    numbers: { scaling: 'k', decimals: 0, pctDecimals: 1 },
  },
];

const pages = PAGES.map((p) => {
  const { page, tile } = tileOf(p.tpl);
  const objects = structuredClone(tile.objects);
  objects.numbers = { ...(objects.numbers ?? {}), ...p.numbers };
  // The showcase's title block names its own demo company; the period line is set per slice by the app.
  objects.titleBlock = { ...(objects.titleBlock ?? {}), unitLine: 'Caldova GmbH (fictional)', measureLine: `${p.name} · kEUR`, periodLine: '' };
  // The app's notation: grass green and pure red variances, explicit so the visual never uses its teal.
  objects.style = { ...(objects.style ?? {}), colorMode: 'ibcs', goodColor: { solid: { color: '#5DBB2C' } }, badColor: { solid: { color: '#FF0000' } } };
  if (p.defaultLevel) objects.hierarchy = { ...(objects.hierarchy ?? {}), defaultLevel: p.defaultLevel };
  return {
    name: p.name,
    template: page.template,
    description: p.description,
    width: page.width,
    height: page.height,
    background: page.background,
    tiles: [{ id: p.tpl.toLowerCase(), visual: 'pnl', rect: [327, 123, 1566, 894], bindings: p.bindings, showItemsWithNoData: true, objects }],
  };
});

const spec = {
  name: 'Caldova Finance',
  about: 'The three statements of Caldova GmbH (fictional) with the original P&L Statement byDatenWG visual, built with dwg cli by Michael Tenner (Daten-WG).',
  resolution: showcase.resolution,
  visualHeaders: showcase.visualHeaders,
  footer: 'Fictional data · IBCS notation, not certified · Visuals: P&L Statement byDatenWG (Michael Tenner)',
  slicers: [{ column: "'Calendar'[Year]", label: 'Year', default: [2026], multi: false }],
  pages,
};
mkdirSync(resolve(ROOT, 'dwg'), { recursive: true });
writeFileSync(resolve(ROOT, 'dwg/caldova-finance.json'), JSON.stringify(spec, null, 2) + '\n');
console.log(`dwg/caldova-finance.json: ${pages.length} pages (${PAGES.map((p) => p.tpl).join(', ')})`);
