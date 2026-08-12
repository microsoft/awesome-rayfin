import { describe, expect, it } from 'vitest';

import {
  findRoute,
  routeKey,
  routeLine,
  transfer,
  weekWalks,
  type TimedSlot,
  type WalkRoutes,
} from '../walkRoutes';

/**
 * The route data is built by a Python tool and consumed here; these tests pin the SEAM between
 * them — key ordering, direction of travel, and what happens when there is no route at all. Each
 * one is a mistake that would look like a rendering glitch rather than a data bug.
 */

const data: WalkRoutes = {
  aoi: 'oth-regensburg',
  provenance: 'derived',
  walkSpeedMs: 1.35,
  stepsPenalty: 3,
  //        0            1            2
  coordinates: [12.0, 49.0, 12.1, 49.1, 12.2, 49.2],
  access: { K: { approachM: 7.2, doors: 9 }, S: { approachM: 19.2, doors: 5 } },
  campuses: { K: 'seyboth', S: 'seyboth', A: 'seyboth', d: 'pruefening' },
  campusAnchors: { seyboth: 'A', pruefening: 'd' },
  unreachableBuildings: [],
  routes: {
    'K|S': { distanceM: 300, approachM: 26, minutes: 4, sameCampus: true, points: [0, 1, 2] },
    'K|d': {
      distanceM: 3377,
      approachM: 60,
      minutes: 42,
      sameCampus: false,
      transitMin: 15,
      points: [0, 1, 2],
    },
    'A|d': {
      distanceM: 3496,
      approachM: 60,
      minutes: 43,
      sameCampus: false,
      transitMin: 15,
      points: [0, 2],
    },
    // A cross-campus pair with no bus assumption at all, to prove the walk is used when it is the
    // only thing on offer.
    'A|z': { distanceM: 3000, approachM: 40, minutes: 38, sameCampus: false, points: [0, 2] },
  },
};

describe('routeKey', () => {
  it('is the same whichever way round the pair is given', () => {
    expect(routeKey('K', 'S')).toBe(routeKey('S', 'K'));
  });

  it('orders by code, so it matches what the builder wrote', () => {
    // The builder emits `from < to` with Python's string ordering, which puts every upper-case
    // letter before every lower-case one. A key built the other way silently finds nothing.
    expect(routeKey('a', 'K')).toBe('K|a');
  });
});

describe('findRoute', () => {
  it('finds the route in either direction', () => {
    expect(findRoute(data, 'K', 'S')?.distanceM).toBe(300);
    expect(findRoute(data, 'S', 'K')?.distanceM).toBe(300);
  });

  it('has nothing to say about a building with no route', () => {
    expect(findRoute(data, 'K', 'ZZ')).toBeNull();
    expect(findRoute(null, 'K', 'S')).toBeNull();
  });

  it('does not route a building to itself', () => {
    expect(findRoute(data, 'K', 'K')).toBeNull();
  });
});

describe('routeLine', () => {
  it('reads coordinates out of the shared array in order', () => {
    expect(routeLine(data, 'K', 'S')).toEqual([
      [12.0, 49.0],
      [12.1, 49.1],
      [12.2, 49.2],
    ]);
  });

  it('REVERSES the line when the walk runs against the stored order', () => {
    // Stored once per unordered pair. Without the flip the drawn dash travels from the destination,
    // which is exactly the kind of detail that reads as a rendering bug.
    expect(routeLine(data, 'S', 'K')).toEqual([
      [12.2, 49.2],
      [12.1, 49.1],
      [12.0, 49.0],
    ]);
  });

  it('gives an empty line rather than a broken one when there is no route', () => {
    expect(routeLine(data, 'K', 'ZZ')).toEqual([]);
  });
});

