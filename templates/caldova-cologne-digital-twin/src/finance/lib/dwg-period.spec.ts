import { describe, expect, it } from 'vitest';

import { page as statement } from '@finance/dwg/pages/guv-statement';

import { withPeriod } from './dwg-period';

describe('withPeriod', () => {
  it('filters the year and the closed months and rewrites the period line', () => {
    const p = withPeriod(statement, 2025, 3);
    expect(p.filters).toEqual([
      { column: "'Calender'[Year]", values: [2025] },
      { column: "'Calender'[Month]", values: [1, 2, 3] },
    ]);
    const title = (p.tiles[0].objects as Record<string, Record<string, unknown>>).titleBlock;
    expect(title.periodLine).toBe('Jan..Mar 2025 (YTD), FY outlook');
    // the generated spec is not mutated
    expect(statement.filters?.[0]).toEqual({ column: "'Calender'[Year]", values: [2026] });
  });
});
