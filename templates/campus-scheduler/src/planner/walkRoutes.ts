/**
 * Walking routes between teaching buildings — built by `tools/data/build_walk_routes.py`.
 *
 * ⚠️ THE DATASET'S OWN TRAVEL MATRIX IS STRAIGHT-LINE, and says so: `provenance.json` records
 * "straight-line distance; walk at 1.35 m/s within a campus". That was honest as a placeholder and
 * wrong as an answer — nobody walks through a building or across a railway line, and the cases
 * timetabling cares about are exactly the ones where the direct line is not available. These routes
 * are shortest paths on the OpenStreetMap pedestrian network instead, and they come with the
 * geometry so the claim can be looked at rather than taken on trust.
 *
 * The measured detour over the straight line is ~1.11x at OTH and ~1.15x at LMU, and up to 1.4x for
 * the cross-campus walk — which is to say the old matrix was optimistic by minutes on exactly the
 * transfers that decide whether a plan is workable.
 */

export interface WalkRoute {
  /** Metres, measured along the path network, including the walk from each centroid to a door. */
  distanceM: number;
  /** How much of the distance is the approach across the forecourt at either end. */
  approachM: number;
  minutes: number;
  sameCampus: boolean;
  /**
   * Minutes by bus, on cross-campus routes only.
   *
   * ⚠️ THE DATASET'S OWN ASSUMPTION, NOT A SERVICE TIMETABLE. It is carried here because between
   * campuses the walk is not the transfer: Galgenberg to Prüfening is 3.5 km and 44 minutes on
   * foot, and judging the plan by that would call 163 of its transfers impossible when the plan
   * has assumed a bus since the day it was generated and says so in its provenance.
   */
  transitMin?: number;
  /** Indices into the shared coordinate array. */
  points: number[];
}

export interface WalkRoutes {
  aoi: string;
  provenance: 'derived';
  walkSpeedMs: number;
  stepsPenalty: number;
  /** Flat [lon, lat, lon, lat, …]. */
  coordinates: number[];
  access: Record<string, { approachM: number; doors: number }>;
  /** Which campus each routed building sits on. */
  campuses?: Record<string, string>;
  /**
   * One stand-in building per campus, for a room that is known to be on a campus but not in a
   * building.
   *
   * ⚠️ OPTIONAL BECAUSE OLDER ASSETS DO NOT CARRY IT, and its absence must degrade to the old
   * behaviour (the session is skipped) rather than to a guess.
   */
  campusAnchors?: Record<string, string>;
  unreachableBuildings: string[];
  routes: Record<string, WalkRoute>;
}

/**
 * The verdict on a gap between two sessions.
 *
 * ⚠️ `unknown` is a real answer and is NOT the same as `fine`. Two of the three universities' worth
 * of buildings here have no route (an office block nobody teaches in, a site outside the AOI), and
 * reporting those as comfortable would be the same failure as the site guard's: treating "no data"
 * as "no problem".
 */
export type TransferVerdict = 'same-building' | 'comfortable' | 'tight' | 'impossible' | 'unknown';

/** How the person actually crosses the gap. */
export type TransferMode = 'none' | 'walk' | 'transit';

/**
 * How exactly the two ends are known.
 *
 * `campus` means at least one room resolved only as far as its site — OTH's export numbers the
 * whole Prüfeninger Straße complex `P …` and no building outline carries that letter. The journey
 * between the two SITES is a real answer at that precision; presenting it as a door-to-door figure
 * would not be, so the difference is carried in the data rather than left to the caller to know.
 */
export type TransferPrecision = 'building' | 'campus';

export interface Transfer {
  verdict: TransferVerdict;
  route: WalkRoute | null;
  /** Minutes between the end of one session and the start of the next. */
  breakMin: number;
  /** Minutes the journey needs, by whichever mode is quicker. */
  travelMin: number;
  /** What the walk alone would cost, whether or not anybody would do it. */
  walkMin: number;
  mode: TransferMode;
  /** Positive means minutes to spare, negative means minutes short. */
  spareMin: number;
  precision: TransferPrecision;
}

