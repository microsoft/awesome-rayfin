import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assembleSnapshot } from './assemble';
import type { Snapshot } from './types';

const shipped = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/data/statements.json'), 'utf-8')) as Snapshot;

/** The rows a semantic model answers for the three queries, built back from the shipped snapshot. */
function modelRows(s: Snapshot) {
  return {
    accounts: s.accounts.map((a) => ({
      'Account[AccountID]': a.id,
      'Account[Statement]': a.statement,
      'Account[ParentID]': a.parentId ?? '',
      'Account[Name]': a.name,
      'Account[RowType]': a.rowType,
      'Account[Sign]': a.sign,
      'Account[Formula]': a.formula,
      'Account[GoodDirection]': a.goodUp === true ? 'up' : a.goodUp === false ? 'down' : 'none',
      'Account[Sort]': a.sort,
    })),
    months: s.months.map((m) => ({ 'Month[Month]': m.id, 'Month[Year]': m.year, 'Month[MonthNo]': m.monthNo, 'Month[MonthName]': m.label, 'Month[Closed]': m.closed })),
    values: Object.entries(s.values).flatMap(([sc, byMonth]) =>
      Object.entries(byMonth).flatMap(([m, vals]) => Object.entries(vals).map(([a, v]) => ({ '[a]': a, '[m]': m, '[s]': sc, '[v]': v })))
    ),
  };
}

describe('live mode assembly', () => {
  it('turns the model rows into exactly the snapshot the bake ships', () => {
    const live = assembleSnapshot(modelRows(shipped), shipped.drivers, 'test');
    expect(live.accounts).toEqual(shipped.accounts);
    expect(live.months).toEqual(shipped.months);
    expect(live.values).toEqual(shipped.values);
    expect(live.meta.cutoff).toBe(shipped.meta.cutoff);
  });

  it('refuses drivers made for another cut-off', () => {
    expect(() => assembleSnapshot(modelRows(shipped), { ...shipped.drivers, cutoff: '2026-08' }, 'test')).toThrow(/cut-off/);
  });
});
