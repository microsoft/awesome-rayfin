import { describe, expect, it } from 'vitest';

import { columnLayout } from './charts';

describe('scenario order in column charts', () => {
  it('draws PL, PY, AC/FC from left to right and from back to front', () => {
    const layout = columnLayout(30);
    // Array order is drawing order: the first is drawn first, i.e. furthest back.
    expect(layout.map((c) => c.code)).toEqual(['PL', 'PY', 'CUR']);
    // Left to right in the same order.
    expect(layout.map((c) => c.dx)).toEqual([...layout.map((c) => c.dx)].sort((a, b) => a - b));
    expect(new Set(layout.map((c) => c.dx)).size).toBe(3);
  });
});
