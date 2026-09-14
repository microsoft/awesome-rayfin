import { describe, expect, it } from 'vitest';

import { statusOf, summarise, type StaffingModel } from '../staffingData';

/**
 * The Deputat arithmetic, pinned against hand-worked cases.
 *
 * This is the half of the staffing lens that can be wrong quietly. The build script only joins two
 * columns; everything a planner would act on — who counts as over contract, how far over, what a
 * faculty totals — is computed here, and a lens that mis-ranks an overload is worse than no lens,
 * because someone will trust the order.
 */

function model(teachers: StaffingModel['teachers']): StaffingModel {
  return {
    aoi: 'test',
    site: 'test',
    provenance: 'derived',
    sourceProvenance: 'synthetic',
    syntheticWarning: '',
    lecturerTypesModelled: false,
    faculties: [
      { id: 'IM', name: 'Informatik und Mathematik' },
      { id: 'M', name: 'Maschinenbau' },
    ],
    teachers,
  };
}

const teacher = (over: Partial<StaffingModel['teachers'][number]>) => ({
  teacherId: 'IM-T001',
  name: 'Prof. Dr. A. Amsel',
  facultyId: 'IM',
  contractSws: 18,
  plannedSws: 9,
  courseCount: 3,
  ...over,
});

describe('statusOf', () => {
  it('separates the states a planner acts on', () => {
    expect(statusOf(0, 0)).toBe('idle');
    expect(statusOf(0.3, 6)).toBe('light');
    expect(statusOf(0.7, 12)).toBe('balanced');
    expect(statusOf(0.95, 17)).toBe('tight');
    expect(statusOf(1.2, 22)).toBe('over');
  });

  it('treats exactly the contract as tight, not over', () => {
    // Being AT the Deputat is not a violation; it is a full lecturer with nothing spare. Calling
    // it "over" would put compliant staff on a list of problems.
    expect(statusOf(1, 18)).toBe('tight');
  });

  it('calls no teaching idle even when the ratio looks fine', () => {
    // ratio 0 would otherwise read as "light" and hide unused contracted capacity.
    expect(statusOf(0, 0)).toBe('idle');
  });
});

describe('summarise', () => {
  it('computes load against contract', () => {
    const summary = summarise(model([teacher({ plannedSws: 36, contractSws: 18 })]));
    expect(summary.lecturers[0].ratio).toBe(2);
    expect(summary.lecturers[0].overSws).toBe(18);
    expect(summary.lecturers[0].status).toBe('over');
  });

  it('reports no overload for someone inside their contract', () => {
    const summary = summarise(model([teacher({ plannedSws: 9, contractSws: 18 })]));
    expect(summary.lecturers[0].overSws).toBe(0);
    expect(summary.over).toHaveLength(0);
  });

  it('ranks the overloaded worst-first, because it is a queue of decisions', () => {
    const summary = summarise(
      model([
        teacher({ teacherId: 'A', plannedSws: 20, contractSws: 18 }), // 1.11
        teacher({ teacherId: 'B', plannedSws: 16, contractSws: 9 }), // 1.78
        teacher({ teacherId: 'C', plannedSws: 36, contractSws: 18 }), // 2.00
      ])
    );
    expect(summary.over.map((l) => l.teacherId)).toEqual(['C', 'B', 'A']);
  });

  it('lists lecturers with no teaching, largest contract first', () => {
    const summary = summarise(
      model([
        teacher({ teacherId: 'small', plannedSws: 0, contractSws: 9, courseCount: 0 }),
        teacher({ teacherId: 'large', plannedSws: 0, contractSws: 20, courseCount: 0 }),
      ])
    );
    // Unused capacity is worth more when the contract is bigger.
    expect(summary.idle.map((l) => l.teacherId)).toEqual(['large', 'small']);
  });

  it('rolls up per faculty and counts the problems in each', () => {
    const summary = summarise(
      model([
        teacher({ teacherId: 'IM-1', facultyId: 'IM', plannedSws: 36, contractSws: 18 }),
        teacher({ teacherId: 'IM-2', facultyId: 'IM', plannedSws: 0, contractSws: 18 }),
        teacher({ teacherId: 'M-1', facultyId: 'M', plannedSws: 9, contractSws: 18 }),
      ])
    );
    const im = summary.faculties.find((f) => f.facultyId === 'IM')!;
    expect(im.name).toBe('Informatik und Mathematik');
    expect(im.plannedSws).toBe(36);
    expect(im.contractSws).toBe(36);
    expect(im.ratio).toBe(1);
    expect(im.over).toBe(1);
    expect(im.idle).toBe(1);
  });

  it('totals the whole site', () => {
    const summary = summarise(
      model([
        teacher({ teacherId: 'a', plannedSws: 10, contractSws: 20 }),
        teacher({ teacherId: 'b', plannedSws: 10, contractSws: 20 }),
      ])
    );
    expect(summary.plannedSws).toBe(20);
    expect(summary.contractSws).toBe(40);
    expect(summary.ratio).toBe(0.5);
  });

  it('does not divide by a zero contract', () => {
    // A contract of 0 is a data fault, not a lecturer with infinite overload. Reporting Infinity
    // would put them at the top of the action list forever.
    const summary = summarise(model([teacher({ plannedSws: 4, contractSws: 0 })]));
    expect(Number.isFinite(summary.lecturers[0].ratio)).toBe(true);
    expect(summary.lecturers[0].ratio).toBe(0);
  });

  it('names a faculty that the academic config does not list', () => {
    // Falls back to the id rather than rendering "undefined" at a customer.
    const summary = summarise(model([teacher({ facultyId: 'GHOST' })]));
    expect(summary.faculties[0].name).toBe('GHOST');
  });
});
