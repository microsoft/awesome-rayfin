import { describe, expect, it } from 'vitest';

import { adjustmentStatus, effectiveAdjustments, frozenIdsFor, isSignedOff, latestSignOff } from './lock';
import type { AdjustmentRecord, SignOffRecord } from './records';

const t = (min: number) => new Date(Date.UTC(2026, 9, 5, 9, min));
const so = (min: number, action: SignOffRecord['action'], frozenIds: string[] = [], month = '2026-09'): SignOffRecord => ({
  id: `s${min}`,
  month,
  action,
  frozenIds,
  authorEmail: 'c@contoso.com',
  authorName: 'C',
  createdAt: t(min),
});
const adj = (min: number, month = '2026-11', period = '2026-09'): AdjustmentRecord => ({
  id: `a${min}`,
  accountId: '6500',
  month,
  amount: 1000,
  period,
  reason: 'r',
  authorEmail: 'a@contoso.com',
  authorName: 'A',
  createdAt: t(min),
});
const CUTOFF = '2026-09';

describe('close lock (read-time rule)', () => {
  it('applies adjustments of an open close', () => {
    expect(adjustmentStatus(adj(1), [], CUTOFF)).toBe('applied');
  });

  it('applies exactly what the sign-off froze', () => {
    const signOffs = [so(10, 'sign-off', ['a9'])];
    expect(adjustmentStatus(adj(9), signOffs, CUTOFF)).toBe('applied');
    expect(adjustmentStatus(adj(11), signOffs, CUTOFF)).toBe('signed-off');
  });

  it('never applies a row backdated to before the sign-off', () => {
    // Written after the sign-off with a created_at from before it: not in the frozen list, so it stays out.
    const backdated = { ...adj(1), id: 'late' };
    expect(adjustmentStatus(backdated, [so(10, 'sign-off', ['a5'])], CUTOFF)).toBe('signed-off');
  });

  it('hands the close back on reopen', () => {
    const signOffs = [so(10, 'sign-off', ['a9']), so(20, 'reopen')];
    expect(adjustmentStatus(adj(15), signOffs, CUTOFF)).toBe('applied');
    expect(isSignedOff(signOffs, '2026-09')).toBe(false);
    expect(latestSignOff(signOffs, '2026-09')?.action).toBe('reopen');
  });

  it('keeps closes apart', () => {
    expect(adjustmentStatus(adj(15), [so(10, 'sign-off', [], '2026-08')], CUTOFF)).toBe('applied');
  });

  it('never applies an adjustment to an actual month', () => {
    expect(adjustmentStatus(adj(1, '2026-09'), [], CUTOFF)).toBe('actual-month');
  });

  it('reads sign-offs in time order, not in the order they arrive', () => {
    const signOffs = [so(20, 'sign-off', ['a15']), so(10, 'reopen')];
    expect(effectiveAdjustments([adj(15), adj(25)], signOffs, CUTOFF).map((a) => a.id)).toEqual(['a15']);
  });

  it('never lets a row escape the lock by naming another close', () => {
    // The row says it belongs to the August close, which has no sign-off: it still must not apply.
    expect(adjustmentStatus(adj(30, '2026-11', '2026-08'), [so(10, 'sign-off', [])], CUTOFF)).toBe('other-close');
    expect(adjustmentStatus(adj(30, '2026-11', '2026-08'), [], CUTOFF)).toBe('other-close');
  });

  it('marks rows on lines that cannot be adjusted as invalid', () => {
    const adjustable = new Set(['6500']);
    expect(adjustmentStatus({ ...adj(1), accountId: 'N-OPEX' }, [], CUTOFF, adjustable)).toBe('invalid');
    expect(adjustmentStatus({ ...adj(1), accountId: 'nope' }, [], CUTOFF, adjustable)).toBe('invalid');
    expect(adjustmentStatus({ ...adj(1), amount: Number.NaN }, [], CUTOFF, adjustable)).toBe('invalid');
    expect(adjustmentStatus(adj(1), [], CUTOFF, adjustable)).toBe('applied');
  });

  it('freezes the adjustments that apply at sign-off time, of this close only', () => {
    const rows = [adj(1), adj(2, '2026-12', '2026-08'), adj(3, '2026-09')];
    expect(frozenIdsFor(rows, [], CUTOFF)).toEqual(['a1']);
  });
});
