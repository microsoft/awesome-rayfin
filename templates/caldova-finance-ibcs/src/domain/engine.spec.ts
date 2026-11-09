import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type Adjustment, forecastMonths, forecastWithAdjustments } from './engine';
import { statementRows } from './statements';
import type { Snapshot } from './types';

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../public/data/statements.json'), 'utf-8')
) as Snapshot;

const BS_LEAVES = ['B-FA-FLEET', 'B-FA-EQUIP', 'B-CA-INV', 'B-CA-REC', 'B-CA-CASH', 'B-EQ-CAP', 'B-EQ-RE', 'B-EQ-NI', 'B-PR-TAX', 'B-PR-OTH', 'B-LI-LOAN', 'B-LI-PAY'];
// Baked values are rounded to cents; the roll accumulates that rounding over a few months.
const CENTS = 0.5;

describe('forecast engine', () => {
  it('reproduces the baked forecast without adjustments', () => {
    const fc = forecastWithAdjustments(snapshot, []);
    for (const month of forecastMonths(snapshot)) {
      for (const id of [...BS_LEAVES, 'C-NET', 'C-OPEN', 'C-CLOSE', 'C-OP-REC', 'C-OP-PR', 'C-FI-DIV']) {
        expect(Math.abs(fc[month][id] - snapshot.values.FC[month][id]), `${month} ${id}`).toBeLessThan(CENTS);
      }
    }
  });

  it('keeps all three statements articulated for every scenario and month', () => {
    for (const scen of ['AC', 'PL', 'FC', 'PY'] as const) {
      for (const [month, vals] of Object.entries(snapshot.values[scen])) {
        if (!('B-CA-CASH' in vals)) continue;
        const p = { month, mode: 'MTD' as const };
        const bs = statementRows(snapshot, snapshot.values[scen], 'BS', p);
        expect(Math.abs(bs['B-ASSETS'] - bs['B-EQL']), `${scen} ${month} balance`).toBeLessThan(0.05);
        const pl = statementRows(snapshot, snapshot.values[scen], 'PL', p);
        const cf = statementRows(snapshot, snapshot.values[scen], 'CF', p);
        expect(Math.abs(pl['F-NI'] - cf['C-OP-NI']), `${scen} ${month} net income`).toBeLessThan(0.05);
        expect(Math.abs(cf['C-CLOSE'] - bs['B-CA-CASH']), `${scen} ${month} cash`).toBeLessThan(0.05);
        expect(Math.abs(cf['C-OPEN'] + cf['C-NET'] - cf['C-CLOSE']), `${scen} ${month} cash flow`).toBeLessThan(0.05);
      }
    }
  });

  it('carries a forecast adjustment through all three statements', () => {
    const [first] = forecastMonths(snapshot);
    const base = forecastWithAdjustments(snapshot, []);
    // 100 000 more rent (a cost) in the first forecast month.
    const adj = forecastWithAdjustments(snapshot, [{ accountId: '6500', month: first, amount: 100_000 }]);
    expect(adj[first]['6500'] - base[first]['6500']).toBeCloseTo(-100_000, 2);
    const p = { month: '2026-12', mode: 'MTD' as const };
    const bsBase = statementRows(snapshot, base, 'BS', p);
    const bsAdj = statementRows(snapshot, adj, 'BS', p);
    // Net income drops by the cost after tax (EBT stays positive in this month), cash by the same.
    const niDelta = bsAdj['B-EQ-NI'] - bsBase['B-EQ-NI'];
    expect(niDelta).toBeLessThan(-60_000);
    expect(niDelta).toBeGreaterThan(-100_000);
    expect(Math.abs(bsAdj['B-ASSETS'] - bsAdj['B-EQL'])).toBeLessThan(0.05);
    const cfAdj = statementRows(snapshot, adj, 'CF', { month: '2026-12', mode: 'YTD' });
    expect(Math.abs(cfAdj['C-CLOSE'] - bsAdj['B-CA-CASH'])).toBeLessThan(0.05);
  });

  // The oracle: tools/generate_statements.py applies the same adjustment sets in Python.
  const golden = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '__fixtures__/golden.json'), 'utf-8')
  ) as Record<string, { adjustments: Adjustment[]; values: Record<string, Record<string, number>> }>;
  for (const [name, set] of Object.entries(golden)) {
    it(`matches the Python oracle: ${name}`, () => {
      const fc = forecastWithAdjustments(snapshot, set.adjustments);
      for (const [month, want] of Object.entries(set.values)) {
        for (const [id, v] of Object.entries(want)) {
          expect(Math.abs(fc[month][id] - v), `${month} ${id}`).toBeLessThan(CENTS);
        }
      }
    });
  }

  it('never throws on rows from the browser: unknown, subtotal and tax lines are ignored', () => {
    const [first] = forecastMonths(snapshot);
    const base = forecastWithAdjustments(snapshot, []);
    const bad = forecastWithAdjustments(snapshot, [
      { accountId: 'nope', month: first, amount: 1e6 },
      { accountId: 'N-OPEX', month: first, amount: 1e6 },
      { accountId: '8000', month: first, amount: 1e6 },
      { accountId: 'B-CA-CASH', month: first, amount: 1e6 },
      { accountId: '6500', month: first, amount: Number.NaN },
    ]);
    expect(bad['2026-12']['B-CA-CASH']).toBe(base['2026-12']['B-CA-CASH']);
  });

  it('recomputes taxes exactly as the baked forecast has them', () => {
    // An adjustment pair that cancels out recomputes the month's taxes from scratch: nothing may move.
    for (const month of forecastMonths(snapshot)) {
      const zero = forecastWithAdjustments(snapshot, [
        { accountId: '6500', month, amount: 1 },
        { accountId: '6500', month, amount: -1 },
      ]);
      for (const id of ['8000', '8010', 'B-CA-CASH']) {
        expect(Math.abs(zero[month][id] - snapshot.values.FC[month][id]), `${month} ${id}`).toBeLessThan(CENTS);
      }
    }
  });

  it('ignores adjustments to closed months', () => {
    const closed = snapshot.meta.cutoff;
    const adj = forecastWithAdjustments(snapshot, [{ accountId: '6500', month: closed, amount: 1 }]);
    expect(adj[closed]['6500']).toBe(snapshot.values.FC[closed]['6500']);
  });
});
