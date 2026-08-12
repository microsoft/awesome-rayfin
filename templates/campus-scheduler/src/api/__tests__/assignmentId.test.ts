import { describe, expect, it } from 'vitest';

import { assignmentId } from '@/api/planStore';

/**
 * The app and the seeding tool must derive the SAME id, or the table grows duplicates.
 *
 * ⚠️ TWO WRITERS SHARE ONE KEY. `tools/fabric/seed_plan_assignments.py` loads the baked baseline
 * over TDS; the app upserts a session when a planner moves it. Both key the row on
 * `${site}:${sessionId}`. If the two implementations disagree by a single nibble, the app's upsert
 * misses the seeded row and INSERTS A SECOND ONE — leaving two rows claiming to be the current
 * position of the same session, which is exactly what this table exists to prevent, and which
 * would look like nothing at all until somebody queried it.
 *
 * The values below were produced by the PYTHON, not by this file. Asserting the TypeScript against
 * its own output would prove only that it is deterministic — which is not the property at risk.
 * Regenerate with `python tools/fabric/seed_plan_assignments.py --dry-run`.
 */
describe('the assignment id is the same in both languages', () => {
  const fromPython: Record<string, string> = {
    'oth:IM-DATA-1-C1-ALL-S1': 'ac548a6f-d190-4b2c-8acc-8d5d703f6162',
    'lmu:MED-MEDI-1-C3-ALL-S1': 'a8a7f0f5-fae5-464c-bdde-1edf8c5d803e',
  };

  for (const [key, expected] of Object.entries(fromPython)) {
    const [site, sessionId] = key.split(':');
    it(`agrees with the seeding tool for ${key}`, () => {
      expect(assignmentId(site, sessionId)).toBe(expected);
    });
  }

  it('is stable, and distinct per site', () => {
    // The site is part of the key because one database serves both universities and session ids
    // are only unique within one of them.
    expect(assignmentId('oth', 'X-1')).toBe(assignmentId('oth', 'X-1'));
    expect(assignmentId('oth', 'X-1')).not.toBe(assignmentId('lmu', 'X-1'));
  });

  it('looks like a uuid, because the column is one', () => {
    expect(assignmentId('oth', 'IM-DATA-1-C1-ALL-S1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