/** Routes are stored once per unordered pair; the key is the two ids in sort order. */
export function routeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function findRoute(data: WalkRoutes | null, from: string, to: string): WalkRoute | null {
  if (!data || from === to) return null;
  return data.routes[routeKey(from, to)] ?? null;
}

/** The [lon, lat] pairs of a route, in the order the walk is made. */
export function routeLine(
  data: WalkRoutes,
  from: string,
  to: string
): [number, number][] {
  const route = findRoute(data, from, to);
  if (!route) return [];
  const line = route.points.map(
    (index) => [data.coordinates[index * 2], data.coordinates[index * 2 + 1]] as [number, number]
  );
  // ⚠️ Stored once per unordered pair, so half the time the stored line runs the wrong way. The
  // drawn dash carries the direction of travel, so a reversed line would animate from the lecture
  // you are walking TO — a small thing that reads as a bug precisely because the rest is right.
  return routeKey(from, to) === `${from}|${to}` ? line : [...line].reverse();
}

/**
 * Can this person get from one session to the next?
 *
 * `tightMin` is the margin that counts as comfortable rather than a sprint: a walk that uses the
 * entire break leaves no room to pack up, answer a question at the lectern, or find the room.
 */
export function transfer(
  data: WalkRoutes | null,
  fromBuilding: string,
  toBuilding: string,
  breakMin: number,
  tightMin = 5
): Transfer {
  if (fromBuilding === toBuilding) {
    return {
      verdict: 'same-building',
      route: null,
      breakMin,
      travelMin: 0,
      walkMin: 0,
      mode: 'none',
      spareMin: breakMin,
      precision: 'building',
    };
  }

  const route = findRoute(data, fromBuilding, toBuilding);
  if (!route) {
    return {
      verdict: 'unknown',
      route: null,
      breakMin,
      travelMin: 0,
      walkMin: 0,
      mode: 'none',
      spareMin: breakMin,
      precision: 'building',
    };
  }

  // ⚠️ THE QUICKER MODE DECIDES, because that is the one the person takes. Between campuses that
  // is the bus; within one it is always the walk, and no transit time is offered.
  const useTransit = route.transitMin !== undefined && route.transitMin < route.minutes;
  const travelMin = useTransit ? (route.transitMin as number) : route.minutes;
  const spareMin = breakMin - travelMin;
  const verdict: TransferVerdict =
    spareMin < 0 ? 'impossible' : spareMin < tightMin ? 'tight' : 'comfortable';

  return {
    verdict,
    route,
    breakMin,
    travelMin,
    walkMin: route.minutes,
    mode: useTransit ? 'transit' : 'walk',
    spareMin,
    precision: 'building',
  };
}

/**
 * Which building to route from, when the room only resolved as far as its campus.
 *
 * ⚠️ A CAMPUS IS NOT A BUILDING, AND THE STAND-IN IS NEVER SILENT. Returning the anchor lets the
 * cross-town transfer be measured at all; returning `precision: 'campus'` with it is what stops
 * that measurement being read as a door-to-door walk. Both halves are the point — the earlier
 * behaviour (drop the session) turned a 15-minute bus ride the plan depends on into no row at all,
 * and an unlabelled anchor would turn it into a claim about a building nobody named.
 */
export function resolveEndpoint(
  data: WalkRoutes | null,
  buildingId: string | null | undefined,
  campusId: string | null | undefined
): { id: string; precision: TransferPrecision } | null {
  if (buildingId) return { id: buildingId, precision: 'building' };
  if (!data || !campusId) return null;
  const anchor = data.campusAnchors?.[campusId];
  return anchor ? { id: anchor, precision: 'campus' } : null;
}

export async function loadWalkRoutes(
  aoiId: string,
  base = '/terrain'
): Promise<WalkRoutes | null> {
  const response = await fetch(`${base}/${aoiId}/walk-routes.json`);
  // A site without a pedestrian network build is a fact, not an error: the panel says the walk is
  // unknown rather than inventing one.
  if (!response.ok) return null;
  const data: WalkRoutes = await response.json();
  if (data.provenance !== 'derived') {
    throw new Error('walk-routes.json is missing its provenance stamp');
  }
  return data;
}

// ── The day as the person actually walks it ──────────────────────────────────────────────────

