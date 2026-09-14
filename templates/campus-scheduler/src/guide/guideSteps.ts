/**
 * The guided tour — the OTH Regensburg planning story, one step at a time.
 *
 * ⚠️ A DEMO THAT NEEDS A PRESENTER IS HALF A DEMO. Everything here is explained perfectly well
 * when somebody is standing next to you; opened cold it is a 3D campus with a week grid and no
 * statement of what is real. This walks a first-time viewer through the parts in the order they
 * matter and, at every step, says WHERE THE DATA CAME FROM — which is the one thing this project
 * cares about more than any feature. Modelled on the wind-farm twin's spotlight tour.
 *
 * ⚠️ THE SOURCE BADGE IS THE POINT, NOT DECORATION. This dataset mixes surveyed geography,
 * published floor plans and an invented timetable, and a viewer cannot tell them apart by looking.
 * A step that describes a component without naming its provenance would be exactly the confident,
 * unsourced claim the rest of the codebase refuses to make.
 *
 * ⚠️ ONE UNIVERSITY, AND NO SWITCHER STEP. The tour used to open with "Vier Universitäten, ein
 * Build" and spotlight the site menu, which is a statement about our deployment, not about the
 * customer's problem — and in front of OTH it names every other customer in the build. The tour is
 * now OTH's story end to end. `REQUIREMENTS.md` describes exactly one university, so a tour that
 * advertises three others is answering a question nobody in the room asked.
 *
 * ⚠️ IT FOLLOWS THE PAIN POINT, NOT THE ARCHITECTURE. `REQUIREMENTS.md` §2 names one central
 * problem: a professor changes availability, many sessions have to move, new conflicts appear
 * against rooms, cohorts and other lecturers, and today the consequences are worked out BY HAND.
 * The middle act of this tour is that exact sequence — change, cascade, conflicts, alternatives,
 * review, commit — because a tour organised by component ("here is the calendar, here is the
 * chat") demonstrates the parts and never once demonstrates the problem they were built for.
 *
 * The three acts:
 *   1. steps 1–5   what you are looking at, and which parts are real
 *   2. steps 6–11  the change: the requirements doc's cascading-change pain point, worked through
 *   3. steps 12–14 was it a GOOD plan? — the soft constraints from §3 and §5.1
 *
 * Copy lives in the i18n catalogue (`guide.step.<id>.title` / `.body`) so both languages stay in
 * step and `catalogue.test.ts` can see the keys.
 */

/** Where the thing being explained gets its information. Drives the badge on the card. */
export type GuideSource =
  | 'overview'
  | 'survey'
  | 'published'
  | 'generated'
  | 'solver'
  | 'foundry'
  | 'fabric';

export type GuidePlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto';

/** What the tour is allowed to drive while it explains. Deliberately tiny. */
export interface GuideContext {
  /** Open or close the week grid, so the calendar step can show one. */
  setCalendarOpen: (open: boolean) => void;
  /** Open or close the side panel, so the lens and assistant steps can show one. */
  setPanelOpen: (open: boolean) => void;
  /**
   * Which half of the drawer's lower pane is showing.
   *
   * ⚠️ The tour needs this because two of its steps describe what is IN that pane — the journeys
   * between buildings, and the log of confirmed changes — and they are the same rectangle showing
   * different things. Spotlighting it without selecting the right tab points confidently at the
   * wrong content, which is the failure mode `guide.spec.ts` exists to catch.
   */
  setLowerPane: (pane: 'walks' | 'changes') => void;
  /** Whether this university has a timetable at all — two of the four do not. */
  hasPlanner: boolean;
}

export interface GuideStep {
  id: string;
  /** CSS selector to spotlight, or null for a centred card. */
  target: string | null;
  source: GuideSource;
  placement?: GuidePlacement;
  /** Steps that only make sense where a timetable exists. */
  needsPlanner?: boolean;
  /**
   * Steps that only make sense where there is NO timetable.
   *
   * ⚠️ Exists for exactly one reason: the opening line. It now promises a walkthrough of a
   * cancellation and its consequences, which is the customer's actual problem — and a promise a
   * campus twin with no planner cannot keep. Rather than water the opening down to something true
   * everywhere and gripping nowhere, the twins get their own.
   */
  needsNoPlanner?: boolean;
  /**
   * Steps that only make sense where the timetable is the university's OWN.
   *
   * ⚠️ Exactly one site qualifies, and saying it on the other three would be a lie of the most
   * ordinary kind — a tour that praises real data in front of generated data. Gated on the fact,
   * not on the site id, so a second real dataset inherits it and a regenerated TUM loses it.
   */
  needsRealTimetable?: boolean;
  onEnter?: (ctx: GuideContext) => void;
  onLeave?: (ctx: GuideContext) => void;
}

