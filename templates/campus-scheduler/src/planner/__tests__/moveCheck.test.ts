import { describe, expect, it } from 'vitest';

import { conflictKey, verdictFor, type PlanConflict } from '../moveCheck';

/**
 * ⚠️ THE POINT OF THESE TESTS IS THE SUBTRACTION, not the happy path.
 *
 * The server returns every conflict in the plan. A drag that reported red because of a clash in
 * another building — one the planner never touched and cannot see — would be indistinguishable
 * from a bug, and would train people to ignore the verdict. So what is asserted here is that a
 * pre-existing problem stays invisible and only the NEW one surfaces.
 */

const clash = (over: Partial<PlanConflict>): PlanConflict => ({
  type: 'room_double_booked',
  severity: 'hard',
  slotId: 'MO-3',
  roomId: 'K 001',
  sessions: ['s1', 's2'],
  ...over,
});

describe('verdictFor', () => {
  it('passes a move that breaks nothing', () => {
    expect(verdictFor('s9', [], [])).toEqual({ legal: true, caused: [] });
  });

  it('reports a conflict the move introduces', () => {
    const verdict = verdictFor('s2', [], [clash({})]);
    expect(verdict.legal).toBe(false);
    expect(verdict.caused).toHaveLength(1);
  });

  it('ignores a conflict the plan already had', () => {
    // The whole reason this is a difference and not a count.
    const existing = clash({ slotId: 'DI-1', roomId: 'Q 210', sessions: ['x1', 'x2'] });
    const verdict = verdictFor('s2', [existing], [existing, clash({})]);
    expect(verdict.caused).toHaveLength(1);
    expect(verdict.caused[0].roomId).toBe('K 001');
  });

  it('recognises a pre-existing clash whose session pair comes back reversed', () => {
    // ⚠️ `room_double_booked` names its sessions [incumbent, newcomer], and which is which
    // depends on dictionary order in the server's placement map. Comparing the raw list would
    // make an untouched clash look new on every single check.
    const before = clash({ sessions: ['a', 'b'] });
    const after = clash({ sessions: ['b', 'a'] });
    expect(conflictKey(before)).toBe(conflictKey(after));
    expect(verdictFor('a', [before], [after]).caused).toEqual([]);
  });

  it('puts the moved session first but still reports collateral', () => {
    // Displacing a session into an occupied room breaks somebody ELSE's booking. That conflict
    // may not name the dragged session at all, and swallowing it would be worse than useless.
    const mine = clash({ sessions: ['s2', 'other'] });
    const collateral = clash({ type: 'over_capacity', sessionId: 'zz', sessions: undefined });
    const verdict = verdictFor('s2', [], [collateral, mine]);
    expect(verdict.caused[0]).toBe(mine);
    expect(verdict.caused).toHaveLength(2);
    expect(verdict.legal).toBe(false);
  });

  it('does not fail a move for a soft conflict', () => {
    const soft = clash({ type: 'unattractive_slot', severity: 'soft' });
    expect(verdictFor('s2', [], [soft]).legal).toBe(true);
  });
});
