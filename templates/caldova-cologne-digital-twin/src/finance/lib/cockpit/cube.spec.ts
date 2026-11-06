// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { aggScen, cubeIndex, emptyCube, NO_FILTER, type BaseKpi } from './cube';
import { buildCatalogue, favourable, kpiValue } from './kpis';
import { buildCube, type QueryTableLike } from './load';
import { relCap } from './ibcs';

const kpis: BaseKpi[] = [
  { id: 'Revenue', group: 'Result', unit: 'EUR', higherBetter: true, sort: 1 },
  { id: 'Profit', group: 'Result', unit: 'EUR', higherBetter: true, sort: 2 },
  { id: 'Customer Satisfaction', group: 'Quality', unit: 'points', higherBetter: true, sort: 3 },
];
const markets = [
  { land: 'A', region: 'R1', reife: '' },
  { land: 'B', region: 'R2', reife: '' },
];
const products = [{ produkt: 'P', kategorie: 'K', linie: '' }];

function mini() {
  const c = emptyCube(2026, 2, kpis, markets, products);
  for (let m = 0; m < 12; m++) {
    for (let ci = 0; ci < 2; ci++) {
      const i = (k: number) => cubeIndex(c, ci, 0, m, k);
      if (m < 2) c.values.AC[i(0)] = 10;
      c.values.FC3[i(0)] = 12;
      c.values.PL1[i(0)] = 11;
      c.values.PY[i(0)] = 9;
      if (m < 2) c.values.AC[i(1)] = 2;
      c.values.FC3[i(1)] = 3;
      if (m < 2) c.values.AC[i(2)] = 80 + ci * 10;
      c.values.FC3[i(2)] = 70;
    }
  }
  return c;
}
const ch = { plan: 'PL1' as const, fc: 'FC3' as const };

describe('cube aggregation', () => {
  it('ACT = actuals for closed months, forecast for open months', () => {
    const c = mini();
    expect(aggScen(c, 'ACT', 0, [1, 2], NO_FILTER, ch)).toBe(40);
    expect(aggScen(c, 'ACT', 0, [1, 2, 3], NO_FILTER, ch)).toBe(40 + 24);
    expect(aggScen(c, 'PL', 0, [1, 2, 3], NO_FILTER, ch)).toBe(66);
  });

  it('averages scores instead of summing and weights AC/FC by months', () => {
    const c = mini();
    expect(aggScen(c, 'ACT', 2, [1, 2], NO_FILTER, ch)).toBe(85);
    expect(aggScen(c, 'ACT', 2, [1, 2, 3, 4], NO_FILTER, ch)).toBeCloseTo((85 * 2 + 70 * 2) / 4);
  });

  it('applies member filters', () => {
    const c = mini();
    expect(aggScen(c, 'ACT', 0, [1], { markets: new Set([1]), products: null }, ch)).toBe(10);
  });

  it('computes ratios as quotient of sums', () => {
    const c = mini();
    const cat = buildCatalogue(c);
    const margin = cat.find((k) => k.id === 'margin')!;
    expect(kpiValue(c, margin, 'ACT', [1, 2], NO_FILTER, ch)).toBeCloseTo(8 / 40);
  });

  it('favourable respects polarity', () => {
    expect(favourable({ higherBetter: false } as never, 5)).toBe(-5);
  });

  it('caps outliers in Δ% tiers', () => {
    expect(relCap([0.1, 0.12, 0.09, 0.9])).toBeCloseTo(0.12);
    expect(relCap([0.1, 0.2, 0.15])).toBeCloseTo(0.2);
  });
});

// Real model data captured with `rayfin connector invoke` (skipped when absent).
const insp = resolve(__dirname, '../../../../../inspection');
const names = ['info', 'kpis', 'maerkte', 'produkte', 'wuerfel', 'vorjahr'] as const;
const has = names.every((n) => existsSync(resolve(insp, `${n}.result.json`)));
const read = (n: string): QueryTableLike => {
  const j = JSON.parse(readFileSync(resolve(insp, `${n}.result.json`), 'utf8'));
  return (j.result ?? j).table;
};

describe.skipIf(!has)('real model', () => {
  it('matches the profiled YTD figures', () => {
    const cube = buildCube({
      info: read('info'),
      kpis: read('kpis'),
      maerkte: read('maerkte'),
      produkte: read('produkte'),
      wuerfel: read('wuerfel'),
      vorjahr: read('vorjahr'),
    });
    expect(cube.year).toBe(2026);
    expect(cube.lastAc).toBe(8);
    const cat = buildCatalogue(cube);
    const rev = cat.find((k) => k.id === 'Revenue')!;
    const ytd = [1, 2, 3, 4, 5, 6, 7, 8];
    // Profiled: AC YTD 117.69 M, PY YTD 90.12 M, PL1 YTD 100.50 M, FC3 FY 179.30 M.
    expect(kpiValue(cube, rev, 'ACT', ytd, NO_FILTER, ch) / 1e6).toBeCloseTo(117.69, 1);
    expect(kpiValue(cube, rev, 'PY', ytd, NO_FILTER, ch) / 1e6).toBeCloseTo(90.12, 1);
    expect(kpiValue(cube, rev, 'PL', ytd, NO_FILTER, ch) / 1e6).toBeCloseTo(100.5, 1);
    const fy = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(kpiValue(cube, rev, 'FC', fy, NO_FILTER, ch) / 1e6).toBeCloseTo(179.3, 0);
    const cs = cat.find((k) => k.id === 'Customer Satisfaction')!;
    expect(kpiValue(cube, cs, 'ACT', ytd, NO_FILTER, ch)).toBeCloseTo(81.9, 0);
  });
});