const STEPS: GuideStep[] = [
  // ── Act 1 — what you are looking at, and which parts of it are real ──────────────────────
  {
    // The problem before the product: what planning costs today, at this university.
    id: 'welcome',
    target: null,
    source: 'overview',
    needsPlanner: true,
  },
  {
    // Same slot, for a campus twin that has no timetable to replan.
    id: 'welcomeTwin',
    target: null,
    source: 'overview',
    needsNoPlanner: true,
  },
  {
    id: 'campus',
    target: '[data-testid="campus-canvas"]',
    source: 'survey',
    placement: 'right',
  },
  {
    id: 'interior',
    target: '[data-testid="campus-canvas"]',
    source: 'published',
    placement: 'right',
  },
  {
    /*
     * The one site whose week is not this project's invention. It sits straight before the calendar
     * step, because the claim only means anything once you are about to see what it is a claim
     * about. Self-hiding: OTH's timetable is generated, so this never appears in the OTH demo.
     */
    id: 'realData',
    target: '[data-testid="timetable-real"]',
    source: 'published',
    placement: 'top',
    needsPlanner: true,
    needsRealTimetable: true,
    onEnter: (ctx) => ctx.setCalendarOpen(true),
  },
  {
    // ⚠️ Reveal, then restore. The drawer is closed by default and a spotlight on a closed drawer
    // is a spotlight on nothing — the wind-farm tour solved this the same way. The restore happens
    // at the END of act 2 (`saving`), because every step in between is about this week.
    id: 'calendar',
    target: '[data-testid="calendar-panel"]',
    source: 'generated',
    placement: 'top',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setCalendarOpen(true),
  },
  {
    /*
     * Standortabhängigkeit — REQUIREMENTS §3 and §4.3, and the reason the walks pane exists.
     * Spotlit on the pane that lists the actual walks rather than on the campus, because "two
     * sites far apart" is a claim about MINUTES and the minutes are what is on screen here.
     */
    id: 'distance',
    target: '[data-testid="calendar-walks-pane"]',
    source: 'survey',
    placement: 'top',
    needsPlanner: true,
    onEnter: (ctx) => {
      ctx.setCalendarOpen(true);
      ctx.setLowerPane('walks');
    },
  },

  // ── Act 2 — the cascading change, which is the whole reason the customer called ──────────
  {
    // The change arrives. Today: an email or an Excel row, and a planner's afternoon.
    id: 'scenario',
    target: '[data-testid="planner-chat"]',
    source: 'overview',
    placement: 'left',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setPanelOpen(true),
  },
  {
    id: 'assistant',
    target: '[data-testid="panel-chat"]',
    source: 'foundry',
    placement: 'left',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setPanelOpen(true),
  },
  {
    // The manual analysis from §2 step 4, done as a lookup instead of an afternoon.
    id: 'cascade',
    target: '[data-testid="calendar-panel"]',
    source: 'generated',
    placement: 'top',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setCalendarOpen(true),
  },
  {
    id: 'solver',
    target: '[data-testid="panel-chat"]',
    source: 'solver',
    placement: 'left',
    needsPlanner: true,
  },
  {
    // §3's "Oberfläche zur Prüfung und Anpassung": the planner decides, not the model.
    id: 'review',
    target: '[data-testid="panel-chat"]',
    source: 'solver',
    placement: 'left',
    needsPlanner: true,
  },
  {
    /*
     * ⚠️ NOT the "open calendar" button, which is what this pointed at for one revision. That
     * button only exists while the drawer is CLOSED, and this step now runs with it open — so the
     * spotlight silently collapsed and the step became an anonymous full-screen dim. Pointing at
     * the change log instead is also simply the better step: it is the audit trail the copy is
     * describing.
     */
    id: 'saving',
    target: '[data-testid="calendar-walks-pane"]',
    source: 'fabric',
    placement: 'top',
    needsPlanner: true,
    onEnter: (ctx) => {
      ctx.setCalendarOpen(true);
      ctx.setLowerPane('changes');
    },
    onLeave: (ctx) => {
      ctx.setLowerPane('walks');
      ctx.setCalendarOpen(false);
    },
  },

  // ── Act 3 — conflict-free is not the same as good ────────────────────────────────────────
  {
    id: 'lenses',
    target: '[data-testid="panel-lenses"]',
    source: 'generated',
    placement: 'left',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setPanelOpen(true),
  },
  {
    /*
     * The soft constraints from §5.1 that a feasibility solver will happily ignore: idle blocks,
     * unpopular fringe slots, day length — and campus changes that are too tight for the break.
     */
    id: 'studentDay',
    target: '[data-testid="panel-lenses"]',
    source: 'generated',
    placement: 'left',
    needsPlanner: true,
    onEnter: (ctx) => ctx.setPanelOpen(true),
  },
  {
    // The honest close: what is measured, what is invented, and why the difference is laboured.
    id: 'provenance',
    target: null,
    source: 'overview',
  },
];

/**
 * The steps this university can actually show.
 *
 * ⚠️ A CAMPUS TWIN WITHOUT A TIMETABLE GETS THE SHORT TOUR. Garching and Tübingen have no planner
 * — the app already refuses to offer them a calendar and says so rather than showing an empty one.
 * A tour that walked them through a week grid they do not have would be the same failure in a
 * friendlier voice, so those steps are dropped rather than spotlighting nothing.
 *
 * ⚠️ `lenses` IS GATED ON THE PLANNER TOO, which it was not before. The step describes "rooms,
 * lecturers, students — three viewpoints on the same plan", and Tübingen offers exactly one lens
 * (Sanierungsstau) and no plan at all. The tour was making a three-part promise there that the
 * screen behind it never kept.
 */
export function guideSteps(hasPlanner: boolean, timetableReal = false): GuideStep[] {
  return STEPS.filter(
    (step) =>
      (!step.needsPlanner || hasPlanner) &&
      (!step.needsNoPlanner || !hasPlanner) &&
      (!step.needsRealTimetable || timetableReal)
  );
}