describe('transfer', () => {
  it('needs no walk within one building', () => {
    const result = transfer(data, 'K', 'K', 15);
    expect(result.verdict).toBe('same-building');
    expect(result.walkMin).toBe(0);
  });

  it('calls a comfortable gap comfortable', () => {
    const result = transfer(data, 'K', 'S', 15);
    expect(result.verdict).toBe('comfortable');
    expect(result.spareMin).toBe(11);
  });

  it('calls it tight when the walk eats nearly all of the break', () => {
    expect(transfer(data, 'K', 'S', 8).verdict).toBe('tight');
  });

  it('calls it impossible when the walk is longer than the break', () => {
    const result = transfer(data, 'K', 'S', 3);
    expect(result.verdict).toBe('impossible');
    expect(result.spareMin).toBe(-1);
  });

  it('says UNKNOWN rather than fine when there is no route', () => {
    // ⚠️ The same failure as the site guard: absence of evidence read as evidence of absence. A
    // missing route must never render as a comfortable transfer.
    const result = transfer(data, 'K', 'ZZ', 15);
    expect(result.verdict).toBe('unknown');
    expect(result.verdict).not.toBe('comfortable');
  });

  it('treats the cross-campus walk as the long trip it is', () => {
    expect(transfer(data, 'A', 'z', 15).verdict).toBe('impossible');
    expect(transfer(data, 'A', 'z', 15).route?.sameCampus).toBe(false);
    expect(transfer(data, 'A', 'z', 15).mode).toBe('walk');
  });

  it('crosses campus BY BUS when the plan assumes one, rather than on foot', () => {
    /*
     * ⚠️ THIS IS THE FABRICATED-DEFECT TEST. The routed walk between the two OTH campuses is 43
     * minutes and every cross-campus break in the plan is 15, so judging the transfer by the walk
     * declares 163 of them impossible — in a plan that has assumed a bus since it was generated
     * and records that assumption in its own provenance. The quicker mode decides.
     */
    const result = transfer(data, 'A', 'd', 15);
    expect(result.mode).toBe('transit');
    expect(result.travelMin).toBe(15);
    expect(result.verdict).not.toBe('impossible');
    // The walk is still reported, because "45 minutes on foot" is the reason the bus matters.
    expect(result.walkMin).toBe(43);
  });

  it('still calls a bus transfer tight when it uses the whole break', () => {
    expect(transfer(data, 'A', 'd', 15).verdict).toBe('tight');
    expect(transfer(data, 'A', 'd', 30).verdict).toBe('comfortable');
    expect(transfer(data, 'A', 'd', 10).verdict).toBe('impossible');
  });

  it('walks within a campus even though a bus exists elsewhere', () => {
    expect(transfer(data, 'K', 'S', 15).mode).toBe('walk');
  });
});

// ── The week as one person walks it ──────────────────────────────────────────────────────────

const slots: TimedSlot[] = [
  { slotId: 'Mo-1', day: 'Mo', dayIndex: 0, block: 1, startTime: '08:00', endTime: '09:30' },
  { slotId: 'Mo-2', day: 'Mo', dayIndex: 0, block: 2, startTime: '09:45', endTime: '11:15' },
  { slotId: 'Mo-3', day: 'Mo', dayIndex: 0, block: 3, startTime: '11:30', endTime: '13:00' },
  { slotId: 'Di-1', day: 'Di', dayIndex: 1, block: 1, startTime: '08:00', endTime: '09:30' },
];

const session = (
  id: string,
  slotId: string,
  buildingId: string | null,
  campusId: string | null = null
) => ({
  sessionId: id,
  slotId,
  course: id,
  roomId: `${buildingId ?? campusId} 001`,
  buildingId,
  campusId,
});

