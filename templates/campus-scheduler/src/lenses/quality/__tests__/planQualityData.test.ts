import { describe, expect, it } from 'vitest';

import { summarise, type PlanQualityModel } from '../planQualityData';

/**
 * The plan-quality arithmetic.
 *
 * The ordering is the part that matters and the part that can be quietly wrong: this list is what
 * a planner works down, so ranking by "cohorts affected" instead of "students kept waiting" would
 * send them to fix a gap for 20 people while 222 wait elsewhere.
 */

const day = (over: Partial<PlanQualityModel['cohortDays'][number]> = {}) => ({
  cohortId: 'IM-INFO-1',
  programme: 'Informatik',
  facultyId: 'IM',
  semester: 1,
  headcount: 100,
  day: 'Mo',
  dayIndex: 0,
  sessions: 2,
  firstBlock: 1,
  lastBlock: 2,
  spanBlocks: 2,
  idleBlocks: 0,
  campusChanges: 0,
  tightTransfers: 0,
  worstShortfallMin: 0,
  ...over,
});

const model = (
  days: PlanQualityModel['cohortDays'],
  unpopular: PlanQualityModel['unpopularSessions'] = []
): PlanQualityModel => ({
  aoi: 'test',
  site: 'test',
  provenance: 'derived',
  sourceProvenance: 'synthetic',
  syntheticWarning: '',
  blocksPerDay: 7,
  unpopularThreshold: 0.55,
  groupCheck: { combinations: 10, collisions: 0 },
  studentGroupMappingModelled: false,
  cohortDays: days,
  unpopularSessions: unpopular,
});

describe('summarise', () => {
  it('totals the shape of the week', () => {
    const s = summarise(
      model([
        day({ idleBlocks: 2, spanBlocks: 4 }),
        day({ day: 'Di', idleBlocks: 0, spanBlocks: 3, campusChanges: 1 }),
      ])
    );
    expect(s.days).toBe(2);
    expect(s.idleBlocks).toBe(2);
    expect(s.daysWithGap).toBe(1);
    expect(s.longestDayBlocks).toBe(4);
    expect(s.campusChanges).toBe(1);
  });

  it('ranks by STUDENTS kept waiting, not by cohorts affected', () => {
    // The whole point of the ordering. A 2-block gap for 222 people outranks a 3-block gap for 20.
    const s = summarise(
      model([
        day({ cohortId: 'small', headcount: 20, idleBlocks: 3, spanBlocks: 5 }),
        day({ cohortId: 'big', headcount: 222, idleBlocks: 2, spanBlocks: 4 }),
      ])
    );
    expect(s.cohorts.map((c) => c.cohortId)).toEqual(['big', 'small']);
    expect(s.cohorts[0].studentIdleBlocks).toBe(444);
  });

  it('puts an impossible transfer above every gap', () => {
    // A walk that cannot be made is a broken plan; a gap is merely an unpleasant one.
    const s = summarise(
      model([
        day({ cohortId: 'gappy', headcount: 500, idleBlocks: 9, spanBlocks: 10 }),
        day({ cohortId: 'tight', headcount: 10, idleBlocks: 0, tightTransfers: 1 }),
      ])
    );
    expect(s.cohorts[0].cohortId).toBe('tight');
  });

  it('counts unattractive slots per cohort', () => {
    const s = summarise(
      model(
        [day({ cohortId: 'a' }), day({ cohortId: 'b' })],
        [
          { sessionId: 's1', cohortId: 'a', slotId: 'Mo-1', day: 'Mo', block: 1, startTime: '08:00', desirability: 0.4 },
          { sessionId: 's2', cohortId: 'a', slotId: 'Fr-7', day: 'Fr', block: 7, startTime: '18:30', desirability: 0.55 },
        ]
      )
    );
    expect(s.unpopularSessions).toBe(2);
    expect(s.cohorts.find((c) => c.cohortId === 'a')?.unpopularSessions).toBe(2);
    expect(s.cohorts.find((c) => c.cohortId === 'b')?.unpopularSessions).toBe(0);
  });

  it('aggregates a cohort across its days', () => {
    const s = summarise(
      model([
        day({ day: 'Mo', idleBlocks: 1, spanBlocks: 3 }),
        day({ day: 'Di', idleBlocks: 2, spanBlocks: 5 }),
        day({ day: 'Mi', idleBlocks: 0, spanBlocks: 2 }),
      ])
    );
    const cohort = s.cohorts[0];
    expect(cohort.days).toBe(3);
    expect(cohort.daysWithGap).toBe(2);
    expect(cohort.idleBlocks).toBe(3);
    expect(cohort.longestDayBlocks).toBe(5);
  });

  it('survives a cohort with no headcount', () => {
    // headcount is nullable in the dataset; ranking must not become NaN and swallow the order.
    const s = summarise(model([day({ headcount: null, idleBlocks: 2 })]));
    expect(s.cohorts[0].studentIdleBlocks).toBe(0);
    expect(Number.isNaN(s.cohorts[0].studentIdleBlocks)).toBe(false);
  });

  it('reports zero cleanly for an empty plan', () => {
    const s = summarise(model([]));
    expect(s.days).toBe(0);
    expect(s.longestDayBlocks).toBe(0);
    expect(s.cohorts).toEqual([]);
  });
});
