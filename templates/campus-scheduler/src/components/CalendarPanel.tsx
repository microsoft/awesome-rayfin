import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  checkMoves,
  deleteJson,
  getJson,
  postJson,
  replanWithout,
  schedulerConfigured,
  type AppliedDraft,
  type CalendarEntry,
  type CalendarScope,
  type CalendarSubject,
  type CalendarView as CalendarData,
  type DraftSummary,
  type PlanConflict,
  type ProposalDiff,
} from '@/api/scheduler';
import {
  currentPlanMoves,
  clearPlanStore,
  deletePlanChanges,
  dirtyAssignmentSessions,
  planStoreCanSignIn,
  planStoreIdentity,
  savePlanAssignments,
  listPlanAssignments,
  savePlanChanges,
  signInAndSavePlanChanges,
  type BaselinePosition,
  type PlanChangeRow,
  type RestoredMove,  type SaveOutcome,
} from '@/api/planStore';
import { conflictReason, verdictFor, type MoveVerdict } from '@/planner/moveCheck';
import { activeAoi } from '@/config/aoi';
import { WalkList } from '@/components/WalkList';
import { AvailabilityPanel } from '@/components/AvailabilityPanel';
import {
  loadWalkRoutes,
  routeLine,
  weekWalks,
  type WalkRoutes,
} from '@/planner/walkRoutes';
import { ResizeHandle } from '@/components/ResizeHandle';
import { SiteMismatchNotice } from '@/components/SiteMismatchNotice';
import { calendarError, requestError } from '@/api/apiError';
import { usePaneSize } from '@/components/usePaneSize';
import { useI18n } from '@/i18n';

/**
 * The published week for one teacher, cohort or room — PLAN §13.3, and §6.2.
 *
 * ⚠️ IT READS THE PLAN; IT STILL CANNOT CHANGE IT. This panel used to be strictly read-only, on
 * the grounds that the surface a planner uses to check what the assistant claimed must not be able
 * to alter it. Dragging a session does not break that rule, because a drag does not write: the
 * move is checked against the whole plan by the server's own deterministic checker and then held
 * HERE, unsaved and labelled as such. The only endpoint in the service that changes a plan takes a
 * solver proposal id, so a hand-made move has nowhere to go even if this panel wanted to send it.
 *
 * What the drag is for is the thing §6.2 asks for: letting a planner FEEL the constraints instead
 * of reading about them. Drop a lecture on Friday afternoon and the reason it cannot go there is
 * named — this room, that cohort, those seats — in the time it takes to let go of the mouse.
 *
 * ⚠️ A CELL CAN HOLD SEVERAL SESSIONS. A cohort's week has 31 entries in 18 slots because
 * Praktika run as parallel groups in different rooms at the same hour — that multiplication is
 * the reason timetabling is hard, so hiding it behind "one box per slot" would misrepresent the
 * problem the app exists to solve.
 *
 * It sits in a bottom drawer rather than the side panel because a five-day grid needs width, and
 * the 3D campus stays the main pane.
 */

const SCOPES: CalendarScope[] = ['teacher', 'cohort', 'room'];

/** A session the planner has dragged, before anyone has decided whether it may stay there. */
/**
 * A move the server actually applied to the published plan.
 *
 * ⚠️ It carries `buildingId` and `campusId` because the client writes this straight back into SQL,
 * and `savePlanAssignments` updates those columns on every write — sending empty strings would
 * blank fields the baseline seed had filled.
 */
interface PublishedMove {
  sessionId: string;
  teacherId?: string;
  cohortId?: string;
  to: { slotId?: string; roomId?: string; buildingId?: string; campusId?: string };
}

interface PendingMove {
  sessionId: string;
  fromSlotId: string;
  toSlotId: string;
  roomId: string;
  course: string;
}

/** Below this the header alone fills the drawer and no row of the grid is readable. */
const CALENDAR_MIN = 140;
// The two halves of the drawer. Floors rather than aesthetics: below these the week grid shows no
// full row and the walk list shows no complete entry, so dragging past them hides the thing the
// pane exists for instead of merely making it small.
const GRID_MIN = 120;
const WALKS_MIN = 96;

/** Colour by what the session IS, not by who owns it: a lecture and a lab read differently. */
function kindClass(entry: CalendarEntry): string {
  const kind = (entry.kind ?? entry.course ?? '').toLowerCase();
  if (kind.includes('vorlesung')) return 'border-sky-400/70 bg-sky-500/15 text-sky-100';
  if (kind.includes('praktikum')) return 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100';
  if (kind.includes('übung') || kind.includes('ubung'))
    return 'border-amber-400/70 bg-amber-500/15 text-amber-100';
  return 'border-stone-500/70 bg-stone-600/25 text-stone-100';
}

