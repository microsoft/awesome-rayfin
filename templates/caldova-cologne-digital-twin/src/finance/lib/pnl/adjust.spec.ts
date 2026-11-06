// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { applyAdjustments } from './adjust';
import type { KontoRow, KontoWert } from './engine';

const k = (id: string, l1: string, sign: number): KontoRow => ({ id, parent: '', name: id, l1, l2: '', l3: '', rowType: 'Account', formula: '', sign, displayInvert: false, varianceInvert: false, sort: 0 });
const w = (fc: number): KontoWert => ({ ac: 0, fc, pl: 0, py: 0, plYtd: 0, pyYtd: 0 });

describe('applyAdjustments', () => {
  const konten = [k('REV1', 'Net revenue', 1), k('COGS1', 'Cost of goods sold', -1)];
  const werte = new Map([
    ['REV1', w(1000)],
    ['COGS1', w(600)],
  ]);
  const monate = [{ monat: '2026-09', line: 'Net revenue', ac: 0, fc: 100, pl: 0, py: 0 }];

  it('moves account FC by new minus base and signs the monthly line', () => {
    const r = applyAdjustments(2026, konten, werte, monate, [
      { account_id: 'REV1', month: '2026-09', base_value: 100, new_value: 130 },
      { account_id: 'COGS1', month: '2026-10', base_value: 50, new_value: 70 },
    ]);
    expect(r.werte.get('REV1')?.fc).toBe(1030);
    expect(r.werte.get('COGS1')?.fc).toBe(620);
    expect(r.monate.find((m) => m.monat === '2026-09' && m.line === 'Net revenue')?.fc).toBe(130);
    expect(r.monate.find((m) => m.monat === '2026-10' && m.line === 'Cost of goods sold')?.fc).toBe(-20);
    expect(r.applied).toBe(2);
    expect(r.delta).toBe(50);
  });

  it('ignores other years, unknown accounts and zero deltas, and never mutates input', () => {
    const r = applyAdjustments(2026, konten, werte, monate, [
      { account_id: 'REV1', month: '2025-12', base_value: 1, new_value: 5 },
      { account_id: 'NOPE', month: '2026-09', base_value: 1, new_value: 5 },
      { account_id: 'REV1', month: '2026-11', base_value: 7, new_value: 7 },
    ]);
    expect(r.applied).toBe(0);
    expect(werte.get('REV1')?.fc).toBe(1000);
    expect(monate[0].fc).toBe(100);
  });
});
