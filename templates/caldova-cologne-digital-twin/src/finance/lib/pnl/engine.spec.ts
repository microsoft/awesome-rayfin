// Ported with Caldova's line names (lib/pnl/engine.ts); the expected values are Michael Tenner's, unchanged.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseKonten, parseWerte } from './data';
import { bridge, buildPnl, EMPTY_SIM, evalFormula, type KontoRow, type KontoWert, type SimParams } from './engine';

const k = (p: Partial<KontoRow> & { id: string }): KontoRow => ({
  parent: '',
  name: p.id,
  l1: '',
  l2: '',
  l3: '',
  rowType: 'Account',
  formula: '',
  sign: 1,
  displayInvert: false,
  varianceInvert: false,
  sort: 0,
  ...p,
});

const w = (fc: number, ac = fc, pl = fc, py = fc): KontoWert => ({ ac, fc, pl, py, plYtd: ac, pyYtd: ac });

// Mini statement: revenue (2 divisions), COGS (material by division), OPEX, taxes.
const konten: KontoRow[] = [
  k({ id: 'N-REV', name: 'Revenue', rowType: 'Subtotal', sort: 1 }),
  k({ id: 'r1', parent: 'N-REV', l2: 'A', sort: 2 }),
  k({ id: 'r2', parent: 'N-REV', l2: 'B', sort: 3 }),
  k({ id: 'N-COGS', name: 'Cost of goods sold', rowType: 'Subtotal', sign: -1, displayInvert: true, sort: 10 }),
  k({ id: 'c1', parent: 'N-COGS', sign: -1, l2: 'Merchandise', l3: 'A', sort: 11 }),
  k({ id: 'F-GP', name: 'Gross profit', rowType: 'Formula', formula: '[Revenue] + [Cost of goods sold]', sort: 20 }),
  k({ id: 'K-GM', name: 'Gross margin %', rowType: 'KPI', formula: '[Gross profit] / [Revenue]', sort: 21 }),
  k({ id: 'N-OPEX', name: 'Operating expenses', rowType: 'Subtotal', sign: -1, displayInvert: true, sort: 30 }),
  k({ id: 'o1', parent: 'N-OPEX', sign: -1, l2: 'Sales & Marketing', sort: 31 }),
  k({ id: 'F-EBT', name: 'EBT', rowType: 'Formula', formula: '[Gross profit] + [Operating expenses]', sort: 40 }),
  k({ id: 'N-TAX', name: 'Income taxes', rowType: 'Subtotal', sign: -1, displayInvert: true, sort: 50 }),
  k({ id: 't1', parent: 'N-TAX', sign: -1, sort: 51 }),
  k({ id: 'F-NI', name: 'Net income', rowType: 'Formula', formula: '[EBT] + [Income taxes]', sort: 60 }),
];
const werte = new Map<string, KontoWert>([
  ['r1', w(600)],
  ['r2', w(400)],
  ['c1', w(300)],
  ['o1', w(200)],
  ['t1', w(150)], // 30 % of EBT 500
]);
const line = (m: ReturnType<typeof buildPnl>, name: string) => [...m.lines.values()].find((l) => l.name === name)!;

describe('evalFormula', () => {
  it('handles precedence, parentheses and references', () => {
    const v = { A: 10, B: 4 } as Record<string, number>;
    expect(evalFormula('[A] + [B] * 2', (n) => v[n])).toBe(18);
    expect(evalFormula('([A] - [B]) / 2', (n) => v[n])).toBe(3);
    expect(Number.isNaN(evalFormula('[A] / 0', () => 0))).toBe(true);
  });
});

describe('buildPnl', () => {
  it('signs costs, computes formulas and KPIs', () => {
    const m = buildPnl({ konten, werte, mode: 'fy', sim: { ...EMPTY_SIM, scope: 'fy' } });
    expect(line(m, 'Revenue').cols.base).toBe(1000);
    expect(line(m, 'Cost of goods sold').cols.base).toBe(-300);
    expect(line(m, 'Gross profit').cols.base).toBe(700);
    expect(line(m, 'Gross margin %').cols.base).toBeCloseTo(0.7);
    expect(line(m, 'Net income').cols.base).toBe(350);
  });

  it('leaves the simulation equal to the base without levers', () => {
    const m = buildPnl({ konten, werte, mode: 'fy', sim: EMPTY_SIM });
    for (const l of m.lines.values()) expect(l.cols.sim).toBeCloseTo(l.cols.base, 6);
  });

  it('applies price and volume per division and lets material follow volume', () => {
    const sim: SimParams = { ...EMPTY_SIM, scope: 'fy', divisions: { A: { price: 10, volume: 10 } } };
    const m = buildPnl({ konten, werte, mode: 'fy', sim });
    expect(line(m, 'Revenue').cols.sim).toBeCloseTo(600 * 1.21 + 400);
    expect(line(m, 'Cost of goods sold').cols.sim).toBeCloseTo(-330); // volume only, not price
    const ebt = 726 + 400 - 330 - 200;
    expect(line(m, 'Income taxes').cols.sim).toBeCloseTo(-0.3 * ebt);
    expect(line(m, 'Net income').cols.sim).toBeCloseTo(0.7 * ebt);
  });

  it('only touches open months in rest-of-year scope', () => {
    const half = new Map(werte);
    half.set('r1', w(600, 300)); // 300 actual, 300 still to come
    const sim: SimParams = { ...EMPTY_SIM, scope: 'ytg', divisions: { A: { price: 10, volume: 0 } } };
    const m = buildPnl({ konten, werte: half, mode: 'fy', sim });
    expect(line(m, 'Revenue').cols.sim).toBeCloseTo(300 + 330 + 400);
  });

  it('bridge steps add up to the simulated net income', () => {
    const sim: SimParams = {
      ...EMPTY_SIM,
      scope: 'fy',
      divisions: { A: { price: 5, volume: -3 } },
      material: 4,
      opex: { 'Sales & Marketing': -10 },
      taxPp: 2,
    };
    const steps = bridge({ konten, werte, sim });
    const total = steps.slice(0, -1).reduce((a, s) => a + s.value, 0);
    expect(total).toBeCloseTo(steps[steps.length - 1].value, 6);
  });
});

// Real model data captured with `rayfin connector invoke` (skipped when absent).
const insp = resolve(__dirname, '../../../../../inspection');
const has = existsSync(resolve(insp, 'konten.result.json')) && existsSync(resolve(insp, 'kontowerte.result.json'));
const read = (n: string) => {
  const j = JSON.parse(readFileSync(resolve(insp, `${n}.result.json`), 'utf8'));
  return (j.result ?? j).table;
};

describe.skipIf(!has)('real model 2026', () => {
  it('builds a consistent statement', () => {
    const kk = parseKonten(read('konten'));
    const ww = parseWerte(read('kontowerte'));
    const m = buildPnl({ konten: kk, werte: ww, mode: 'fy', sim: EMPTY_SIM });
    const rev = line(m, 'Revenue').cols.base;
    const gp = line(m, 'Gross profit').cols.base;
    const cogs = line(m, 'Cost of goods sold').cols.base;
    expect(rev).toBeGreaterThan(3e9);
    expect(cogs).toBeLessThan(0);
    expect(gp).toBeCloseTo(rev + cogs, 0);
    const ni = line(m, 'Net income').cols.base;
    console.log('FY26 AC+FC', { rev, gp, ni, margin: ni / rev, unassigned: m.unassigned, divisions: m.divisions });
    expect(m.divisions.length).toBeGreaterThanOrEqual(4);
  });
});