/** Just enough of a calendar entry to work out where somebody has to be, and when. */
export interface PlacedSession {
  sessionId: string;
  slotId: string;
  course: string | null;
  roomId: string | null;
  buildingId: string | null;
  /**
   * The site the room is on, where that is known and the building is not.
   *
   * OTH's own export gives us this for every Prüfeninger-Straße booking and a building for none of
   * them, which is the difference between a cross-town transfer being visible and being absent.
   */
  campusId?: string | null;
}

export interface TimedSlot {
  slotId: string;
  day: string;
  dayIndex: number;
  block: number;
  startTime: string;
  endTime: string;
}

export interface Walk extends Transfer {
  day: string;
  dayIndex: number;
  from: PlacedSession;
  to: PlacedSession;
  fromBuilding: string;
  toBuilding: string;
  /** "11:30" — when they have to leave. */
  leaveAt: string;
  arriveBy: string;
}

function minutesOfDay(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/**
 * Every walk one person makes across their teaching week.
 *
 * ⚠️ CONSECUTIVE IN TIME, NOT IN BLOCKS. Chaining only adjacent blocks would miss the walk that
 * matters most — the one across a free block, where the break looks generous until you notice it
 * is a cross-campus trip. The gap is measured from the real end and start times, so a two-block
 * hole is simply a longer break.
 *
 * ⚠️ A SESSION IS SKIPPED ONLY WHEN IT HAS NEITHER A BUILDING NOR A CAMPUS. A missing place means
 * the room was never resolved, and inventing continuity there would turn a data gap into a
 * confident "no walk needed". A room resolved to its campus is a different case and is answered at
 * that precision — see `resolveEndpoint`.
 */
export function weekWalks(
  data: WalkRoutes | null,
  entries: PlacedSession[],
  slots: TimedSlot[],
  tightMin = 5
): Walk[] {
  const byId = new Map(slots.map((slot) => [slot.slotId, slot]));
  const byDay = new Map<number, { session: PlacedSession; slot: TimedSlot }[]>();

  for (const session of entries) {
    const slot = byId.get(session.slotId);
    if (!slot || !(session.buildingId || session.campusId)) continue;
    const list = byDay.get(slot.dayIndex) ?? [];
    list.push({ session, slot });
    byDay.set(slot.dayIndex, list);
  }

  const walks: Walk[] = [];
  for (const [dayIndex, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.slot.block - b.slot.block);
    for (let i = 0; i < list.length - 1; i += 1) {
      const here = list[i];
      const next = list[i + 1];
      const from = resolveEndpoint(data, here.session.buildingId, here.session.campusId);
      const to = resolveEndpoint(data, next.session.buildingId, next.session.campusId);
      if (!from || !to) continue;
      const fromBuilding = from.id;
      const toBuilding = to.id;
      // Two rooms that both resolved only to the same campus say nothing about a walk between
      // them, and the anchor would answer "same building" — which is a claim, not an absence.
      if (fromBuilding === toBuilding) continue;
      const precision: TransferPrecision =
        from.precision === 'campus' || to.precision === 'campus' ? 'campus' : 'building';

      const breakMin = minutesOfDay(next.slot.startTime) - minutesOfDay(here.slot.endTime);
      // ⚠️ TWO SESSIONS THAT OVERLAP ARE A CLASH, NOT A WALK. OTH's own export is a weekly grid
      // with no week pattern, so one lecturer legitimately appears twice in the same block; the
      // repo already decided those are UNDECIDABLE and stay off the screen. Judged as a transfer
      // they come out as "90 minutes short — cannot be made", which is a fabricated defect of
      // exactly the kind this project has invented twice before. Overlaps belong to the conflict
      // view, which knows how to say "undecidable"; this list only answers "can they get there".
      if (breakMin < 0) continue;
      walks.push({
        ...transfer(data, fromBuilding, toBuilding, breakMin, tightMin),
        precision,
        day: here.slot.day,
        dayIndex,
        from: here.session,
        to: next.session,
        fromBuilding,
        toBuilding,
        leaveAt: here.slot.endTime,
        arriveBy: next.slot.startTime,
      });
    }
  }
  return walks;
}
