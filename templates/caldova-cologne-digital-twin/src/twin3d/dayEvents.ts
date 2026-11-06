/**
 * The moments of the operating day worth jumping to.
 *
 * Modelled on Flut-Insights' story beats, and for the same reason: a 24-hour timeline played at
 * real time is 24 hours long, so without named moments the only way to find the interesting part
 * is to drag the slider and hope. The beats there are derived from the flood model rather than
 * written by hand, and these are derived from the operations model for the same reason — a
 * hand-written list drifts away from the data the moment the generator's seed changes, and it
 * drifts SILENTLY, because a marker at the wrong minute still looks like a marker.
 *
 * ⚠️ TWO KINDS, AND NEITHER OF THEM IS "SOURCED". Flut-Insights can label its peak `sourced`
 * because a gauge recorded it. Nothing here is sourced: the whole operating day is a model.
 * `planned` means the moment comes from the declared shift pattern and tour waves in the AOI
 * config; `derived` means it was computed by walking the modelled day. Borrowing the flood app's
 * `sourced` badge would have implied the operator published these times, which they did not.
 */

/** Quarter-hours in a day. */
const SLOTS = 96;

export type DayEventKind = 'planned' | 'derived';

export interface DayEvent {
  /** Matches the i18n key `dc.events.<id>`. */
  id: string;
  /** Fractional quarter-hour of the day. */
  slot: number;
  kind: DayEventKind;
  /** Tours on the road at that moment. */
  active: number;
  /** Vans standing at a pharmacy at that moment. */
  atStop: number;
  /** Vans standing at a pharmacy INSIDE the photoreal core at that moment. */
  atCoreStop: number;
}

/** What the derivation needs to know about one tour. Geometry stays in the layer that owns it. */
export interface TourTiming {
  departSlot: number;
  returnSlot: number;
  /**
   * Where in the round this tour is standing still, as fractions of the whole round.
   * Half-open [start, end) pairs, in order.
   */
  dwellSpans: [number, number][];
  /**
   * The subset of those stops that lie inside the photoreal core.
   *
   * ⚠️ THE ONLY PLACE A RIDE-ALONG HAS A CITY AROUND IT. The LoD2 buildings and the 20 cm
   * orthophoto cover 2 km; the tours run to 22 km. Riding with a van picked at random puts the
   * camera on featureless shell terrain, which looks like a broken render rather than like the
   * edge of the modelled area. Knowing WHEN a van is delivering inside the modelled city is what
   * lets the app offer that moment instead of leaving it to be stumbled on.
   */
  coreDwellSpans?: [number, number][];
}

/**
 * Where a tour is in its round at a fractional slot, or null when it is not out.
 * Duplicated deliberately from `tours.ts` rather than imported: this module is pure arithmetic and
 * importing the three.js layer to reach one function would make it untestable without a canvas.
 */
function progressAt(slot: number, departSlot: number, returnSlot: number): number | null {
  const span = (returnSlot - departSlot + SLOTS) % SLOTS;
  if (span === 0) return null;
  const since = (((slot - departSlot) % SLOTS) + SLOTS) % SLOTS;
  if (since > span) return null;
  return since / span;
}

function isStanding(progress: number, spans: [number, number][]): boolean {
  for (const [from, to] of spans) {
    if (progress >= from && progress < to) return true;
  }
  return false;
}

/** How many tours are out, and how many are standing at a pharmacy, at one moment. */
export function stateAt(
  slot: number,
  timings: TourTiming[]
): { active: number; atStop: number; atCoreStop: number } {
  let active = 0;
  let atStop = 0;
  let atCoreStop = 0;
  for (const tour of timings) {
    const p = progressAt(slot, tour.departSlot, tour.returnSlot);
    if (p === null) continue;
    active += 1;
    if (isStanding(p, tour.dwellSpans)) atStop += 1;
    if (tour.coreDwellSpans && isStanding(p, tour.coreDwellSpans)) atCoreStop += 1;
  }
  return { active, atStop, atCoreStop };
}

/**
 * The named moments of the day, in time order.
 *
 * `stepSlots` is the sampling resolution. Finer than a quarter-hour on purpose: departures and
 * the first delivery happen INSIDE a slot, and sampling on the slot grid would round them to the
 * nearest fifteen minutes and put the marker in the wrong place.
 */
