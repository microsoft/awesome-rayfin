import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { allSlices, DWG_PAGES, dwgSlice, sliceQueries, withSlice, type StatementId } from '@/domain/dwgPeriod';
import type { Snapshot } from '@/domain/types';
import { answer, type DwgSnapshot } from '@/services/dwgSnapshot';

const statements = JSON.parse(readFileSync('public/data/statements.json', 'utf-8')) as Snapshot;
const baked = JSON.parse(readFileSync('public/data/dwg-snapshot.json', 'utf-8')) as DwgSnapshot;
const cutoff = statements.meta.cutoff;

describe('original visual slices', () => {
  it('caps a forecast month at the last closed month of its year', () => {
    expect(dwgSlice(statements.months, `${cutoff.slice(0, 4)}-12`)).toEqual({ year: Number(cutoff.slice(0, 4)), lastMonth: Number(cutoff.slice(5)) });
    expect(dwgSlice(statements.months, `${cutoff.slice(0, 4)}-03`)?.lastMonth).toBe(3);
  });

  it('has a baked answer for every month the picker offers, on all three pages', () => {
    for (const m of statements.months) {
      const slice = dwgSlice(statements.months, m.id);
      if (!slice) continue;
      for (const id of Object.keys(DWG_PAGES) as StatementId[]) {
        for (const q of sliceQueries(withSlice(DWG_PAGES[id], id, slice))) {
          const r = answer(baked, q.query);
          expect(r.status, `${id} ${m.id}`).toBe('success');
          if (r.status === 'success') expect(r.table.rows.length).toBeGreaterThan(0);
        }
      }
    }
    expect(Object.keys(baked.results)).toHaveLength(allSlices(statements.months).length * 3);
  });

  it('names a missing query instead of answering empty', () => {
    expect(answer(baked, 'EVALUATE {1}').status).toBe('error');
  });
});
