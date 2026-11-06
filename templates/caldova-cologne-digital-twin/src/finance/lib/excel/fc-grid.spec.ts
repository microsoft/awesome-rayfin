// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildGrid, diffGrid, type FcCell } from './fc-grid';
import { readWorkbook, writeWorkbook } from './fc-workbook';

const cells: FcCell[] = [
  { account: 'A1', name: 'Miete', l2: 'G&A', l3: 'EMEA', month: '2026-09', fc: 100 },
  { account: 'A1', name: 'Miete', l2: 'G&A', l3: 'EMEA', month: '2026-10', fc: 110 },
  { account: 'B2', name: 'Reisen', l2: 'Sales', l3: 'APAC', month: '2026-09', fc: 50 },
  { account: 'B2', name: 'Reisen', l2: 'Sales', l3: 'APAC', month: '2026-10', fc: 55 },
];

describe('forecast grid', () => {
  const grid = buildGrid(2026, 'Operating expenses', cells, new Map([['A1|2026-10', { new_value: 120 }]]));

  it('prefills the newest adjustment and keeps the model value as base', () => {
    expect(grid.months).toEqual(['2026-09', '2026-10']);
    expect(grid.current.get('A1|2026-10')).toBe(120);
    expect(grid.base.get('A1|2026-10')).toBe(110);
  });

  it('returns only real changes, parses German numbers, reports bad cells and unknown accounts', () => {
    const d = diffGrid(grid, [
      { account: 'A1', values: { '2026-09': 100, '2026-10': '1.250,50' } },
      { account: 'B2', values: { '2026-09': 'viel', '2026-10': '' } },
      { account: 'ZZ', values: { '2026-09': 1 } },
    ]);
    expect(d.changes).toEqual([{ account_id: 'A1', name: 'Miete', month: '2026-10', base_value: 110, previous: 120, new_value: 1250.5 }]);
    expect(d.errors).toHaveLength(1);
    expect(d.unknownAccounts).toEqual(['ZZ']);
  });

  it('survives a real xlsx round trip', async () => {
    const blob = await writeWorkbook(grid);
    const parsed = await readWorkbook(await blob.arrayBuffer());
    expect(parsed).toMatchObject({ year: 2026, l1: 'Operating expenses', months: ['2026-09', '2026-10'] });
    const edited = parsed.rows.map((r) => (r.account === 'B2' ? { ...r, values: { ...r.values, '2026-09': 75 } } : r));
    expect(diffGrid(grid, edited).changes).toMatchObject([{ account_id: 'B2', month: '2026-09', base_value: 50, new_value: 75 }]);
    expect(diffGrid(grid, parsed.rows).changes).toEqual([]);
  }, 30_000); // exceljs is slow while the whole suite runs in parallel
});
