/**
 * Plan quality — is this timetable good to study under, not merely legal?
 *
 * REQUIREMENTS.md §5.1 lists eight planning rules. The solver enforces the hard ones and the app
 * could already show occupancy, teaching load and conflicts — but nothing answered §5.1's last two,
 * "Vermeidung ungünstiger Zeitfenster" and "Verteilung über den Tag hinweg", which is what §3 asks
 * the planner's interface to let them check.
 *
 * ⚠️ THE UNIT IS THE WHOLE-COHORT LECTURE DAY, and that limit is deliberate. `cohort_group` records
 * group SIZES, not membership, so no student entity exists and a per-student day cannot be derived.
 * An earlier attempt invented one by assuming group 1 of every course belongs to the same person; it
 * produced 178 impossible days and 147 fake "impossible transfers" in a plan that is genuinely
 * conflict-free. Whole-cohort lectures are attended by everyone in the cohort, so their shape is a
 * fact about all of them — a smaller claim that is actually true.
 */

export interface CohortDay {
  cohortId: string;
  programme: string | null;
  facultyId: string;
  semester: number;
  headcount: number | null;
  day: string;
  dayIndex: number;
  sessions: number;
  firstBlock: number;
  lastBlock: number;
  spanBlocks: number;
  /** Blocks inside the day with nothing in them — the Hohlstunden a student waits through. */
  idleBlocks: number;
  campusChanges: number;
  /** Transfers where the walk is longer than the break. Should be zero; the solver forbids them. */
  tightTransfers: number;
  worstShortfallMin: number;
}

export interface UnpopularSession {
  sessionId: string;
  cohortId: string;
  slotId: string;
  day: string;
  block: number;
  startTime: string;
  desirability: number;
}

export interface PlanQualityModel {
  aoi: string;
  site: string;
  provenance: 'derived';
  sourceProvenance: string;
  syntheticWarning: string;
  blocksPerDay: number;
  unpopularThreshold: number;
  groupCheck: { combinations: number; collisions: number };
  /** False here. The UI says so rather than implying a completeness the data does not have. */
  studentGroupMappingModelled: boolean;
  cohortDays: CohortDay[];
  unpopularSessions: UnpopularSession[];
}

export interface CohortQuality {
  cohortId: string;
  programme: string | null;
  facultyId: string;
  semester: number;
  headcount: number | null;
  days: number;
  idleBlocks: number;
  daysWithGap: number;
  longestDayBlocks: number;
  campusChanges: number;
  tightTransfers: number;
  unpopularSessions: number;
  /** Students × idle blocks. Ranks by people kept waiting, not by cohorts affected. */
  studentIdleBlocks: number;
}

export interface PlanQualitySummary {
  days: number;
  daysWithGap: number;
  idleBlocks: number;
  longestDayBlocks: number;
  campusChanges: number;
  tightTransfers: number;
  unpopularSessions: number;
  /** Worst first — a queue of things to fix, not a directory. */
  cohorts: CohortQuality[];
}

export function summarise(model: PlanQualityModel): PlanQualitySummary {
  const unpopularByCohort = new Map<string, number>();
  for (const session of model.unpopularSessions) {
    unpopularByCohort.set(session.cohortId, (unpopularByCohort.get(session.cohortId) ?? 0) + 1);
  }

  const grouped = new Map<string, CohortDay[]>();
  for (const day of model.cohortDays) {
    const list = grouped.get(day.cohortId) ?? [];
    list.push(day);
    grouped.set(day.cohortId, list);
  }

  const cohorts: CohortQuality[] = [...grouped.entries()].map(([cohortId, days]) => {
    const idleBlocks = days.reduce((sum, d) => sum + d.idleBlocks, 0);
    const head = days[0];
    return {
      cohortId,
      programme: head.programme,
      facultyId: head.facultyId,
      semester: head.semester,
      headcount: head.headcount,
      days: days.length,
      idleBlocks,
      daysWithGap: days.filter((d) => d.idleBlocks > 0).length,
      longestDayBlocks: Math.max(...days.map((d) => d.spanBlocks)),
      campusChanges: days.reduce((sum, d) => sum + d.campusChanges, 0),
      tightTransfers: days.reduce((sum, d) => sum + d.tightTransfers, 0),
      unpopularSessions: unpopularByCohort.get(cohortId) ?? 0,
      // A gap in a 222-student lecture cohort wastes far more time than one in a group of 20.
      studentIdleBlocks: idleBlocks * (head.headcount ?? 0),
    };
  });

  cohorts.sort(
    (a, b) =>
      b.tightTransfers - a.tightTransfers ||
      b.studentIdleBlocks - a.studentIdleBlocks ||
      b.idleBlocks - a.idleBlocks ||
      a.cohortId.localeCompare(b.cohortId)
  );

  return {
    days: model.cohortDays.length,
    daysWithGap: model.cohortDays.filter((d) => d.idleBlocks > 0).length,
    idleBlocks: model.cohortDays.reduce((sum, d) => sum + d.idleBlocks, 0),
    longestDayBlocks: Math.max(0, ...model.cohortDays.map((d) => d.spanBlocks)),
    campusChanges: model.cohortDays.reduce((sum, d) => sum + d.campusChanges, 0),
    tightTransfers: model.cohortDays.reduce((sum, d) => sum + d.tightTransfers, 0),
    unpopularSessions: model.unpopularSessions.length,
    cohorts,
  };
}

export async function loadPlanQuality(
  aoiId: string,
  base = '/terrain'
): Promise<PlanQualityModel | null> {
  const response = await fetch(`${base}/${aoiId}/plan-quality.json`);
  if (!response.ok) return null;
  const model: PlanQualityModel = await response.json();
  if (model.provenance !== 'derived') {
    throw new Error('plan-quality.json is missing its provenance stamp');
  }
  return model;
}