export function buildDayEvents(
  timings: TourTiming[],
  options: {
    /** Declared departure times from the AOI config, as fractional slots. */
    plannedWaves?: number[];
    /** Declared start of night picking, as a fractional slot. */
    nightPickSlot?: number | null;
    stepSlots?: number;
    /** Markers closer together than this are collapsed, so the bar stays readable. */
    minGapSlots?: number;
  } = {}
): DayEvent[] {
  const { plannedWaves = [], nightPickSlot = null, stepSlots = 0.1, minGapSlots = 1 } = options;
  if (timings.length === 0) return [];

  const samples: { slot: number; active: number; atStop: number; atCoreStop: number }[] = [];
  for (let slot = 0; slot < SLOTS; slot += stepSlots) {
    samples.push({ slot, ...stateAt(slot, timings) });
  }

  const events: DayEvent[] = [];
  const push = (
    id: string,
    kind: DayEventKind,
    sample: { slot: number; active: number; atStop: number; atCoreStop: number } | undefined
  ) => {
    if (!sample) return;
    events.push({
      id,
      kind,
      slot: sample.slot,
      active: sample.active,
      atStop: sample.atStop,
      atCoreStop: sample.atCoreStop,
    });
  };
  const at = (slot: number) => {
    const wrapped = ((slot % SLOTS) + SLOTS) % SLOTS;
    const state = stateAt(wrapped, timings);
    return { slot: wrapped, ...state };
  };

  // ── planned: what the operation says it will do ──────────────────────────────────────────────
  if (nightPickSlot !== null) push('nightPick', 'planned', at(nightPickSlot));
  plannedWaves.forEach((slot, i) => push(`wave${i + 1}`, 'planned', at(slot)));

  // ── derived: what the modelled day actually does ─────────────────────────────────────────────
  push(
    'firstDrop',
    'derived',
    samples.find((s) => s.atStop > 0)
  );
  push(
    'peakOnRoad',
    'derived',
    samples.reduce((best, s) => (s.active > best.active ? s : best), samples[0])
  );
  push(
    'peakStops',
    'derived',
    samples.reduce((best, s) => (s.atStop > best.atStop ? s : best), samples[0])
  );
  // ⚠️ "THE YARD IS EMPTY", NOT "THE LAST VAN IS BACK". The first version took the last sample of
  // the array with anything on the road, which on a CYCLIC day is meaningless: the evening wave
  // departs at 16:45 and returns after midnight, so the array's last active sample is 23:59 and
  // the marker read "last van back" at midnight while eleven vans were still out. A moment when
  // nothing at all is on the road is unambiguous however the day wraps.
  const quietest = samples.find((s) => s.active === 0);
  push('allIn', 'derived', quietest);

  events.sort((a, b) => a.slot - b.slot);

  // ⚠️ COLLAPSE COLLISIONS, KEEPING THE PLANNED ONE. A derived peak lands within minutes of a
  // declared departure often enough that the bar would show two markers a pixel apart, and the
  // one a viewer wants to click is the one with a name they recognise.
  const spaced: DayEvent[] = [];
  for (const event of events) {
    const previous = spaced[spaced.length - 1];
    if (previous && event.slot - previous.slot < minGapSlots) {
      if (previous.kind === 'derived' && event.kind === 'planned') spaced[spaced.length - 1] = event;
      continue;
    }
    spaced.push(event);
  }
  return spaced;
}

/** The event a given moment belongs to: the latest one at or before it. */
export function eventAt(slot: number, events: DayEvent[]): DayEvent | null {
  let found: DayEvent | null = null;
  for (const event of events) {
    if (event.slot <= slot + 0.001) found = event;
  }
  return found;
}

/**
 * The first moment a van is standing at a pharmacy INSIDE the photoreal core.
 *
 * ⚠️ DELIBERATELY NOT A MARKER. The three pharmacies nearest the warehouse are the FIRST stops on
 * their tours — the routes are chained nearest-neighbour outward — so this lands minutes after the
 * first wave departs. As a marker it would sit a pixel from "first wave departs" and be
 * unclickable, and moving it somewhere clickable would put a timeline marker at a time the thing
 * does not happen. It is an ACTION instead: the button that rides along jumps here.
 */
export function firstCoreStopSlot(timings: TourTiming[], stepSlots = 0.05): number | null {
  for (let slot = 0; slot < SLOTS; slot += stepSlots) {
    if (stateAt(slot, timings).atCoreStop > 0) return slot;
  }
  return null;
}