describe('weekWalks', () => {
  it('finds the walk between two rooms in different buildings', () => {
    const walks = weekWalks(data, [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', 'S')], slots);
    expect(walks).toHaveLength(1);
    expect(walks[0].fromBuilding).toBe('K');
    expect(walks[0].leaveAt).toBe('09:30');
    expect(walks[0].arriveBy).toBe('09:45');
    expect(walks[0].breakMin).toBe(15);
    expect(walks[0].verdict).toBe('comfortable');
  });

  it('reports no walk when the next session is in the same building', () => {
    expect(weekWalks(data, [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', 'K')], slots))
      .toHaveLength(0);
  });

  it('MEASURES ACROSS A FREE BLOCK rather than only between adjacent ones', () => {
    // The walk that matters most is often the one with a gap in front of it. Chaining only
    // neighbouring blocks would drop this pair entirely.
    const walks = weekWalks(data, [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-3', 'S')], slots);
    expect(walks).toHaveLength(1);
    expect(walks[0].breakMin).toBe(120);
    expect(walks[0].verdict).toBe('comfortable');
  });

  it('never chains across days', () => {
    // Monday's last room and Tuesday's first are not a walk, however different the buildings.
    expect(weekWalks(data, [session('s1', 'Mo-3', 'K'), session('s2', 'Di-1', 'S')], slots))
      .toHaveLength(0);
  });

  it('skips a session whose room was never resolved instead of assuming continuity', () => {
    // ⚠️ A null building is missing data. Carrying the previous building forward would turn that
    // gap into a confident "no walk needed".
    const walks = weekWalks(
      data,
      [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', null), session('s3', 'Mo-3', 'S')],
      slots
    );
    expect(walks).toHaveLength(1);
    expect(walks[0].from.sessionId).toBe('s1');
    expect(walks[0].to.sessionId).toBe('s3');
  });

  it('orders the day by block, not by the order the entries arrived', () => {
    const walks = weekWalks(data, [session('s2', 'Mo-2', 'S'), session('s1', 'Mo-1', 'K')], slots);
    expect(walks[0].from.sessionId).toBe('s1');
  });

  it('still reports the walk when the route is unknown', () => {
    // Withholding it would hide the transfer entirely; the verdict says the walk is unknown.
    const walks = weekWalks(data, [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', 'ZZ')], slots);
    expect(walks).toHaveLength(1);
    expect(walks[0].verdict).toBe('unknown');
  });
});

describe('weekWalks at campus level', () => {
  /**
   * ⚠️ THIS IS THE CUSTOMER'S OWN CASE. OTH's Untis export numbers every Prüfeninger-Straße room
   * `P …` and no OSM outline carries that letter, so 666 of their real sessions have a campus and
   * no building. Skipping them made the cross-town transfer — the one the whole product is about —
   * disappear from a real professor's week.
   */
  it('routes a session that resolved only to its campus, and says the answer is site level', () => {
    const walks = weekWalks(
      data,
      [session('s1', 'Mo-1', 'K', 'seyboth'), session('s2', 'Mo-2', null, 'pruefening')],
      slots
    );
    expect(walks).toHaveLength(1);
    expect(walks[0].precision).toBe('campus');
    expect(walks[0].toBuilding).toBe('d');
    // The bus is what the plan assumes between the sites, and it is what the break is judged by.
    expect(walks[0].mode).toBe('transit');
    expect(walks[0].travelMin).toBe(15);
    expect(walks[0].walkMin).toBe(42);
    // There is a line to draw, which is the difference between a claim and something checkable.
    expect(walks[0].route?.points.length).toBeGreaterThan(1);
  });

  it('MIRROR: a walk between two known buildings is still reported as building level', () => {
    // Without this, marking everything "site level" would pass the test above and quietly weaken
    // every honest row on the list.
    const walks = weekWalks(data, [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', 'S')], slots);
    expect(walks[0].precision).toBe('building');
  });

  it('says nothing about two rooms that both resolved only to the same campus', () => {
    // Both would land on the same stand-in, and answering "same building" there is a claim about
    // buildings nobody named.
    const walks = weekWalks(
      data,
      [session('s1', 'Mo-1', null, 'pruefening'), session('s2', 'Mo-2', null, 'pruefening')],
      slots
    );
    expect(walks).toHaveLength(0);
  });

  it('skips a campus it has no stand-in for rather than borrowing another one', () => {
    const walks = weekWalks(
      data,
      [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', null, 'universitaet')],
      slots
    );
    expect(walks).toHaveLength(0);
  });

  it('degrades to the old behaviour on an asset built before campus anchors existed', () => {
    const older: WalkRoutes = { ...data, campuses: undefined, campusAnchors: undefined };
    const walks = weekWalks(
      older,
      [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-2', null, 'pruefening')],
      slots
    );
    expect(walks).toHaveLength(0);
  });

  it('does not turn two overlapping sessions into a transfer nobody could make', () => {
    // ⚠️ OTH's weekly grid carries no week pattern, so one lecturer really does appear twice in
    // the same block. Read as a walk that is a 90-minute shortfall and a red "cannot be made" row
    // about a clash the conflict view has already declared undecidable.
    const walks = weekWalks(
      data,
      [session('s1', 'Mo-1', 'K'), session('s2', 'Mo-1', null, 'pruefening')],
      slots
    );
    expect(walks).toHaveLength(0);
  });
});