export function CalendarPanel({
  open,
  onClose,
  onSelectRooms,
  proposalId,
  onApplied,
  focus,
  mismatch,
  siteKnown = true,
  aoiId,
  onShowRoute,
  onProposal,
  detail,
  detailLabel,
  revealDetail = 0,
  lowerPane = 'walks',
  onLowerPaneChange,
  changes,
  onChangesChanged,
  timetableReal = false,
  lecturerLookup = true,
  inventedAttributes = [],
  sourceLimits,
}: {
  open: boolean;
  onClose: () => void;
  onSelectRooms?: (roomIds: string[]) => void;
  /** A solver proposal to preview. Nothing is written until the planner confirms. */
  proposalId?: string | null;
  onApplied?: (draft: AppliedDraft) => void;
  /**
   * Show this subject's week, chosen elsewhere in the app.
   *
   * This is what keeps the staffing lens from being a separate tool: picking an overloaded
   * lecturer there opens THEIR week here, in the grid that was already on screen, rather than
   * rendering a second calendar that happens to look similar.
   */
  focus?: { scope: CalendarScope; key: string } | null;
  /**
   * What the pane BELOW the week grid is showing.
   *
   * ⚠️ ONE DRAWER, TWO LOWER VIEWS — the same reasoning as the tabs above it. `Wege` and
   * `Änderungen` both answer questions about the week already on screen, and giving each its own
   * panel would cost the campus another slice of screen while leaving the planner to hold all
   * three in their head. The walk list in particular was buried down here where nobody found it;
   * the rail is now a way in, and the pane says which of the two it is showing.
   */
  lowerPane?: 'walks' | 'changes' | 'availability';
  onLowerPaneChange?: (pane: 'walks' | 'changes' | 'availability') => void;
  /**
   * Sessions that differ from the published plan, fetched ONCE by the shell.
   *
   * ⚠️ Passed in rather than read here, because the rail's badge needs the same number and two
   * independent reads of the same endpoint can disagree — a badge saying 4 above a list showing 3
   * is worse than either on its own. `null` means not known, which is not the same as none.
   */
  changes?: RestoredMove[] | null;
  /** The saved changes were edited here — the shell owns that list, so it has to be told. */
  onChangesChanged?: (moves: RestoredMove[]) => void;
  /**
   * Is this week the university's own, rather than one this project generated?
   *
   * ⚠️ Only TUM Garching's is. Every other surface in this app badges what is invented; the week
   * had no way to say the opposite, so the one dataset that is genuinely published looked exactly
   * like the two that are not.
   */
  timetableReal?: boolean;
  /**
   * Can a lecturer be looked up on this site at all?
   *
   * False only where the people are invented on top of real teaching. Defaults to true, because
   * hiding a scope that works is worse than briefly showing one that does not.
   */
  lecturerLookup?: boolean;
  /**
   * Per-session fields that are INVENTED while the lecture itself is published.
   *
   * ⚠️ HIDING THE LECTURER SCOPE WAS NOT ENOUGH. The grid prints the person and the cohort beside
   * the course and the room on every entry, so Garching — whose default scope is `room` — read
   * "Höhere Mathematik 1 für MW/CIW [CIT513013] · 5510.EG.001 · Prof. Dr. R. Wimmer", where the
   * module code and the room are genuinely TUM's and the professor is fiction. Three true fields
   * make the fourth look just as true.
   */
  inventedAttributes?: string[];
  /**
   * What the SOURCE does not publish, as opposed to what we invented.
   *
   * ⚠️ Optional, and absent means "nothing to declare". Three of the four universities are
   * generated and have no such gaps; only OTH's real Untis export does, and a required prop would
   * have forced every caller and every test to state an emptiness that is the normal case.
   */
  sourceLimits?: {
    lecturerNamesAreCodes: boolean;
    roomsWithoutGeometry: number;
    roomsCampusOnly: string[];
    capacityPublished: boolean;
  };
  /**
   * Set when the backend serves a DIFFERENT university than the one on screen.
   *
   * ⚠️ The drawer then opens and says so instead of loading. Every subject it could ask for
   * belongs to the other site, so the request returns `not_found` and the week renders empty —
   * which reads as "this cohort has no lectures" rather than "the backend is the wrong one".
   */
  mismatch?: { serving: string; expected: string } | null;
  /**
   * Has the app established WHICH university the backend serves yet?
   *
   * ⚠️ UNTIL IT HAS, `mismatch` BEING NULL MEANS "DO NOT KNOW", NOT "FINE" — and treating the two
   * the same is how the guard failed open. `/api/health` decides it, the container scales to zero,
   * and a cold start takes twenty to thirty seconds; in that window the panel happily asked LMU's
   * backend for an LMU cohort it has never heard of and printed the refusal. Waiting costs nothing
   * real, because the week itself is a call to the same container that is busy waking up.
   */
  siteKnown?: boolean;
  /** Which campus the week belongs to — the walking routes are built per site. */
  aoiId?: string;
  /**
   * Draw a walk on the campus. `[lon, lat]` pairs in order of travel, or an empty list to clear.
   *
   * The panel can say "six minutes" on its own; only the twin can show that the six minutes go
   * round the building rather than through it, which is the difference between a number the
   * planner has to trust and one they can check.
   */
  onShowRoute?: (points: [number, number][]) => void;
  /**
   * A solver proposal is ready to preview. Raised so the shell can drive it through exactly the
   * same confirm gate the assistant's proposals use — two doors, one lock.
   */
  onProposal?: (proposalId: string) => void;
  /**
   * The active lens's readout, shown as a second tab beside the week.
   *
   * ⚠️ IT LIVES HERE RATHER THAN IN THE SIDE PANEL because the two belong together: the lens
   * finds the problem ("this cohort waits three hours on Tuesday") and the week grid is the
   * evidence for it. They were on opposite sides of the screen with the 3D campus in between, and
   * every readout is a table that a 384 px column wrapped into a ribbon.
   */
  detail?: React.ReactNode;
  /** What to call the second tab — the active lens's own name, not a generic word. */
  detailLabel?: string;
  /** Bumped by the shell each time a lens button is clicked — see the reveal effect below. */
  revealDetail?: number;
}) {
  const { t } = useI18n();
  /*
   * ⚠️ THE OPENING SCOPE HAS TO BE ONE THIS SITE CAN ANSWER. A lecturer's week is the best first
   * view where it exists — it is the subject of the cascade demo — but on a dataset whose people
   * are invented over real teaching it is the one question the app refuses, so opening there
   * greeted the planner with a refusal.
   */
  const [scope, setScope] = useState<CalendarScope>(lecturerLookup ? 'teacher' : 'room');
  /*
   * Which invented fields must NOT be printed against a real lecture. Derived rather than passed
   * as two booleans so the server decides what is fiction and the grid only obeys — a dataset that
   * later invents something else says so in one place.
   */
  const hideTeacher = inventedAttributes.includes('teacher');
  const hideCohort = inventedAttributes.includes('cohort');
  /*
   * The sentence the real dataset owes its reader.
   *
   * ⚠️ BUILT FROM WHAT THE SERVER MEASURED, NOT FROM THE SITE ID. Keying this on 'oth-real' would
   * make it a decoration that happens to be true today; keying it on the data means a future
   * export that DOES publish capacities silently stops claiming otherwise. Empty on every
   * generated site, so nothing changes for OTH, LMU or TUM.
   */
  const sourceNotes = useMemo(() => {
    if (!sourceLimits) return [] as string[];
    const out: string[] = [];
    if (sourceLimits.lecturerNamesAreCodes) out.push(t('calendar.srcCodes'));
    if (sourceLimits.roomsWithoutGeometry > 0)
      out.push(t('calendar.srcNoGeometry', { count: String(sourceLimits.roomsWithoutGeometry) }));
    if (!sourceLimits.capacityPublished) out.push(t('calendar.srcNoCapacity'));
    return out;
  }, [sourceLimits, t]);
  useEffect(() => {
    // The fact arrives asynchronously; if it says no lecturers, move off that scope once.
    if (!lecturerLookup && scope === 'teacher') setScope('room');
  }, [lecturerLookup, scope]);
  /** The session currently under the pointer. A ref, because a drag must not re-render the grid. */
  const dragging = useRef<string | null>(null);
  /**
   * A session the planner has dragged somewhere, and what the server thinks of it — PLAN §6.2.
   *
   * ⚠️ HELD LOCALLY, AND SAID SO ON SCREEN. The checker is authoritative — `detect_conflicts`
   * answers from the whole plan — but there is no endpoint that accepts a hand-made move:
   * `/api/draft/apply` takes a solver proposal id. So this is a what-if that tells the truth about
   * legality and is honest about not being saved, rather than a save button that quietly does
   * nothing.
   *
   * Declared here, above the memos that read it, because those draw the move into the grid.
   */
  const [move, setMove] = useState<PendingMove | null>(null);
  const [verdict, setVerdict] = useState<MoveVerdict | null>(null);
  const [checking, setChecking] = useState(false);
  /** The check itself failed, which is a different thing from the move being illegal. */
  const [checkFailed, setCheckFailed] = useState(false);
  const baseline = useRef<PlanConflict[] | null>(null);
  const [subjects, setSubjects] = useState<CalendarSubject[]>([]);
  const [key, setKey] = useState('');
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Drawer height ─────────────────────────────────────────────────────────
  // Measured against the pane the drawer sits in, not the window, so "full" means the whole campus
  // view rather than something that would slide under the header.
  const frameRef = useRef<HTMLElement | null>(null);
  const availableHeight = useCallback(
    () => frameRef.current?.parentElement?.clientHeight ?? window.innerHeight,
    []
  );
  const [height, setHeight] = usePaneSize('campus.calendarHeight', 380, {
    min: CALENDAR_MIN,
    max: availableHeight,
  });

  /**
   * The split INSIDE the drawer, between the week grid and the walks between appointments.
   *
   * ⚠️ THESE TWO USED TO SHARE ONE SCROLLER, which meant they could not be read together: scrolling
   * down to the walk that is 15 minutes short pushed the grid — the thing the walk is about — off
   * the top. Giving each its own scroll area and a handle between them lets a planner hold a
   * timetable row and its consequence in view at the same time, which is the whole comparison.
   *
   * Sized against the drawer body rather than the window, because the drawer is itself resizable:
   * a grid height that was two thirds of a tall drawer must not survive being dragged short.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gridMax = useCallback(
    () => Math.max(GRID_MIN, (bodyRef.current?.clientHeight ?? height) - WALKS_MIN),
    [height]
  );
  const [gridHeight, setGridHeight] = usePaneSize('campus.calendarGridHeight', 220, {
    min: GRID_MIN,
    max: gridMax,
  });

  // The proposal being previewed, and the draft a confirmation produced. Both null in the normal
  // read-only case, which is the state the panel spends most of its life in.
  const [diff, setDiff] = useState<ProposalDiff | null>(null);
  const [option, setOption] = useState(1);
  const [applied, setApplied] = useState<AppliedDraft | null>(null);
  // What the durable store did with the confirmed change. Null until a confirm has been attempted.
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  // Kept so the planner can still make it durable AFTER the fact — signing in needs its own click.
  const [pendingRows, setPendingRows] = useState<Omit<PlanChangeRow, 'savedBy' | 'savedAt'>[]>([]);
  const [signingIn, setSigningIn] = useState(false);
  const [applying, setApplying] = useState(false);

  // Which plan the grid reads, and what else is available to switch to. `null` means published.
  const [activeDraft, setActiveDraft] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  /**
   * How many sessions the saved decisions moved away from the baked baseline, once they were
   * replayed. Null means no replay happened — which is not the same as zero, and the UI says only
   * the one it actually knows.
   */
  const [restoredCount, setRestoredCount] = useState<number | null>(null);
  //: What the last publish did, or why it was refused. Held as a rendered STRING rather than a
  //: code because it is one line of feedback with no other reader — but it is set from `t(…)` at
  //: the moment of the action, so a language switch afterwards leaves it in the old language.
  //: Acceptable here and nowhere that persists: the note is cleared by the next action.
  const [publishNote, setPublishNote] = useState<string | null>(null);
  //: Which saved changes the planner wants in the plan of record. Session ids rather than indices,
  //: because the list is re-read after every publish and an index would then point at a different
  //: change than the one that was ticked.
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  /*
   * ⚠️ "ENTWURF VERWERFEN" LOOKED LIKE A NO-OP, AND THE CAUSE WAS THIS EFFECT EATING ITS OWN TAIL.
   * Discarding deletes the in-memory draft and then refreshes; the refresh sees an empty draft list,
   * which is exactly the condition that triggers restore-from-store, so the saved rows rebuilt the
   * draft before the planner's click had finished. The list flickered and came back identical.
   *
   * The gate cannot be "has anything been saved", because that is also true in the case restore
   * exists for. It has to be "did the planner just say no" — an intent, held for this session only.
   * A reload legitimately restores again: the rows ARE still saved, and discarding a draft was
   * never a promise to delete them. Deleting them is the separate, explicit act below.
   */
  const restoreSuppressed = useRef(false);
  /**
   * Which backend site this AOI belongs to; the store is keyed by it, and reading another
   * university's decisions would be worse than reading none.
   *
   * ⚠️ THROUGH `activeAoi()`, NOT `AOIS[id]`. The registry holds the AOI's CONFIGURED site, and
   * `?scheduler=` deliberately overrides it so one campus can be shown on either its generated or
   * its real timetable (§25). Reading the registry directly bypassed that override, so on
   * `?scheduler=oth` this panel asked `oth-real` for teacher `M-T029` — an id that only exists on
   * the generated site. The backend answered `teacher_not_found`, the availability view came back
   * without a `teacherId`, and "Vorlage für diese Person" quietly turned into "Vorlage für alle":
   * a 414-lecturer workbook where a one-person file was asked for, with nothing on screen saying
   * the site had changed underneath.
   *
   * `TwinShell` already guards the reverse mistake (a mismatched backend answering for the wrong
   * university). This is the same class of fault reached through a different door.
   */
  const aoiSchedulerSite = activeAoi().schedulerSite;

  // A subject asked for from elsewhere, held until the suggestions for ITS scope have arrived.
  //
  // ⚠️ The SCOPE is stored with the key, and that is the whole fix. Holding a bare key let the
  // wrong fetch consume it: selecting a cohort sets scope and key together, but the suggestions
  // effect runs once more with the PREVIOUS scope first, ate the pending key there, and the real
  // cohort fetch then fell back to the first suggestion — the panel opened Fahrzeugtechnik while
  // the lens said Wirtschaftsinformatik. The staffing lens hid this because 'teacher' is already
  // the default scope, so its key never had to survive a scope change.
  const requested = useRef<{ scope: CalendarScope; key: string } | null>(null);

  // Revealing the readout is driven by a COUNTER the shell bumps when a lens button is clicked.
  //
  // ⚠️ It was previously an effect on `detail` — the rendered node — which is a fresh object on
  // every render, so the effect re-ran continuously and pinned the drawer to the analysis tab: the
  // "Woche" button appeared to do nothing, and every deep link landed on the wrong tab. A number
  // that only changes on a real click cannot do that.
  const firstReveal = useRef(true);
  useEffect(() => {
    if (firstReveal.current) {
      firstReveal.current = false;
      return;
    }
    setTab('detail');
  }, [revealDetail]);

  useEffect(() => {
    if (!focus) return;
    /*
     * ⚠️ ALWAYS HAND OVER THROUGH `requested`, EVEN WHEN THE SCOPE ALREADY MATCHES.
     *
     * Setting the key directly in that case looks obviously correct and loses a race: the
     * suggestions fetch for THIS scope is still in flight, and when it lands it finds no pending
     * request and settles the grid on `subjects[0]` instead. `?teacher=IM-T029` opened IM-T015's
     * week — a link to a NAMED PERSON quietly showing somebody else, which is the worst shape a
     * bug can take in this app.
     *
     * The ref survives the round trip; the scope is stored with it so only the matching fetch can
     * consume it. `setKey` still runs for the scope-matching case so the grid moves immediately
     * rather than waiting for the subject list.
     */
    requested.current = { scope: focus.scope, key: focus.key };
    if (focus.scope !== scope) setScope(focus.scope);
    else setKey(focus.key);
    // Picking a name in the readout is a request to SEE that week, so hand the drawer back to the
    // grid. Without this the click looked broken: scope and key changed correctly underneath a
    // still-visible table, and the week it had just loaded sat one tab away, unseen.
    setTab('week');
    // Only react to a NEW request; scope and key change underneath this on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Suggestions first, so the grid is never empty on arrival — an empty week is indistinguishable
  // from a broken fetch.
  //
  // ⚠️ Clear the key BEFORE fetching. Without this, changing scope leaves the previous scope's id
  // in place for one render and fires `?scope=room&key=IM-T029` — a teacher id asked of the room
  // index — which 404s and flashes an error before the real request lands. The server log is where
  // that showed up; on screen it was just a flicker.
  useEffect(() => {
    // A mismatched backend can only answer `not_found` for every subject on this campus, so the
    // subject list is not fetched at all rather than filled with the other university's people.
    // The same applies while the site is still UNKNOWN — see `siteKnown`.
    if (!open || mismatch || !siteKnown || !schedulerConfigured()) return;
    let cancelled = false;
    setSubjects([]);
    setKey('');
    setData(null);
    setError(null);
    // ⚠️ THE WAIT STARTS HERE, NOT AT THE WEEK FETCH. `loading` used to be owned solely by
    // `load()`, so between changing scope and the subject list arriving the drawer rendered a bare
    // Mo–Fr grid with no message at all — the same silent empty week this effect's own comment
    // warns about, just transient. On a cold container that window is tens of seconds long and
    // looks exactly like a scope button that does nothing.
    setLoading(true);
    getJson<{ subjects: CalendarSubject[] }>('/api/calendar/suggestions', { scope })
      .then((r) => {
        if (cancelled) return;
        // ⚠️ A BODY THAT IS NOT A SUBJECT LIST IS A FAILURE, NOT AN EMPTY LIST. The endpoint can
        // answer 200 with an error payload, and `r.subjects` is then undefined — which used to
        // throw inside this callback and land in the catch below, silently.
        if (!Array.isArray(r.subjects)) throw new Error(`suggestions returned no subject list`);
        setSubjects(r.subjects);
        // ⚠️ A subject requested from outside wins over the first suggestion — but ONLY if it was
        // asked for in THIS scope. Consuming it regardless is what opened the wrong cohort.
        const wanted = requested.current;
        let next = '';
        if (wanted && wanted.scope === scope) {
          requested.current = null;
          next = wanted.key;
        } else if (r.subjects.length) {
          next = r.subjects[0].id;
        }
        setKey(next);
        // Something to ask for: `load()` takes the flag from here. Nothing to ask for: the wait is
        // genuinely over, and holding a spinner would promise an answer that is not coming.
        if (!next) setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        /*
         * ⚠️ THIS USED TO BE `.catch(() => undefined)` — AND THE COMMENT ABOVE THIS EFFECT ALREADY
         * SAID WHY THAT IS WRONG: "an empty week is indistinguishable from a broken fetch". The
         * key is only ever set inside the `then`, so when this call failed nothing was ever asked
         * for, the grid rendered as an empty Mo–Fr shell, and the panel said NOTHING AT ALL.
         *
         * A reader cannot tell that apart from a week with no teaching in it. Same family as the
         * `/api/plan/summary` 401 that hid behind a deliberate catch: a swallowed failure is the
         * hardest kind to see, because every surface still looks like it is working.
         */
        const failure = requestError(err);
        setError(t(failure.key, failure.values));
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, mismatch, siteKnown, t]);

  // ⚠️ Reads can overtake each other, so the LATEST request wins rather than the last to answer.
  // Switching scope issues a fetch, and the suggestions effect issues a corrected one right
  // behind it; without this counter a slow first answer lands after the fast second one and the
  // grid settles on the view the planner just navigated away from — which reads as the app
  // ignoring the click. `AbortController` would also stop the traffic, but the responses are small
  // and discarding the stale one is what actually has to be guaranteed.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (subjectKey: string) => {
      if (!subjectKey || !schedulerConfigured()) return;
      const seq = ++loadSeq.current;
      const current = () => seq === loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        // ⚠️ The active draft travels with every read. Without this the draft was sticky only for
        // the exact week that was open when it was confirmed: changing scope or subject silently
        // fell back to the published plan, so a planner who had just confirmed five moves watched
        // them disappear. "Where did my change go" is a worse failure than refusing to make it.
        const view = await getJson<CalendarData>('/api/calendar', {
          scope,
          key: subjectKey,
          ...(activeDraft ? { draftId: activeDraft } : {}),
        });
        if (!current()) return;
        if (view.error) {
          setData(null);
          // ⚠️ TRANSLATE THE CODE, DISCARD THE PROSE. `view.message` is an English sentence written
          // for a developer — "no cohort matches 'MED-MEDI-1'" — and it was being rendered straight
          // into a German UI, in the one place a reader is already confused enough to be reading
          // error text. The raw text goes to the console instead.
          const failure = calendarError(view);
          setError(failure ? t(failure.key, failure.values) : null);
        } else {
          setData(view);
        }
      } catch (err) {
        if (!current()) return;
        setData(null);
        const failure = requestError(err);
        setError(t(failure.key, failure.values));
      } finally {
        if (current()) setLoading(false);
      }
    },
    [scope, activeDraft, t]
  );

  useEffect(() => {
    if (open && !mismatch && siteKnown && key) void load(key);
  }, [open, key, load, mismatch, siteKnown]);

  // ── The walk between rooms ─────────────────────────────────────────────────────────────────
  // Static per site and independent of the backend, so it loads even on a site mismatch and even
  // while the container is waking up: geometry does not depend on which university the solver was
  // started with.
  const [walkRoutes, setWalkRoutes] = useState<WalkRoutes | null>(null);
  const [openWalk, setOpenWalk] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !aoiId) return;
    let cancelled = false;
    loadWalkRoutes(aoiId)
      .then((loaded) => !cancelled && setWalkRoutes(loaded))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, aoiId]);

  /**
   * Every walk the subject of this week has to make.
   *
   * Meaningful for a lecturer and for a cohort — both are one body moving through a day. For a
   * ROOM it would be nonsense: a room's consecutive bookings belong to different people, and
   * chaining them would invent a person who attends everything held there.
   */
  const walks = useMemo(
    () => (scope === 'room' || !data ? [] : weekWalks(walkRoutes, data.entries, data.slots)),
    [scope, data, walkRoutes]
  );

  // ── Replanning around an absence ───────────────────────────────────────────────────────────
  /** Which half of the drawer is showing. The week is the default; the readout is the second tab. */
  const [tab, setTab] = useState<'week' | 'detail'>('week');

  // ── Replanning around an absence ───────────────────────────────────────────────────────────
  /** Which day is being replanned, or null. Also the disabled state for the whole bar. */
  const [replanning, setReplanning] = useState<string | null>(null);

  const replan = useCallback(
    async (day: string) => {
      const teacher = data?.subject?.id;
      if (!teacher || replanning) return;
      setReplanning(day);
      setError(null);
      try {
        const { affected, proposal } = await replanWithout(teacher, day);
        const hit = affected.sessions?.length ?? 0;

        if (!hit) {
          // Nothing on that day is not a failure and must not read as one.
          setError(t('replan.nothingOn', { day }));
          return;
        }
        if (!proposal) {
          // ⚠️ The solver genuinely finding no legal replan is a REAL answer, and a different one
          // from "nothing was asked". Saying how big the hole is makes it actionable.
          setError(t('replan.noOption', { day, n: hit }));
          return;
        }
        // Hand it to the existing preview + confirm gate. Nothing is written yet.
        onProposal?.(proposal.proposalId);
      } catch (err) {
        const failure = requestError(err);
        setError(t(failure.key, failure.values));
      } finally {
        setReplanning(null);
      }
    },
    [data, replanning, onProposal, t]
  );

  // Which plan the grid is showing. Named state rather than a flag, because "published" is a real
  // option a planner switches BACK to in order to compare, not just the absence of a draft.
  const refreshDrafts = useCallback(async () => {
    if (!schedulerConfigured()) return;
    try {
      const r = await getJson<{ drafts: DraftSummary[] }>('/api/drafts');
      setDrafts(r.drafts);

      /*
       * ⚠️ THE PLAN USED TO SURVIVE ONLY AS LONG AS THE CONTAINER DID. Drafts live in a dict inside
       * the solver, and it scales to zero — so a confirmed change came back looking as though it
       * had never been made. Saving fixed the record; this is what makes the record COUNT.
       *
       * ⚠️ ONLY WHEN THE SOLVER HAS NOTHING. A warm backend still holding its drafts is already
       * showing the current plan, and restoring on top of that would mint a duplicate draft on
       * every open. An empty draft list is precisely the situation replay exists for.
       *
       * The restored draft is a REAL draft, not a client-side overlay, so conflict counts and any
       * further proposal are computed against the plan a planner is actually looking at.
       *
       * ⚠️ AND ONLY WHEN SOMEBODY IS SIGNED IN. Reading the store without a session is a
       * guaranteed 401 that the browser logs whatever this code does with the promise — it put two
       * of them in the console of every anonymous visit to the live app that opened the week.
       * There is also nothing to restore: without a session nobody could have saved anything.
       * `planStore` refuses the read as well; this gate states the intent where the decision is.
       */
      if (r.drafts.length === 0 && aoiSchedulerSite && planStoreIdentity() && !restoreSuppressed.current) {
        /*
         * ⚠️ THE PUBLISHED PLAN COMES BACK FIRST, AND THE ORDER IS NOT COSMETIC. The backend has
         * no database at all and scales to zero, so after an idle period it is serving the baked
         * baseline again — a plan somebody published yesterday is simply gone from it. SQL still
         * has those rows (`source = 'published'`), so they are replayed into the process BEFORE
         * any draft is restored. Restoring a draft first would diff it against the baseline and
         * describe changes that were published long ago as if they were pending.
         *
         * ⚠️ `replay: true` skips the conflict gate ON PURPOSE. These moves were accepted once
         * already; refusing them now would leave the process serving a plan that disagrees with
         * the durable record, which is worse than serving one with a conflict in it.
         */
        try {
          const rows = await listPlanAssignments(aoiSchedulerSite);
          const published = rows.filter((a) => a.source === 'published');
          if (published.length) {
            await postJson('/api/plan/publish', {
              moves: published.map((a) => ({
                sessionId: a.sessionId,
                slotId: a.slotId,
                roomId: a.roomId,
              })),
              publishedBy: planStoreIdentity() ?? '',
              replay: true,
            });
          }
        } catch {
          // A failed replay leaves the baseline showing, which is wrong but visible and honest.
          // Blocking the drawer on it would trade a stale plan for no plan.
        }
        const moves = await currentPlanMoves(aoiSchedulerSite);
        if (moves.length) {
          const restored = await postJson<{ draftId: string; sessionsChanged: number; unknownSessions: string[] }>(
            '/api/draft/restore',
            { moves, restoredBy: planStoreIdentity() ?? '', label: t('draft.restoredLabel') }
          );
          setActiveDraft(restored.draftId);
          setRestoredCount(restored.sessionsChanged);
          // A saved change whose session no longer exists means the dataset and the store have
          // drifted apart. Silence would let the plan quietly lose a decision somebody made.
          if (restored.unknownSessions.length) {
            console.warn('restored plan: unknown sessions', restored.unknownSessions);
          }
          const again = await getJson<{ drafts: DraftSummary[] }>('/api/drafts');
          setDrafts(again.drafts);
        }
      }
    } catch {
      // A missing draft list is not worth an error banner; the published plan still reads.
    }
  }, [aoiSchedulerSite, t]);

  useEffect(() => {
    if (open && !mismatch && siteKnown) void refreshDrafts();
  }, [open, refreshDrafts, mismatch, siteKnown]);

  /**
   * Write what was just published into SQL, so it survives the container scaling to zero.
   *
   * ⚠️ THIS IS WHAT MAKES "PUBLISHED" TRUE TOMORROW. The backend holds no database client and
   * scales to zero, so a publish lives exactly as long as that process. `PlanAssignment` is the
   * state table — where every session currently sits — and `source` is what separates a row the
   * baked dataset can reproduce from one only this row records.
   *
   * ⚠️ `published`, NOT `change`. Saving a confirmed draft already writes `change`, so reusing it
   * would make a merely-saved move indistinguishable from the plan of record and the cold-start
   * replay would promote work nobody published. The seeder's MERGE only overwrites
   * `target.source = 'baseline'`, so both survive a re-seed.
   *
   * Additive, like every other write here: a row that does not land must not turn a publish the
   * server already accepted into a failure. It is reported, never claimed.
   */
  const persistPublished = useCallback(
    async (applied: PublishedMove[]): Promise<boolean> => {
      const identity = planStoreIdentity();
      if (!identity || !applied.length) return false;
      const rows = applied.map((m) => ({
        site: aoiSchedulerSite ?? '',
        sessionId: m.sessionId,
        // Left empty on purpose: the narrow update half of `savePlanAssignments` does not write
        // these, and guessing them from the session id would be a fabrication.
        courseId: '',
        course: m.sessionId,
        teacherId: m.teacherId ?? '',
        cohortId: m.cohortId ?? '',
        slotId: m.to.slotId ?? '',
        roomId: m.to.roomId ?? '',
        buildingId: m.to.buildingId ?? '',
        campusId: m.to.campusId ?? '',
        frozen: false,
        source: 'published',
      }));
      const outcome = await savePlanAssignments(rows, identity);
      if (outcome.failed) {
        console.warn(`published plan: ${outcome.failed} of ${rows.length} rows did not persist`);
      }
      // ⚠️ PARTIAL IS NOT DURABLE. If any row failed, the next cold start replays an incomplete
      // plan, which is worse than replaying none — so the planner is told it did not stick.
      return outcome.failed === 0 && outcome.written === rows.length;
    },
    [aoiSchedulerSite]
  );

  const discardDraft = useCallback(
    async (draftId: string) => {
      try {
        await deleteJson(`/api/draft/${draftId}`);
      } catch {
        // Fall through: the point is to stop showing it.
      }
      // The planner said no. Until they navigate away, respect that rather than rebuilding it.
      restoreSuppressed.current = true;
      setActiveDraft(null);
      setApplied(null);
      await refreshDrafts();
    },
    [refreshDrafts]
  );

  /**
   * Make a draft the published plan.
   *
   * ⚠️ THE SERVER CAN REFUSE THIS, AND A REFUSAL IS AN ANSWER RATHER THAN A FAULT. A draft built
   * before somebody else published is `stale_draft`; a draft that would leave the plan with new
   * hard conflicts is `would_add_conflicts`. Both come back 200 with an `error` field, so they
   * must be rendered as a sentence the planner can act on — swallowing them would let the button
   * appear to work while the plan did not move.
   *
   * ⚠️ AND IT IS NOT DURABLE YET. The backend has no database client and scales to zero, so a
   * published plan lives as long as that process. `durable: false` comes back on every response
   * and is shown, because "published" is exactly the word a planner will take literally.
   */
  const publishDraft = useCallback(
    async (draftId: string) => {
      const who = planStoreIdentity() ?? '';
      try {
        const r = await postJson<{
          error?: string;
          planVersion?: number;
          sessionsChanged?: number;
          durable?: boolean;
          applied?: PublishedMove[];
        }>('/api/plan/publish', { draftId, publishedBy: who || 'unbekannt' });
        if (r.error) {
          setPublishNote(t(`draft.publishErr.${r.error}`));
          await refreshDrafts();
          return;
        }
        const stored = await persistPublished(r.applied ?? []);
        setPublishNote(
          t(stored ? 'draft.publishedNote' : 'draft.publishedNoteVolatile', {
            count: String(r.sessionsChanged ?? 0),
            version: String(r.planVersion ?? 0),
          })
        );
        // Publishing consumes the draft and supersedes every other one, so the whole week has to
        // be re-read: the rows underneath the view have changed, not just which overlay is shown.
        setActiveDraft(null);
        setApplied(null);
        await refreshDrafts();
        await load(key);
      } catch {
        setPublishNote(t('draft.publishErr.request'));
      }
    },
    [key, load, persistPublished, refreshDrafts, t]
  );

  /**
   * Publish only the saved changes the planner ticked.
   *
   * ⚠️ NO `replay` FLAG HERE, AND THAT IS THE WHOLE POINT. The replay path exists to rebuild a
   * plan that was already accepted and skips the conflict check; this is a NEW decision about what
   * the plan should be, so it goes through the same gate as publishing a draft. Selecting part of
   * a cascade is precisely the case that needs it — two moves of a three-move repair can reopen
   * the clash the third was closing, and the server is the only thing that can see that.
   */
  const publishSelectedChanges = useCallback(async () => {
    const picked = (changes ?? []).filter((m) => selectedChanges.includes(m.sessionId));
    if (!picked.length) return;
    const who = planStoreIdentity() ?? '';
    try {
      const r = await postJson<{
        error?: string;
        planVersion?: number;
        sessionsChanged?: number;
        applied?: PublishedMove[];
      }>('/api/plan/publish', {
        moves: picked.map((m) => ({
          sessionId: m.sessionId,
          slotId: m.slotId,
          roomId: m.roomId,
        })),
        publishedBy: who || 'unbekannt',
      });
      if (r.error) {
        setPublishNote(t(`draft.publishErr.${r.error}`));
        return;
      }
      const stored = await persistPublished(r.applied ?? []);
      setPublishNote(
        t(stored ? 'draft.publishedNote' : 'draft.publishedNoteVolatile', {
          count: String(r.sessionsChanged ?? 0),
          version: String(r.planVersion ?? 0),
        })
      );
      setSelectedChanges([]);
      setActiveDraft(null);
      setApplied(null);
      await refreshDrafts();
      await load(key);
    } catch {
      setPublishNote(t('draft.publishErr.request'));
    }
  }, [changes, key, load, persistPublished, refreshDrafts, selectedChanges, t]);

  /**
   * Delete saved changes outright — the only thing that makes them not come back.
   *
   * ⚠️ DISCARDING A DRAFT AND DELETING A CHANGE ARE DIFFERENT ACTS AND THIS IS THE OTHER ONE.
   * Discard drops the working copy; the decision stays in the store and returns on the next load,
   * which is correct — saving meant something. This removes the decision itself, so the plan goes
   * back to what the dataset says.
   *
   * ⚠️ IT DOES NOT REVERT A PUBLISHED PLAN. If those sessions were published, the plan of record
   * still holds them; only the history goes. `planStore.deletePlanChanges` says why, and the note
   * below says it to the planner rather than letting them infer it from a number that did not move.
   */
  const deleteSelectedChanges = useCallback(async () => {
    if (!selectedChanges.length || !aoiSchedulerSite) return;
    const outcome = await deletePlanChanges(aoiSchedulerSite, selectedChanges);
    if (outcome.status !== 'deleted') {
      setPublishNote(t(`calendar.deleteErr.${outcome.status}`));
      return;
    }
    setPublishNote(
      t('calendar.deleted', {
        rows: String(outcome.rows ?? 0),
        sessions: String(outcome.sessions ?? 0),
      })
    );
    setSelectedChanges([]);
    // The draft was built FROM these rows, so it now describes a plan nobody saved. Drop it and
    // let the refresh rebuild from whatever is genuinely left.
    restoreSuppressed.current = false;
    setActiveDraft(null);
    setApplied(null);
    const left = await currentPlanMoves(aoiSchedulerSite);
    onChangesChanged?.(left);
    await refreshDrafts();
    await load(key);
  }, [aoiSchedulerSite, key, load, onChangesChanged, refreshDrafts, selectedChanges, t]);

  /**
   * Everything back to the plan as shipped.
   *
   * ⚠️ IT TAKES THREE ACTS AND DOING TWO IS WHAT CAUSED THE CONFUSION THIS EXISTS FOR. Drafts and
   * the published plan live in the BACKEND's memory; `PlanChanges` is a log the app replays; and
   * `PlanAssignments` is the state it reads. Truncating one table by hand leaves the drafts
   * untouched and the other table still holding `change`/`published` rows — measured: 4 and 1
   * survived exactly that — so the app looked like it had ignored the delete.
   *
   * ⚠️ THE ORDER IS THE POINT, AND IT IS NOT THE OBVIOUS ONE. The dirty sessions must be read
   * BEFORE the reset (afterwards the client would still see them, but nothing would say where
   * they belong), the server must reload the baked dataset BEFORE it can answer with their
   * shipped positions, and only then may the store be rewritten. The earlier order — clear the
   * store, then reset the server — deleted the sessions' only rows and left the timetable three
   * sessions short, because the state table keeps ONE row per session rather than a baseline row
   * plus an override. A reset that loses data is not a reset.
   */
  const resetEverything = useCallback(async () => {
    if (!aoiSchedulerSite) return;
    const dirty = await dirtyAssignmentSessions(aoiSchedulerSite);
    let baseline: BaselinePosition[] = [];
    let unknown: string[] = [];
    let draftsDropped = 0;
    try {
      const r = await postJson<{
        draftsDropped?: number;
        baseline?: BaselinePosition[];
        unknownSessions?: string[];
      }>('/api/plan/reset', { sessionIds: dirty });
      baseline = r.baseline ?? [];
      unknown = r.unknownSessions ?? [];
      draftsDropped = r.draftsDropped ?? 0;
    } catch {
      setPublishNote(t('draft.publishErr.request'));
      return;
    }
    const cleared = await clearPlanStore(aoiSchedulerSite, baseline, unknown);
    if (cleared.status !== 'deleted' && cleared.status !== 'not-configured') {
      setPublishNote(t(`calendar.deleteErr.${cleared.status}`));
      return;
    }
    setPublishNote(
      t('calendar.reset', {
        rows: String(cleared.rows ?? 0),
        drafts: String(draftsDropped),
      })
    );
    restoreSuppressed.current = false;
    setSelectedChanges([]);
    setActiveDraft(null);
    setApplied(null);
    onChangesChanged?.([]);
    await refreshDrafts();
    await load(key);
  }, [aoiSchedulerSite, key, load, onChangesChanged, refreshDrafts, t]);

  // Fetch the diff when a proposal arrives, and point the week at whoever it affects most. A
  // preview that leaves the planner looking at an unrelated week would be a preview of nothing.
  useEffect(() => {
    if (!proposalId || !schedulerConfigured()) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setApplied(null);
    getJson<ProposalDiff>(`/api/proposal/${proposalId}`, { option: String(option) })
      .then((d) => {
        if (cancelled || d.error) return;
        setDiff(d);

        // ⚠️ THE MOST AFFECTED LECTURER, not `affects.teachers[0]`. That list is sorted by id, so
        // "whoever it affects most" was whoever sorted first — the comment claimed a judgement the
        // code never made.
        const count = new Map<string, number>();
        for (const c of d.changes) {
          if (c.teacherId) count.set(c.teacherId, (count.get(c.teacherId) ?? 0) + 1);
        }
        const teacher = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          ?? d.affects.teachers[0];
        if (!teacher) return;

        // ⚠️ THE HAND-OVER IS WHAT MAKES THIS STICK. Setting the key alone loses the race: the
        // drawer OPENS when a proposal arrives, which restarts the suggestions fetch, and that
        // resolves after this and falls back to `subjects[0]` — the busiest lecturer. So the
        // preview ended up drawn into the wrong person's week, which is the exact failure
        // `requested` was introduced for when the quality lens hit it. Set both: the ref for the
        // suggestions round that is still in flight, the key for when none is.
        // The key is what actually moves the week, and removing it fails the preview test.
        //
        // ⚠️ `requested` is DEFENSIVE and is NOT covered by a test — sabotaging this line alone
        // leaves the suite green, so do not read it as verified. It guards the case where the
        // drawer OPENS as the proposal arrives: that restarts the suggestions fetch, which
        // resolves after this and falls back to `subjects[0]`, the busiest lecturer. That is the
        // same overwrite the quality lens hit, and `requested` is the hand-over built for it.
        requested.current = { scope: 'teacher', key: teacher };
        setScope('teacher');
        setKey(teacher);
        setTab('week');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [proposalId, option]);

  const confirm = useCallback(async () => {
    if (!proposalId || !diff) return;
    setApplying(true);
    setError(null);
    try {
      // `confirmedBy` is required by the server. It is sent from the click handler rather than
      // defaulted anywhere, because a confirmation nobody had to give is not a confirmation.
      const draft = await postJson<AppliedDraft>('/api/draft/apply', {
        proposalId,
        option,
        confirmedBy: 'Planer:in (UI)',
      });
      if (draft.error) {
        // Same rule as the week fetch: the server's English prose goes to the console, the reader
        // gets a sentence in their own language.
        console.warn(`draft apply: ${draft.error} — ${draft.message ?? ''}`);
        setError(t('calendar.errApply'));
      } else {
        setApplied(draft);
        onApplied?.(draft);

        // ⚠️ KEEP IT SOMEWHERE THAT SURVIVES. The draft above lives in a module-level dict inside a
        // container that scales to zero, so until this line the confirmed change was gone the
        // moment the service went idle — and came back looking like it had never been made.
        //
        // Deliberately AFTER the draft is applied and never in its way: the store needs a Fabric
        // session, which does not exist on a laptop or under Playwright. A failure here must not
        // undo or block a confirmation the planner already made; it only changes what the panel is
        // allowed to CLAIM about it.
        const rows = (diff?.changes ?? []).map((c) => ({
          // ⚠️ `schedulerSite` ('oth'), NOT `aoiId` ('oth-regensburg'). THE TWO ARE DIFFERENT
          // STRINGS AND THE WRITE USED TO DISAGREE WITH EVERY READER. `currentPlanMoves` below
          // asks with `schedulerSite`, and `seed_plan_assignments.py` seeds with it, so rows
          // written under the AOI id were stored, reported as saved, and then never found again:
          // a confirmed move silently vanished on reload.
          site: aoiSchedulerSite ?? '',
          sessionId: c.sessionId,
          course: c.course ?? c.sessionId,
          fromSlotId: c.from.slotId ?? '',
          toSlotId: c.to.slotId ?? '',
          roomId: c.to.roomId ?? '',
          // A repair option only exists because the solver found it FEASIBLE, and feasible means
          // no hard conflict — that is the solver's contract, not an assumption about this run.
          legal: true,
          // Machine-readable on purpose. The entity keeps the verdict AS IT STOOD, and prose
          // would freeze it in whichever language happened to be on screen.
          verdict: `solver;option=${option};cost=${diff?.cost ?? ''};optimalityProven=${diff?.optimalityProven ?? ''}`,
          conflictCount: 0,
        }));
        setPendingRows(rows);
        void savePlanChanges(rows).then(setSaveOutcome);

        /*
         * ⚠️ AND THE PLAN ITSELF, not only the decision. The change log records that a session
         * moved; it cannot answer "where is this session now" without being replayed, so a reader
         * outside the app — Power BI, a Data Agent, a SQL editor — saw the edits and never the
         * timetable. Every confirmed move therefore also upserts the session's CURRENT position,
         * keyed on site+sessionId so a session moved repeatedly leaves one row rather than a pile.
         *
         * Same rule as the line above: this is additive and must never block a confirmation the
         * planner already made. It reports rather than throws.
         */
        void (async () => {
          const identity = planStoreIdentity();
          if (!identity) return; // no session: the write would be refused anyway, and saying so is savePlanChanges' job
          const assignments = (diff?.changes ?? []).map((c) => ({
            // Same key as the change log above and as the baseline seed. `assignmentId` hashes
            // site+sessionId, so the AOI id here produced a DIFFERENT id from the baseline row
            // for the same session — the upsert inserted a duplicate instead of moving the
            // session, which is the opposite of what this block exists to do.
            site: aoiSchedulerSite ?? '',
            sessionId: c.sessionId,
            // The proposal diff does not carry a course id. Left empty here rather than parsed out
            // of the session id, which would be a guess; the baseline seed fills it, and the
            // narrower update in `savePlanAssignments` means this empty value never overwrites it.
            courseId: '',
            course: c.course ?? c.sessionId,
            teacherId: c.teacherId ?? '',
            cohortId: c.cohortId ?? '',
            slotId: c.to.slotId ?? '',
            roomId: c.to.roomId ?? '',
            buildingId: c.to.buildingId ?? '',
            campusId: c.to.campusId ?? '',
            frozen: false,
            // Not reproducible from the baked dataset — this row IS the record of where it sits.
            source: 'change',
          }));
          const outcome = await savePlanAssignments(assignments, identity);
          if (outcome.failed) {
            console.warn(`plan assignments: ${outcome.failed} of ${assignments.length} did not land`);
          }
        })();

        // Switch the grid ONTO the draft rather than fetching it once. Making it the active view
        // is what lets the planner keep browsing — other teachers, other rooms — and still see
        // their confirmed change.
        setActiveDraft(draft.draftId);
        void refreshDrafts();
        // ⚠️ Drop the overlay once it has been applied. The draft now CONTAINS these sessions, so
        // leaving the dashed "arriving" ghosts up drew each moved session twice — once as the real
        // booking and once as a prediction of itself. A preview that outlives the thing it was
        // predicting stops being a preview and becomes a duplicate.
        setDiff(null);
      }
    } catch (err) {
      const failure = requestError(err);
      setError(t(failure.key, failure.values));
    } finally {
      setApplying(false);
    }
  }, [proposalId, diff, option, onApplied, refreshDrafts, aoiSchedulerSite, t]);

  // slotId → what the proposal does to it, so a cell can draw its own change without scanning.
  //
  // A hand-dragged move joins the same two maps rather than getting a visual language of its own:
  // a planner judging "what happens if this lecture moves" is asking the identical question
  // whether the suggestion came from the solver or from their own hand, and the hole left behind
  // is the part they most need to see.
  const leaving = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (slotId: string, sessionId: string) => {
      const list = map.get(slotId);
      if (list) list.push(sessionId);
      else map.set(slotId, [sessionId]);
    };
    for (const change of diff?.changes ?? []) {
      if (change.from.slotId) add(change.from.slotId, change.sessionId);
    }
    if (move) add(move.fromSlotId, move.sessionId);
    return map;
  }, [diff, move]);

  const arriving = useMemo(() => {
    const map = new Map<string, ProposalDiff['changes']>();
    const add = (slotId: string, change: ProposalDiff['changes'][number]) => {
      const list = map.get(slotId);
      if (list) list.push(change);
      else map.set(slotId, [change]);
    };

    // ⚠️ A GHOST MAY ONLY APPEAR IN A WEEK IT BELONGS TO. Without this the preview drew every moved
    // session into whatever week happened to be open: a cascade about Prof. Hinterberger put four
    // of his lectures into Prof. Kellermann's week as "arriving", and struck nothing through,
    // because his Friday sessions were never in that week to begin with. Four lectures that are
    // not yours, appearing in your week, presented as a consequence of the plan.
    //
    // Relevance is judged per scope, and the asymmetry is deliberate. A session keeps its lecturer
    // and its cohort when it moves, so for those scopes a visible arrival always has a visible
    // departure. A ROOM is what the move changes, so an arrival into the room being examined is
    // exactly what its week should show even though the departure belongs to another room's week.
    const belongsHere = (change: ProposalDiff['changes'][number]) => {
      if (scope === 'teacher') return change.teacherId === key;
      if (scope === 'cohort') return change.cohortId === key;
      return change.to.roomId === key;
    };

    for (const change of diff?.changes ?? []) {
      if (change.to.slotId && belongsHere(change)) add(change.to.slotId, change);
    }
    if (move) {
      // Not filtered: a hand-dragged move was made IN this view, by this planner, a moment ago.
      add(move.toSlotId, {
        sessionId: move.sessionId,
        course: move.course,
        teacherId: null,
        cohortId: null,
        attendance: null,
        from: { slotId: move.fromSlotId, roomId: null, buildingId: null, campusId: null },
        to: { slotId: move.toSlotId, roomId: move.roomId, buildingId: null, campusId: null },
        slotChanged: true,
        roomChanged: false,
        campusChanged: false,
      });
    }
    return map;
  }, [diff, move, scope, key]);

  // slotId → the sessions in it. Several is normal (parallel groups).
  const bySlot = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data?.entries ?? []) {
      const list = map.get(entry.slotId);
      if (list) list.push(entry);
      else map.set(entry.slotId, [entry]);
    }
    return map;
  }, [data]);

  const availability = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of data?.availability ?? []) map.set(a.slotId, a.state);
    return map;
  }, [data]);

  const slotAt = useCallback(
    (day: string, block: number) =>
      data?.slots.find((s) => s.day === day && s.block === block) ?? null,
    [data]
  );

  /**
   * Ask the server what a move would do. Nothing here writes.
   */
  const check = useCallback(async (next: PendingMove) => {
    setChecking(true);
    setCheckFailed(false);
    try {
      // The published plan's own conflicts, fetched once. The verdict is a DIFFERENCE — see
      // planner/moveCheck.ts — so that a problem elsewhere on campus never reddens this drag.
      baseline.current ??= await checkMoves([]);
      const after = await checkMoves([
        { sessionId: next.sessionId, slotId: next.toSlotId, roomId: next.roomId },
      ]);
      setVerdict(verdictFor(next.sessionId, baseline.current, after));
    } catch (err) {
      // ⚠️ A FAILED CHECK MUST NOT LOOK LIKE A SLOW ONE. Leaving `verdict` null rendered the same
      // "Checking …" line for ever, so a genuine bug read as a slow network and cost a debugging
      // session. An unanswerable move says so.
      setVerdict(null);
      setCheckFailed(true);
      const failure = requestError(err);
      setError(t(failure.key, failure.values));
    } finally {
      setChecking(false);
    }
  }, [t]);

  const drop = useCallback(
    (toSlotId: string) => {
      const sessionId = dragging.current;
      if (!sessionId) return;
      const entry = data?.entries.find((e) => e.sessionId === sessionId);
      if (!entry || entry.slotId === toSlotId) return;
      // A frozen session is frozen. Refusing the drop outright is clearer than accepting it and
      // explaining afterwards why it cannot happen.
      if (entry.frozen) return;
      const next: PendingMove = {
        sessionId,
        fromSlotId: entry.slotId,
        toSlotId,
        roomId: entry.roomId ?? '',
        course: entry.course ?? entry.courseId ?? sessionId,
      };
      setMove(next);
      void check(next);
    },
    [data, check]
  );

  const retarget = useCallback(
    (roomId: string) => {
      if (!move) return;
      const next = { ...move, roomId };
      setMove(next);
      void check(next);
    },
    [move, check]
  );

  /** "Mo 3. Block" rather than "MO-3" — the grid says one thing and the bar should not say another. */
  const slotLabel = useCallback(
    (slotId: string) => {
      const slot = data?.slots.find((s) => s.slotId === slotId);
      return slot ? `${slot.day} ${slot.startTime}` : slotId;
    },
    [data]
  );

  /**
   * Rooms the planner may move a session into.
   *
   * ⚠️ DRAWN FROM THE WEEK ON SCREEN, not from a room catalogue. The app has no endpoint listing
   * every room with its capacity and type, and offering all 2 094 of OTH's would be a list nobody
   * can use — most are offices. The rooms this subject already teaches in are the ones a planner
   * actually reaches for, and any choice is checked by the server anyway, so a wrong one is
   * refused with a reason rather than silently accepted.
   */
  const roomChoices = useMemo(() => {
    const rooms = new Set<string>();
    if (move?.roomId) rooms.add(move.roomId);
    for (const entry of data?.entries ?? []) if (entry.roomId) rooms.add(entry.roomId);
    return [...rooms].sort();
  }, [data, move]);

  /**
   * The suggestions, plus whatever is actually being shown.
   *
   * ⚠️ `/api/calendar/suggestions` returns only the busiest handful. A subject chosen elsewhere —
   * a cohort picked in the plan-quality lens, a lecturer in the staffing lens — is often not among
   * them, and a `<select>` whose value matches no option renders BLANK. The week was correct and
   * the control above it looked empty, which reads as a broken panel.
   */
  const optionSubjects = useMemo(() => {
    if (!key || subjects.some((s) => s.id === key)) return subjects;
    return [
      { id: key, name: data?.subject?.name ?? key, sessions: data?.entries.length ?? 0 },
      ...subjects,
    ];
  }, [subjects, key, data]);

  /**
   * The picker's own order and filter.
   *
   * ⚠️ SORTED HERE, NOT AT THE SOURCE. `/api/calendar/suggestions` returns busiest-first and must
   * keep doing so — a Python test asserts it, and the panel falls back to `subjects[0]` meaning
   * "the one with the most teaching". That order is right for *choosing a default* and wrong for
   * *finding a name*:*G 6* landed between *G 11* and *G 2* on screen, which reads as a bug. So the
   * API contract is left alone and only the rendered list is reordered.
   *
   * `numeric: true` is the point — a plain `localeCompare` sorts "Raum 10" before "Raum 9".
   *
   * ⚠️ THE SELECTED SUBJECT IS ALWAYS KEPT, whatever the query. `optionSubjects` above exists
   * because a `<select>` whose value matches no option renders BLANK; filtering it would
   * reintroduce exactly that bug the moment someone typed. Filtering hides other people's names,
   * never your own selection.
   */
  const [subjectQuery, setSubjectQuery] = useState('');

  const visibleSubjects = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const sorted = [...optionSubjects].sort((a, b) =>
      collator.compare(a.name ?? a.id, b.name ?? b.id)
    );
    const needle = subjectQuery.trim().toLocaleLowerCase();
    if (!needle) return sorted;
    return sorted.filter(
      (s) =>
        s.id === key ||
        (s.name ?? s.id).toLocaleLowerCase().includes(needle) ||
        s.id.toLocaleLowerCase().includes(needle)
    );
  }, [optionSubjects, subjectQuery, key]);

  if (!open) return null;

  const days = data?.days ?? ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
  const blocks = data?.blocks ?? [1, 2, 3, 4, 5, 6, 7];

  if (mismatch) {
    // Deliberately before the grid: nothing here should try to load a week that can only come
    // back empty, and the lens buttons that open this drawer must still lead somewhere truthful.
    return (
      <section
        data-testid="calendar-panel"
        className="absolute inset-x-0 bottom-0 z-30 flex max-h-64 flex-col border-t border-stone-700 bg-stone-900/95 p-3 backdrop-blur"
      >
        <button
          type="button"
          data-testid="calendar-close"
          onClick={onClose}
          title={t('calendar.hide')}
          className="absolute right-2 top-2 rounded px-2 py-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          <span aria-hidden>✕</span>
          <span className="sr-only">{t('calendar.hide')}</span>
        </button>
        <SiteMismatchNotice serving={mismatch.serving} expected={mismatch.expected} />
      </section>
    );
  }

  return (
    <section
      ref={frameRef}
      data-testid="calendar-panel"
      style={{ height }}
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col border-t border-stone-700 bg-stone-900/95 backdrop-blur"
    >
      {/*
        ⚠️ The drawer used to be pinned at max-h-[58vh]. Five days by seven blocks is exactly the
        kind of grid people want to make bigger to read and smaller to get out of the way, and a
        constant decided that for them. It is now dragged, and it can go to the full height of the
        campus view — a week plan someone is working through is allowed to be the whole screen.
      */}
      <ResizeHandle
        axis="y"
        testId="calendar-resize"
        label={t('resize.calendar')}
        value={height}
        min={CALENDAR_MIN}
        max={availableHeight}
        onChange={setHeight}
        growKey="ArrowUp"
        measure={(event) => {
          const bottom = frameRef.current?.parentElement?.getBoundingClientRect().bottom ?? 0;
          return bottom - event.clientY;
        }}
        presets={[
          { size: (available) => Math.round(available * 0.35), labelKey: 'compact' },
          { size: (available) => Math.round(available / 2), labelKey: 'half' },
          { size: (available) => available, labelKey: 'full' },
        ]}
        format={(value, available) =>
          `${Math.round(value)} px · ${Math.round((value / Math.max(available, 1)) * 100)}%`
        }
        className="absolute inset-x-0 -top-0.5 z-40"
      />

      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-700 px-4 py-2">
        {/*
          ⚠️ TABS, NOT A SECOND DRAWER. The readout and the week are two views of one question, and
          giving each its own panel would cost the campus another slice of screen while still
          leaving the planner to hold both in their head. One drawer, one resize handle, one close
          button — and the second tab carries the LENS'S OWN NAME, because "Auswertung" beside
          "Kalender" says which is which and nothing about what you would find there.
        */}
        {detail ? (
          <div className="flex items-center gap-0.5" data-testid="drawer-tabs">
            {(
              [
                ['week', t('calendar.tabWeek')],
                ['detail', detailLabel || t('calendar.tabDetail')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`drawer-tab-${id}`}
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`rounded px-2.5 py-1 text-xs uppercase tracking-[0.14em] transition ${
                  tab === id
                    ? 'bg-stone-800 font-semibold text-amber-400'
                    : 'text-stone-500 hover:text-stone-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="text-xs uppercase tracking-[0.18em] text-amber-400">
            {t('calendar.heading')}
          </h2>
        )}

        {/*
          ⚠️ SAY WHEN THE WEEK IS REAL. This app badges what it invents everywhere else, which
          silently implies the reverse is unremarkable — and for TUM Garching the week on screen is
          TUMonline's own, 1 470 published bookings. That is the strongest claim anything here
          makes and it had no way of being made. Emerald rather than amber on purpose: every other
          provenance badge in this app warns, and this one does the opposite.
        */}
        {timetableReal && (
          <span
            data-testid="timetable-real"
            className="rounded border border-emerald-500/60 bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.14em] text-emerald-300"
          >
            {t('calendar.realTimetable')}
          </span>
        )}

        {/*
          ⚠️ AND THE PRICE OF A REAL EXPORT, BESIDE THE BADGE THAT BOASTS ABOUT IT. A published
          timetable is stronger evidence than a generated one AND it is less complete: it names
          lecturers by an Untis code, books rooms this project cannot draw inside, and states no
          capacities. Putting the two next to each other is deliberate — a green "echte Daten"
          badge with nothing qualifying it invites exactly the questions we cannot answer, and
          being asked "how many seats does that room have?" in front of a customer is a worse
          moment than having said so first.
        */}
        {sourceNotes.length > 0 && (
          <span
            data-testid="source-limits"
            title={sourceNotes.join(' · ')}
            className="rounded border border-stone-600 px-2 py-0.5 text-[0.65rem] text-stone-400"
          >
            {sourceNotes.length === 1 ? sourceNotes[0] : t('calendar.srcSummary', { count: String(sourceNotes.length) })}
          </span>
        )}

        {/* The week's own controls are meaningless while the readout is showing. */}
        {tab === 'week' && (
          <>
        <div className="flex gap-1">
          {/*
            ⚠️ DO NOT OFFER A SCOPE THAT IS ALWAYS REFUSED. Where the lecturers are invented over
            real teaching the server declines every teacher lookup — correctly — and the button
            stayed, as the DEFAULT scope, so the week opened on an explanation instead of a
            timetable and read as broken. This repo has shipped a visible-but-dead control twice
            before; an absent one with a reason is the honest version.
          */}
          {SCOPES.filter((s) => s !== 'teacher' || lecturerLookup).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`calendar-scope-${s}`}
              onClick={() => setScope(s)}
              className={`rounded px-2 py-1 text-xs transition ${
                scope === s
                  ? 'bg-stone-700 text-stone-50'
                  : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
              }`}
            >
              {t(`calendar.scope.${s}`)}
            </button>
          ))}
        </div>

        {/*
          ⚠️ A FILTER, NOT A COMBOBOX. The picker stays a real `<select>`: it keeps native keyboard
          handling, it keeps working on a touch device, and the suite asserts against its value and
          its checked option. The search box narrows what the select offers instead of replacing
          it — the smallest change that makes ~90 lecturers findable by typing.
        */}
        <input
          type="search"
          data-testid="calendar-subject-search"
          value={subjectQuery}
          onChange={(event) => setSubjectQuery(event.target.value)}
          placeholder={t('calendar.searchSubject')}
          aria-label={t('calendar.searchSubject')}
          aria-controls="calendar-subject"
          className="w-32 rounded border border-stone-600 bg-stone-800 px-2 py-1 text-xs text-stone-100 placeholder:text-stone-500"
        />

        <select
          id="calendar-subject"
          data-testid="calendar-subject"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="max-w-[22rem] rounded border border-stone-600 bg-stone-800 px-2 py-1 text-xs text-stone-100"
        >
          {visibleSubjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id} · {s.sessions}
            </option>
          ))}
        </select>

        {/* A query that matches nothing must say so, or the select just looks short. */}
        {subjectQuery.trim() && visibleSubjects.length <= 1 && (
          <span data-testid="calendar-subject-nomatch" className="text-xs text-stone-500">
            {t('calendar.noSubjectMatch')}
          </span>
        )}

        {data && (
          <span className="text-xs text-stone-400">
            {t('calendar.booked', {
              booked: String(data.bookedSlots),
              total: String(data.slots.length),
            })}
          </span>
        )}
        {/*
          Waiting on `/api/health` looks exactly like waiting on the week, because it IS a wait on
          the same scale-to-zero container. Saying nothing here left the grid blank and unexplained
          for the twenty seconds the backend takes to wake.
        */}
        {(loading || !siteKnown) && (
          <span className="text-xs text-stone-500">{t('calendar.loading')}</span>
        )}

        {/*
          ⚠️ THE PRODUCT'S OWN QUESTION, ON A BUTTON. "A professor drops Friday — what now?" is the
          cascade this whole system was built for, and until now the only way to ask it was to type
          a German sentence at the assistant. That made the core capability look like a chat trick
          rather than a planning tool, and it hid it from anyone who did not already know to ask.
          The button calls the SAME two tools the agent calls and produces the same confirmable
          proposal, so nothing here is a shortcut around the confirm gate.

          Lecturers only: a cohort or a room cannot "become unavailable" in a way the solver models.
        */}
        {scope === 'teacher' && data?.subject?.id && !mismatch && (
          <div className="flex items-center gap-1" data-testid="replan-bar">
            <span className="text-[0.65rem] uppercase tracking-wider text-stone-500">
              {t('replan.label')}
            </span>
            {(data.days ?? []).map((day) => (
              <button
                key={day}
                type="button"
                data-testid={`replan-${day}`}
                disabled={replanning !== null}
                onClick={() => void replan(day)}
                title={t('replan.hint', { day })}
                className="rounded border border-stone-600 px-1.5 py-0.5 text-[0.68rem] text-stone-200 transition hover:border-amber-400 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {day}
              </button>
            ))}
            {replanning && (
              <span className="text-[0.65rem] text-stone-400">
                {t('replan.working', { day: replanning })}
              </span>
            )}
          </div>
        )}

        {/*
          Which plan is on screen. "Veröffentlicht" is a real choice rather than the absence of a
          draft, because comparing against it is the reason a draft exists — and because a grid
          that silently shows something other than the published plan is a trap.
        */}
        {restoredCount !== null && restoredCount > 0 && (
          /*
           * ⚠️ SAY THAT THE PLAN CAME BACK. The grid opening on a restored draft looks exactly like
           * the grid opening on the baseline, and a planner who was not told would have no way to
           * know whether last week's decisions had survived — which is the precise uncertainty the
           * store was built to remove.
           */
          <p data-testid="draft-restored" className="text-xs text-stone-400">
            {t('draft.restored').replace('{{count}}', String(restoredCount))}
          </p>
        )}

        {/*
          ⚠️ THE OUTCOME OF THE ONE IRREVERSIBLE-LOOKING ACTION IN THE APP. It carries both the
          success and the two refusals, because the button appearing to work while the plan did
          not move is the failure mode worth spending a line of UI on.
        */}
        {publishNote && (
          <p data-testid="publish-note" className="text-xs text-amber-200">
            {publishNote}
          </p>
        )}

        {drafts.length > 0 && (
          <div data-testid="draft-switch" className="flex items-center gap-1">
            <button
              type="button"
              data-testid="draft-published"
              onClick={() => setActiveDraft(null)}
              className={`rounded px-2 py-1 text-xs transition ${
                activeDraft === null
                  ? 'bg-stone-700 text-stone-50'
                  : 'text-stone-400 hover:bg-stone-800 hover:text-stone-100'
              }`}
            >
              {t('draft.published')}
            </button>
            {drafts.map((d) => (
              <span key={d.draftId} className="flex items-center">
                <button
                  type="button"
                  data-testid={`draft-${d.draftId}`}
                  onClick={() => setActiveDraft(d.draftId)}
                  title={t('draft.confirmedBy', { who: d.confirmedBy })}
                  className={`rounded px-2 py-1 text-xs transition ${
                    activeDraft === d.draftId
                      ? 'bg-emerald-600/40 text-emerald-100'
                      : 'text-emerald-300/70 hover:bg-emerald-600/20'
                  }`}
                >
                  {d.label} · {d.sessionsChanged}
                </button>
                {/*
                  ⚠️ THE ONLY CONTROL IN THIS APP THAT CHANGES WHAT EVERYONE ELSE SEES. Every other
                  button here works on an overlay; this one replaces the plan underneath it, for
                  the calendar, the conflict counts and the solver alike. It is deliberately not
                  styled like the neighbouring draft buttons, and it names the author, because an
                  unattributed publish is refused by the server anyway.
                */}
                <button
                  type="button"
                  data-testid={`draft-publish-${d.draftId}`}
                  onClick={() => void publishDraft(d.draftId)}
                  title={t('draft.publishHint')}
                  className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-[0.7rem] font-medium text-amber-200 hover:bg-amber-500/20"
                >
                  {t('draft.publish')}
                </button>
                <button
                  type="button"
                  data-testid={`draft-discard-${d.draftId}`}
                  onClick={() => void discardDraft(d.draftId)}
                  title={t('draft.discard')}
                  className="rounded px-1 text-stone-500 hover:text-red-300"
                >
                  <span aria-hidden>✕</span>
                  <span className="sr-only">{t('draft.discard')}</span>
                </button>
              </span>
            ))}
          </div>
        )}
          </>
        )}

        <button
          type="button"
          data-testid="calendar-close"
          onClick={onClose}
          title={t('calendar.hide')}
          className="ml-auto rounded px-2 py-1 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
        >
          <span aria-hidden>✕</span>
          <span className="sr-only">{t('calendar.hide')}</span>
        </button>
      </header>

      {/*
        The readout, when its tab is chosen. Rendered INSTEAD of the week rather than beside it: the
        drawer is one height, and two scrolling panes inside it would give each half a strip too
        short to read.
      */}
      {tab === 'detail' && detail && (
        <div data-testid="drawer-detail" className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {detail}
        </div>
      )}

      {tab === 'week' && (
        <>
      {error && (
        <p data-testid="calendar-error" className="px-4 py-3 text-xs text-amber-300">
          {error}
        </p>
      )}

      {/*
        What a dragged session did — PLAN §6.2, the deterministic checker with no solver in it.

        ⚠️ THE VERDICT IS THE FEATURE, and it says one of three things: still checking, this breaks
        nothing, or this breaks these named things. What it never says is "saved", because nothing
        here is: the only endpoint that changes a plan takes a solver proposal id, so a hand-made
        move has nowhere to go. Showing a disabled save button would imply the gap is temporary;
        saying plainly that the move is a what-if is the honest version, and it is also what makes
        the feature safe to hand a stranger at a demo.
      */}
      {move && (
        <div
          data-testid="calendar-move"
          role="status"
          className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-xs ${
            checking || (!verdict && !checkFailed)
              ? 'border-stone-700 bg-stone-800/60 text-stone-200'
              : checkFailed
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                : verdict?.legal
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
                  : 'border-red-500/50 bg-red-500/10 text-red-100'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">{move.course}</span>
            <span className="opacity-80">
              {t('move.target', {
                from: slotLabel(move.fromSlotId),
                to: slotLabel(move.toSlotId),
              })}
            </span>

            {/* The other half of the request: a different ROOM, not only a different day. */}
            <label className="flex items-center gap-1">
              <span className="opacity-80">{t('move.room')}</span>
              <select
                data-testid="calendar-move-room"
                value={move.roomId}
                onChange={(event) => retarget(event.target.value)}
                className="rounded border border-stone-600 bg-stone-900 px-1 py-0.5 text-stone-100"
              >
                {roomChoices.map((room) => (
                  <option key={room} value={room}>
                    {room}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              data-testid="calendar-move-discard"
              onClick={() => {
                setMove(null);
                setVerdict(null);
              }}
              className="ml-auto rounded px-2 py-0.5 text-stone-300 underline-offset-2 hover:underline"
            >
              {t('move.discard')}
            </button>
          </div>

          <p data-testid="calendar-move-verdict" className="mt-1">
            {checking
              ? t('move.checking')
              : checkFailed
                ? t('move.checkFailed')
                : !verdict
                  ? t('move.checking')
                  : verdict.legal
                    ? t('move.legal')
                    : verdict.caused
                        .slice(0, 3)
                        .map((conflict) => {
                          const reason = conflictReason(conflict);
                          return t(reason.key, reason.values as Record<string, string | number>);
                        })
                        .join(' · ')}
          </p>
          <p className="mt-1 opacity-70">{t('move.notSaved')}</p>
        </div>
      )}

      {/*
        The confirm gate (PLAN §13.2/§13.4). Two properties are deliberate and both are visible
        here: "Verwerfen" is the cheap path — it writes nothing and needs no cleanup — and the
        confirm button NAMES what it will do. A button saying "OK" is not really a confirmation.
      */}
      {diff && !applied && (
        <div
          data-testid="proposal-bar"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2"
        >
          <span className="text-xs font-medium text-amber-200">
            {t('proposal.preview', { count: String(diff.sessionsMoved) })}
          </span>

          {diff.options.length > 1 && (
            <div className="flex gap-1">
              {diff.options.map((o) => (
                <button
                  key={o.option}
                  type="button"
                  data-testid={`proposal-option-${o.option}`}
                  onClick={() => setOption(o.option)}
                  className={`rounded px-2 py-0.5 text-[0.7rem] transition ${
                    option === o.option
                      ? 'bg-amber-500/30 text-amber-100'
                      : 'text-amber-200/70 hover:bg-amber-500/20'
                  }`}
                >
                  {t('proposal.option', {
                    n: String(o.option),
                    count: String(o.sessionsMoved),
                  })}
                </button>
              ))}
            </div>
          )}

          <span className="text-[0.7rem] text-amber-200/80">
            {diff.optimalityProven ? t('proposal.optimal') : t('proposal.bestInTime')}
          </span>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              data-testid="proposal-discard"
              onClick={() => setDiff(null)}
              className="rounded border border-stone-600 px-3 py-1 text-xs text-stone-300 transition hover:bg-stone-800"
            >
              {t('proposal.discard')}
            </button>
            <button
              type="button"
              data-testid="proposal-confirm"
              disabled={applying}
              onClick={() => void confirm()}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-ink transition hover:bg-amber-400 disabled:opacity-50"
            >
              {applying
                ? t('proposal.applying')
                : t('proposal.confirm', { count: String(diff.sessionsMoved) })}
            </button>
          </div>
        </div>
      )}

      {applied && (
        <div
          data-testid="proposal-applied"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200"
        >
          <span>
            {t('proposal.applied', {
              count: String(applied.sessionsChanged),
              label: applied.label,
            })}
          </span>
          {/* Stated, not implied. The published plan is what everyone else still sees. */}
          <span className="text-emerald-300/80">{t('proposal.publishedUntouched')}</span>

          {/*
            ⚠️ WHETHER IT WAS KEPT, said out loud. The whole point of the store is that confirmed
            work stops evaporating, and a planner cannot tell the difference between "saved" and
            "held in a container that is about to scale to zero" unless the app says which one it
            is. Silence here would be the original bug wearing a green banner.
          */}
          {saveOutcome && (
            <span
              data-testid="proposal-saved"
              data-outcome={saveOutcome.status}
              className={
                saveOutcome.status === 'saved' ? 'text-emerald-300/80' : 'text-amber-200'
              }
            >
              {saveOutcome.status === 'saved'
                ? t('proposal.saved', { who: saveOutcome.savedBy })
                : t('proposal.savedLocally')}
            </span>
          )}

          {/*
            ⚠️ SIGNING IN NEEDS ITS OWN CLICK, and that is the whole reason this button exists
            rather than the confirm handler just doing it. The Fabric broker ends in
            `window.open`, which a browser only permits inside a user gesture — and `confirm()`
            awaits the solver first, by which point the gesture is spent and the tab would be
            blocked silently. Offering it separately also means a confirmation never surprises
            anyone by opening a portal tab mid-decision.

            ⚠️ AND IT IS NEVER HIDDEN WITHOUT SAYING SO. The first version rendered nothing when
            `planStoreCanSignIn()` was false — which is exactly what happened in production, for
            months of wall-clock as far as the data was concerned: the Fabric ids were read under
            the wrong variable names, so the only route to a session silently did not exist and
            the honest "not saved" line looked like the expected state. A configuration fault has
            to be visible as a fault.
          */}
          {saveOutcome && saveOutcome.status !== 'saved' && pendingRows.length > 0 && (
            planStoreCanSignIn() ? (
              <button
                type="button"
                data-testid="proposal-save-now"
                disabled={signingIn}
                onClick={() => {
                  setSigningIn(true);
                  void signInAndSavePlanChanges(pendingRows)
                    .then(setSaveOutcome)
                    .finally(() => setSigningIn(false));
                }}
                className="rounded border border-amber-300/60 px-2 py-0.5 text-amber-100 transition hover:bg-amber-400/15 disabled:opacity-50"
              >
                {signingIn ? t('proposal.saving') : t('proposal.saveNow')}
              </button>
            ) : (
              <span data-testid="proposal-no-store" className="text-amber-200/70">
                {t('proposal.storeUnavailable')}
              </span>
            )
          )}
        </div>
      )}

      {/*
        ⚠️ TWO SCROLLERS, NOT ONE. The grid and the walks between appointments used to share a
        single scrolling body, so reading a walk meant scrolling the timetable row it refers to off
        the screen — and those two things only mean anything next to each other. Each pane now
        scrolls on its own and the handle between them decides how the drawer is divided.
      */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div
          data-testid="calendar-grid-pane"
          style={{ height: gridHeight }}
          className="min-h-0 shrink-0 overflow-auto p-3"
        >
        <table className="w-full border-separate border-spacing-1 text-[0.7rem]">
          <thead>
            <tr>
              <th className="w-16" />
              {days.map((day) => (
                <th key={day} className="pb-1 text-left uppercase tracking-wider text-stone-400">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const label = data?.slots.find((s) => s.block === block);
              return (
                <tr key={block}>
                  <th className="whitespace-nowrap pr-2 text-right align-top font-normal tabular-nums text-stone-500">
                    {label ? label.startTime : block}
                  </th>
                  {days.map((day) => {
                    const slot = slotAt(day, block);
                    const entries = slot ? (bySlot.get(slot.slotId) ?? []) : [];
                    const state = slot ? availability.get(slot.slotId) : undefined;
                    // Unavailability is drawn even where nothing is booked: an empty cell that the
                    // teacher cannot take is not a free slot, and colouring only bookings would
                    // invite exactly the wrong conclusion.
                    const blocked = state === 'nicht_verfuegbar';
                    const limited = state === 'eingeschraenkt';
                    return (
                      <td
                        key={day}
                        data-testid={slot ? `calendar-cell-${slot.slotId}` : undefined}
                        // A cell only accepts a drop if it IS a slot. `preventDefault` on dragOver
                        // is what makes it a target at all — without it the browser refuses the
                        // drop and the gesture dies silently with no cursor feedback.
                        onDragOver={slot ? (event) => event.preventDefault() : undefined}
                        onDrop={
                          slot
                            ? (event) => {
                                event.preventDefault();
                                drop(slot.slotId);
                              }
                            : undefined
                        }
                        className={`min-w-[7rem] rounded align-top ${
                          blocked
                            ? 'bg-stone-950/80 outline outline-1 outline-red-900/40'
                            : limited
                              ? 'bg-stone-800/40'
                              : 'bg-stone-800/20'
                        }`}
                      >
                        <div className="flex flex-col gap-1 p-1">
                          {entries.map((entry) => {
                            // A session that is about to leave stays VISIBLE, struck through. The
                            // hole a move creates is exactly what a planner needs to see, and
                            // simply removing the box would hide the consequence being judged.
                            const departing = slot
                              ? (leaving.get(slot.slotId) ?? []).includes(entry.sessionId)
                              : false;
                            return (
                              <button
                                key={entry.sessionId}
                                type="button"
                                data-testid={`calendar-entry-${entry.sessionId}`}
                                // ⚠️ A frozen session is not draggable, and says so by not moving.
                                // Letting it lift and then refusing the drop would teach the
                                // gesture and then break the lesson.
                                draggable={!entry.frozen}
                                onDragStart={(event) => {
                                  dragging.current = entry.sessionId;
                                  // Firefox starts no drag at all without payload on the transfer.
                                  event.dataTransfer.setData('text/plain', entry.sessionId);
                                  event.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => {
                                  dragging.current = null;
                                }}
                                onClick={() => entry.roomId && onSelectRooms?.([entry.roomId])}
                                title={entry.frozen ? t('move.frozen') : t('move.hint')}
                                className={`rounded border px-1.5 py-1 text-left leading-tight transition hover:brightness-125 ${kindClass(entry)} ${
                                  departing ? 'opacity-40 line-through' : ''
                                } ${entry.frozen ? '' : 'cursor-grab active:cursor-grabbing'}`}
                              >
                                <span className="block truncate font-medium">
                                  {entry.course ?? entry.courseId}
                                </span>
                                <span className="block truncate opacity-80">
                                  {entry.roomId}
                                  {scope !== 'cohort' && entry.cohort && !hideCohort
                                    ? ` · ${entry.cohort}`
                                    : ''}
                                  {scope === 'room' && entry.teacher && !hideTeacher
                                    ? ` · ${entry.teacher}`
                                    : ''}
                                </span>
                              </button>
                            );
                          })}

                          {/* Where the moved sessions would land. Outlined rather than filled, so
                              a proposal never looks like something that has already happened. */}
                          {slot &&
                            (arriving.get(slot.slotId) ?? []).map((change) => (
                              <div
                                key={`in-${change.sessionId}`}
                                data-testid={`calendar-arriving-${change.sessionId}`}
                                className="rounded border border-dashed border-amber-300 bg-amber-400/15 px-1.5 py-1 leading-tight text-amber-100"
                              >
                                <span className="block truncate font-medium">
                                  {change.course ?? change.sessionId}
                                </span>
                                <span className="block truncate opacity-90">
                                  {change.to.roomId} · ← {change.from.slotId}
                                </span>
                                {change.campusChanged && (
                                  <span className="mt-0.5 block text-[0.6rem] font-medium text-red-300">
                                    {t('proposal.campusChange')}
                                  </span>
                                )}
                              </div>
                            ))}

                          {!entries.length && blocked && (
                            <span className="px-1 py-0.5 text-[0.62rem] text-red-300/70">
                              {t('calendar.unavailable')}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <ResizeHandle
          axis="y"
          testId="calendar-split"
          label={t('resize.calendarSplit')}
          value={gridHeight}
          min={GRID_MIN}
          max={gridMax}
          onChange={setGridHeight}
          growKey="ArrowDown"
          /*
           * Measured against the drawer BODY, not the window: this pane is anchored to the top of
           * a box that is itself draggable, so a window-relative measure would drift by however
           * far down the screen the drawer currently starts.
           */
          measure={(event) => event.clientY - (bodyRef.current?.getBoundingClientRect().top ?? 0)}
        />

        <div data-testid="calendar-walks-pane" className="min-h-0 flex-1 overflow-auto px-3 pb-3">
          {/*
            Which of the two lower views is showing. The rail selects it from outside, and these
            tabs exist so the drawer still says what is in it when you got here another way.
          */}
          <div className="mb-2 flex items-center gap-0.5" data-testid="lower-pane-tabs">
            {(
              [
                ['walks', t('calendar.paneWalks')],
                ['changes', t('calendar.paneChanges')],
                ['availability', t('calendar.paneAvailability')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                data-testid={`lower-pane-${id}`}
                aria-pressed={lowerPane === id}
                onClick={() => onLowerPaneChange?.(id)}
                className={`rounded px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.14em] transition ${
                  lowerPane === id
                    ? 'bg-stone-800 font-semibold text-amber-400'
                    : 'text-stone-500 hover:text-stone-200'
                }`}
              >
                {label}
                {id === 'changes' && changes?.length ? ` (${changes.length})` : ''}
              </button>
            ))}
          </div>

          {lowerPane === 'changes' ? (
            <div data-testid="calendar-changes">
              {!changes?.length ? (
                <p className="text-xs text-stone-400">{t('calendar.noChanges')}</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-stone-400">{t('calendar.changesIntro')}</p>
                  {/*
                    ⚠️ ONE CHANGE AT A TIME IS A REAL REQUEST AND A REAL RISK. A planner may want
                    three of five saved changes in the plan of record. But a cascade is a COHERENT
                    SET — taking two moves of a three-move repair can reopen exactly the clash the
                    third one was closing — so the server re-checks whatever is selected against
                    the plan as it stands and refuses a selection that would make it worse. That
                    gate is what makes offering this safe; without it this control would be a way
                    to break the plan one tick-box at a time.
                  */}
                  <ul className="space-y-1">
                    {changes.map((move) => {
                      const picked = selectedChanges.includes(move.sessionId);
                      return (
                        <li
                          key={move.sessionId}
                          data-testid="calendar-change-row"
                          className="flex items-baseline gap-2 rounded bg-stone-800/50 px-2 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            data-testid={`change-pick-${move.sessionId}`}
                            checked={picked}
                            onChange={() =>
                              setSelectedChanges((prev) =>
                                prev.includes(move.sessionId)
                                  ? prev.filter((s) => s !== move.sessionId)
                                  : [...prev, move.sessionId]
                              )
                            }
                            aria-label={t('calendar.pickChange', { session: move.sessionId })}
                            className="mt-0.5 shrink-0 accent-amber-500"
                          />
                          <span className="font-mono text-amber-400">{move.slotId}</span>
                          <span className="truncate text-stone-300">{move.sessionId}</span>
                          {move.roomId && (
                            <span className="ml-auto shrink-0 font-mono text-stone-400">
                              {move.roomId}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="changes-publish-selected"
                      disabled={selectedChanges.length === 0}
                      onClick={() => void publishSelectedChanges()}
                      className="rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-transparent disabled:text-stone-600"
                    >
                      {t('calendar.publishSelected', { count: String(selectedChanges.length) })}
                    </button>
                    {selectedChanges.length > 0 && (
                      <button
                        type="button"
                        data-testid="changes-delete-selected"
                        onClick={() => void deleteSelectedChanges()}
                        className="rounded border border-red-500/50 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        {t('calendar.deleteSelected', { count: String(selectedChanges.length) })}
                      </button>
                    )}
                    {selectedChanges.length > 0 && (
                      <button
                        type="button"
                        data-testid="changes-clear-selection"
                        onClick={() => setSelectedChanges([])}
                        className="text-xs text-stone-500 hover:text-stone-300"
                      >
                        {t('calendar.clearSelection')}
                      </button>
                    )}
                  </div>
                </>
              )}
              {/*
                ⚠️ THE NOTE AND THE RESET LIVE OUTSIDE THE LIST ON PURPOSE. A successful publish
                EMPTIES this list — the moved sessions are the plan of record now, so they are no
                longer deviations from it. Keeping these two inside the list branch meant the
                confirmation vanished at the moment it was earned, and the only way back to the
                baked plan disappeared exactly when a demo had just published something.
              */}
              {publishNote && (
                <p data-testid="changes-publish-note" className="mt-2 text-xs text-amber-200">
                  {publishNote}
                </p>
              )}
              {/*
                ⚠️ THE ONLY HONEST "CLEAR EVERYTHING". It is here rather than beside the draft
                chips because it is not an undo — it drops the drafts, the published plan and
                both SQL tables at once, which is the combination somebody reaches for when
                they have tried to clear the database by hand and the app carried on regardless.
              */}
              <button
                type="button"
                data-testid="changes-reset-all"
                onClick={() => void resetEverything()}
                className="mt-3 rounded border border-stone-700 px-2 py-1 text-[0.7rem] text-stone-400 hover:border-red-500/50 hover:text-red-300"
              >
                {t('calendar.resetAll')}
              </button>
            </div>
          ) : lowerPane === 'availability' ? (
            /*
              ⚠️ SCOPED TO WHOEVER THE WEEK IS SHOWING, and only when that is a person. Availability
              is a fact about a lecturer; offering the editor while the grid shows a room or a
              cohort would invite editing somebody the planner is not looking at.
            */
            <AvailabilityPanel
              site={aoiSchedulerSite ?? ''}
              teacher={scope === 'teacher' ? key : ''}
              onChanged={() => void load(key)}
            />
          ) : (
            <WalkList
              walks={walks}
              routes={walkRoutes}
              openWalk={openWalk}
              onToggle={(walk) => {
                const id = `${walk.from.sessionId}->${walk.to.sessionId}`;
                if (openWalk === id) {
                  setOpenWalk(null);
                  onShowRoute?.([]);
                  return;
                }
                setOpenWalk(id);
                onShowRoute?.(
                  walkRoutes ? routeLine(walkRoutes, walk.fromBuilding, walk.toBuilding) : []
                );
              }}
            />
          )}
        </div>
      </div>
        </>
      )}
    </section>
  );
}
