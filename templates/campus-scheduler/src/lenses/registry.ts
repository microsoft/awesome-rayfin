import type { ComponentType } from 'react';

import type { LensId } from '@/config/aoi';

/**
 * An analytical lens over the campus.
 *
 * The 3D scene is one shared object — terrain, buildings, and where they exist, rooms. A lens is
 * the *question being asked of it*: how full is this room, what condition is this building in,
 * where do people move. Lenses therefore colour existing geometry rather than owning any, which is
 * what makes "one asset, several conversations" true rather than a slogan.
 *
 * Two properties carry real weight:
 *
 * `requires` lets the shell refuse to offer a lens whose data does not exist on this site.
 * Tübingen has no indoor mapping, so `occupancy` is not merely empty there — it is not offered,
 * and the UI explains why. An empty panel reads as a bug; an absent one with a reason reads as
 * honesty (PLAN D6).
 *
 * `provenance` drives the synthetic badge. A lens built on invented figures says so permanently
 * and prominently, because a real university's name is on the screen (PLAN §0).
 */

export type LensDataRequirement = 'terrain' | 'buildings' | 'rooms' | 'bookings' | 'footpaths';

export interface LensStatus {
  /** False until the lens has data and a panel. Phase 0 ships all three unimplemented. */
  implemented: boolean;
  /** The plan phase that turns it on, for the placeholder text. */
  phase: number;
}

export interface Lens {
  id: LensId;
  /** i18n key for the lens name. */
  labelKey: string;
  /** i18n key for the one-line explanation shown under the name. */
  blurbKey: string;
  requires: LensDataRequirement[];
  /**
   * The strongest provenance claim any figure in this lens can make. `synthetic` here means the
   * whole lens is badged, even where individual numbers underneath are measured.
   */
  provenance: 'measured' | 'derived' | 'synthetic';
  /**
   * Whether opening this lens REPLACES the buildings' own colour rather than drawing over it.
   *
   * ⚠️ THIS EXISTS BECAUSE ONE SITE LANDED ON A SYNTHETIC HEAT MAP. Tübingen offers exactly one
   * lens, `condition`, so the "open the first available lens" default selected it on arrival and
   * `setBuildingConditionMix(0.92)` painted every building in the old town by an INVENTED
   * Sanierungsnote. Two things were wrong with that at once: the university looked markedly worse
   * than OTH and LMU, whose measured roof colour was visible, and the first thing a visitor saw of
   * a real named university was a number nobody has ever published. The badge in the side panel
   * was correct and nobody reads a badge before they read a city.
   *
   * A lens like this is worth having and is worth CHOOSING. It is not worth defaulting into.
   */
  repaintsBuildings?: boolean;
  /**
   * Whether this lens is a CONTROL that drives the 3D, rather than a TABLE about the plan.
   *
   * ⚠️ THE RULE WAS WRITTEN DOWN AND THEN IMPLEMENTED WITH THE WRONG PREDICATE. `TwinShell` says
   * it plainly — *controls that drive the 3D stay beside the 3D; tables go beside the week they
   * describe* — but the code asked `!hasPlanner` instead, which is a fact about the SITE and not
   * about the lens. It agreed with the rule only for as long as the two campus twins had no
   * timetable. The day Garching got one, its flow timeline moved into a drawer that covers the
   * bottom of the campus the timeline exists to scrub, and its five e2e tests failed pointing at
   * a panel that was no longer there.
   *
   * `occupancy` was already exempted by hand in `pickLens` for exactly this reason. This flag is
   * that exemption, generalised and named, so the next lens declares which kind it is instead of
   * inheriting whichever behaviour its site happens to imply.
   */
  steersTheTwin?: boolean;
  status: LensStatus;
  panel?: ComponentType;
}

/**
 * Every lens the app knows about.
 *
 * Registered centrally rather than discovered, for the same reason the AOIs are listed rather than
 * globbed: a lens appearing in the UI should be a deliberate act with a diff behind it.
 */
export const LENSES: Record<LensId, Lens> = {
  occupancy: {
    id: 'occupancy',
    labelKey: 'lens.occupancy.label',
    blurbKey: 'lens.occupancy.blurb',
    requires: ['terrain', 'buildings', 'rooms', 'bookings'],
    // Measured, and unusually so: the bookings are real TUMonline data. The seat counts layered on
    // top are synthetic, but they are badged individually rather than dragging the whole lens down.
    provenance: 'measured',
    // Picks the building and room the twin opens — a drawer over the campus hides what it steers.
    steersTheTwin: true,
    status: { implemented: true, phase: 3 },
  },
  condition: {
    id: 'condition',
    labelKey: 'lens.condition.label',
    blurbKey: 'lens.condition.blurb',
    requires: ['terrain', 'buildings'],
    // Every figure here is invented. No German university publishes this per building.
    provenance: 'synthetic',
    repaintsBuildings: true,
    // A compact control whose slider repaints the city behind it.
    steersTheTwin: true,
    status: { implemented: true, phase: 7 },
  },
  flow: {
    id: 'flow',
    labelKey: 'lens.flow.label',
    blurbKey: 'lens.flow.blurb',
    requires: ['terrain', 'buildings', 'footpaths'],
    // Routes and timings come from the real timetable; only the cohort sizes are invented.
    provenance: 'derived',
    // The timeline IS the lens: 280 quarter-hour slots scrubbed across the week, repainting the
    // people moving over the campus. Putting that behind a drawer covers its own subject.
    steersTheTwin: true,
    status: { implemented: true, phase: 8 },
  },
  staffing: {
    id: 'staffing',
    labelKey: 'lens.staffing.label',
    blurbKey: 'lens.staffing.blurb',
    // Needs no geometry at all — it reads the plan, not the campus. Listed as `bookings` because
    // that is what a site must have for the question to mean anything: a site with no timetable
    // has no teaching load to divide.
    requires: ['bookings'],
    // A join over generated figures. The arithmetic is exact; the plan underneath is synthetic,
    // which is why the panel carries the source's own warning rather than a fresh claim.
    provenance: 'derived',
    status: { implemented: true, phase: 13 },
  },
  quality: {
    id: 'quality',
    labelKey: 'lens.quality.label',
    blurbKey: 'lens.quality.blurb',
    // Reads the plan, not the campus — the same requirement as staffing.
    requires: ['bookings'],
    // Measured from the plan's own slots and travel matrix; the plan beneath is synthetic, so the
    // panel carries the source's warning rather than making a fresh claim.
    provenance: 'derived',
    status: { implemented: true, phase: 13 },
  },
};

/** The lenses an AOI can honestly offer, in registry order. */
export function lensesFor(aoiLenses: LensId[]): Lens[] {
  return (Object.keys(LENSES) as LensId[])
    .filter((id) => aoiLenses.includes(id))
    .map((id) => LENSES[id]);
}

/**
 * Which lens a visitor should land on, or null to land on the campus itself.
 *
 * A lens that repaints the buildings is deliberately never the answer — see `repaintsBuildings`.
 * A link that names one (`?lens=condition`) still opens it: choosing is the point, defaulting is
 * the bug.
 */
export function landingLens(lenses: Lens[]): LensId | null {
  return lenses.find((lens) => lens.status.implemented && !lens.repaintsBuildings)?.id ?? null;
}
