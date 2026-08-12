/**
 * Teaching load per lecturer — the Einsatzplanung question, asked of this app's own plan.
 *
 * The scheduler decides which room and which hour. It never asks who ends up carrying the
 * teaching, and the answer turns out to be uneven enough to matter: in the OTH plan seven
 * lecturers are over their contractual Deputat, one at twice it, while three have no course at
 * all. Nothing here invents that — `tools/data/build_staffing.py` only joins `course.sws` to
 * `teacher.contractSws`, both of which the timetable generator already wrote.
 *
 * The arithmetic lives here rather than in the build script so it can be tested against
 * hand-worked cases instead of trusted because a script printed it.
 */

export type LoadStatus = 'over' | 'tight' | 'balanced' | 'light' | 'idle';

export interface StaffingTeacher {
  teacherId: string;
  name: string;
  facultyId: string;
  contractSws: number;
  plannedSws: number;
  courseCount: number;
}

export interface StaffingModel {
  aoi: string;
  site: string;
  provenance: 'derived';
  sourceProvenance: string;
  syntheticWarning: string;
  /**
   * Whether the dataset distinguishes professors from other teaching staff. It does not yet, so
   * the professorale Quote is withheld rather than reported as a meaningless 100%.
   */
  lecturerTypesModelled: boolean;
  faculties: { id: string; name: string }[];
  teachers: StaffingTeacher[];
}

export interface LecturerLoad extends StaffingTeacher {
  /** Planned over contracted, 1.0 being exactly the Deputat. */
  ratio: number;
  status: LoadStatus;
  /** SWS above contract; 0 when within it. Positive numbers are the ones that need a decision. */
  overSws: number;
}

export interface FacultyLoad {
  facultyId: string;
  name: string;
  lecturers: number;
  plannedSws: number;
  contractSws: number;
  ratio: number;
  over: number;
  idle: number;
}

export interface StaffingSummary {
  lecturers: LecturerLoad[];
  faculties: FacultyLoad[];
  plannedSws: number;
  contractSws: number;
  ratio: number;
  /** Over contract — the list a planner has to act on. */
  over: LecturerLoad[];
  /** Contracted to teach, holding nothing. Capacity the plan did not use. */
  idle: LecturerLoad[];
}

/**
 * Thresholds, stated once.
 *
 * `tight` exists because 100% is not a cliff: a lecturer at 95% of contract has no room for a
 * co-taught module or a stand-in, and a planner wants to see that coming rather than discover it
 * when the next course needs an owner.
 */
const TIGHT_FROM = 0.9;
const LIGHT_BELOW = 0.5;

export function statusOf(ratio: number, plannedSws: number): LoadStatus {
  if (plannedSws === 0) return 'idle';
  if (ratio > 1) return 'over';
  if (ratio >= TIGHT_FROM) return 'tight';
  if (ratio < LIGHT_BELOW) return 'light';
  return 'balanced';
}

export function summarise(model: StaffingModel): StaffingSummary {
  const lecturers: LecturerLoad[] = model.teachers.map((t) => {
    // A contract of zero would be a data fault rather than a full lecturer; treat it as unknown
    // rather than dividing by it and reporting Infinity as a staffing crisis.
    const ratio = t.contractSws > 0 ? t.plannedSws / t.contractSws : 0;
    return {
      ...t,
      ratio,
      status: statusOf(ratio, t.plannedSws),
      overSws: Math.max(0, t.plannedSws - t.contractSws),
    };
  });

  const names = new Map(model.faculties.map((f) => [f.id, f.name]));
  const grouped = new Map<string, LecturerLoad[]>();
  for (const lecturer of lecturers) {
    const list = grouped.get(lecturer.facultyId) ?? [];
    list.push(lecturer);
    grouped.set(lecturer.facultyId, list);
  }

  const faculties: FacultyLoad[] = [...grouped.entries()]
    .map(([facultyId, list]) => {
      const plannedSws = list.reduce((sum, l) => sum + l.plannedSws, 0);
      const contractSws = list.reduce((sum, l) => sum + l.contractSws, 0);
      return {
        facultyId,
        name: names.get(facultyId) ?? facultyId,
        lecturers: list.length,
        plannedSws,
        contractSws,
        ratio: contractSws > 0 ? plannedSws / contractSws : 0,
        over: list.filter((l) => l.status === 'over').length,
        idle: list.filter((l) => l.status === 'idle').length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const plannedSws = lecturers.reduce((sum, l) => sum + l.plannedSws, 0);
  const contractSws = lecturers.reduce((sum, l) => sum + l.contractSws, 0);

  return {
    lecturers,
    faculties,
    plannedSws,
    contractSws,
    ratio: contractSws > 0 ? plannedSws / contractSws : 0,
    // Worst first: this is a queue of decisions, not a directory.
    over: lecturers.filter((l) => l.status === 'over').sort((a, b) => b.ratio - a.ratio),
    idle: lecturers.filter((l) => l.status === 'idle').sort((a, b) => b.contractSws - a.contractSws),
  };
}

export async function loadStaffing(
  aoiId: string,
  base = '/terrain'
): Promise<StaffingModel | null> {
  const response = await fetch(`${base}/${aoiId}/staffing.json`);
  // Absent until the site's timetable has been generated, which is the normal state of a fresh
  // clone — the same contract the condition lens uses.
  if (!response.ok) return null;
  const model: StaffingModel = await response.json();
  if (model.provenance !== 'derived') {
    throw new Error('staffing.json is missing its provenance stamp');
  }
  return model;
}
