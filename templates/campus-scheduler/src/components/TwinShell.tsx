import { useCallback, useEffect, useRef, useState } from 'react';

import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DroneHud } from '@/components/DroneHud';
import { PlannerChat } from '@/components/PlannerChat';
import { CalendarPanel } from '@/components/CalendarPanel';
import { SiteMismatchNotice } from '@/components/SiteMismatchNotice';
import { SiteMenu } from '@/components/SiteMenu';
import { PlaceNote } from '@/components/PlaceNote';
import { backendSite, schedulerConfigured, planFacts } from '@/api/scheduler';
import {
  activeAoi,
  activeAoiId,
  activeBuildingId,
  activeLecturerId,
  activeLensId,
  hasPlanner,
  interiorProvenanceKey,
  rememberBuilding,
  rememberLecturer,
  rememberLens,
  type LensId,
} from '@/config/aoi';
import { useI18n } from '@/i18n';
import { landingLens, lensesFor, LENSES } from '@/lenses/registry';
import { OccupancyPanel, type OccupancyState } from '@/lenses/occupancy/OccupancyPanel';
import { ConditionPanel, type ConditionState } from '@/lenses/condition/ConditionPanel';
import { loadCondition, type ConditionModel } from '@/lenses/condition/conditionData';
import { FlowPanel, type FlowState } from '@/lenses/flow/FlowPanel';
import { StaffingPanel, type StaffingState } from '@/lenses/staffing/StaffingPanel';
import { QualityPanel, type QualityState } from '@/lenses/quality/QualityPanel';
import type { Campus3DHandle, PickedPlace } from '@/twin3d/scene';
import type { RoomView } from '@/twin3d/rooms';

import { Twin3DView } from './Twin3DView';
import { AnalysisView } from './AnalysisView';
import { ResizeHandle } from './ResizeHandle';
import { NavRail, type RailItem } from '@/components/NavRail';
import { currentPlanMoves, planStoreIdentity, type RestoredMove } from '@/api/planStore';
import { GuideOverlay } from '@/guide/GuideOverlay';
import { guideSteps, type GuideContext } from '@/guide/guideSteps';
import { usePaneSize } from './usePaneSize';

/**
 * Panel drag limits. Below the minimum the chat is unreadable.
 *
 * ⚠Ṫhe maximum used to be a flat 760 px, which on a wide monitor is barely a third of the screen
 * and made "let me actually read this transcript" impossible. It is now a share of the window, so
 * the panel scales with the display instead of against it, while still leaving the campus visible —
 * hiding it completely is the collapse button's job, not the drag's.
 */
const PANEL_MIN = 300;
const panelMax = () => Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.75));

/** The assistant needs a few lines to be worth having; below this it is a scrollbar with a border. */
const CHAT_MIN = 150;
/** Left for the lens list underneath, so the split can never hide the analysis entirely. */
const LENS_MIN = 170;

/**
 * Playing the week: Monday to Friday, and one teaching hour per second.
 *
 * ⚠️ THE SPEED IS A LEGIBILITY CHOICE, NOT A SIMULATION RATE. At one hour per second a full
 * teaching week runs in about a minute, which is short enough to watch to the end and slow enough
 * to read the hour as it changes. Faster, and the cross-campus bus becomes a streak; slower, and
 * nobody waits for Friday.
 *
 * The dataset knows about Saturday (OTH's real export has a Saturday slot), but the played week
 * stops at Friday: five columns is what the calendar draws and what a planner reads.
 */
const DAYS_PLAYED = 5;
const SLOTS_PER_SECOND = 1;

/**
 * The application shell.
 *
 * Deliberately thin. The scene owns the campus, the registry owns which questions can be asked of
 * it, and this component only arranges them and gets out of the way — the subject is a photoreal
 * campus, so chrome competing with it is a design fault rather than a feature.
 */
export function TwinShell() {
  const { t, locale } = useI18n();
  const aoi = activeAoi();
  const aoiId = activeAoiId();
  const lenses = lensesFor(aoi.lenses);
  // Whether this university has a timetable behind it at all. Garching and Tübingen are campus
  // twins with no solver — see `hasPlanner`.
  const planner = hasPlanner(aoi);

  const [handle, setHandle] = useState<Campus3DHandle | null>(null);
  /**
   * ⚠️ Starts on the first available lens rather than on null.
   *
   * With no lens open there is no building picker, so the exploded interiors — the one feature
   * that shows a room at all — were three non-obvious clicks deep and were reported as "not
   * implemented". The camera flight and the explode were working the whole time; nothing pointed
   * at them. A site with no room data still lands on null, because `lensesFor` returns nothing.
   *
   * ⚠️ "First available" is NOT "first" — see `landingLens`. A lens that repaints the buildings
   * is skipped, because Tübingen offers only `condition` and so opened on a synthetic
   * Sanierungsnote painted over the whole old town.
   */
  const [activeLens, setActiveLens] = useState<LensId | null>(
    () => activeLensId(aoi) ?? landingLens(lenses)
  );

  /**
   * What the link asked for, read during the FIRST RENDER.
   *
   * ⚠️ NOT in an effect. The write-back effects below also run on mount, with this state still
   * empty, and would DELETE `?building=` and `?teacher=` before the scene has finished loading and
   * could act on them — the link would silently open a plain campus. Reading in the state
   * initialiser puts the read strictly ahead of the write. `activeLens` escapes this only because
   * its own initialiser already reads the URL.
   *
   * Confirmed by breaking it: reading `activeBuildingId()` live on every render instead makes
   * "a linked building opens itself" time out, because the parameter is gone by the time the
   * scene is ready to use it.
   */
  const [linkedBuilding] = useState(() => activeBuildingId());
  const [linkedLecturer] = useState(() => activeLecturerId());
  const buildingLinkUsed = useRef(false);
  const lecturerLinkUsed = useRef(false);
  const [occupancy, setOccupancy] = useState<OccupancyState>({
    building: null,
    room: null,
    slot: null,
  });
  const [droneOn, setDroneOn] = useState(false);
  const [condition, setCondition] = useState<ConditionModel | null>(null);
  const [conditionState, setConditionState] = useState<ConditionState>({
    scenario: 'priorisiert',
    year: 2026,
  });
  const [flowState, setFlowState] = useState<FlowState>({ slot: null });

  /**
   * Playing the teaching week.
   *
   * ⚠️ THE CLOCK IS FRACTIONAL, and only the ROOMS round it. The occupancy shader wants a whole
   * slot — a room is booked for an hour or it is not — but a vehicle crossing town between two
   * campuses is continuous, and driving it off whole slots makes it jump the 3.5 km in one frame
   * every time the hour ticks over. So the loop keeps a float, the rooms get `Math.floor` of it,
   * and anything that moves gets the float. This is the same split PHOENIX's tour layer arrived
   * at, and for the same reason: the 60-minute grid is the resolution of the DATA, not of the
   * picture.
   *
   * ⚠️ ONE CLOCK, NOT TWO. The hour the rooms are coloured for and the moment the bus is on the
   * road are the same moment. A second timer would let the picture contradict itself — a bus
   * pulling into a campus whose rooms say the lecture has already started.
   */
  const [playing, setPlaying] = useState(false);
  const weekTime = useRef(0);
  const paintedSlot = useRef<number | null>(null);

  /*
   * The guided tour. Opened on demand, never automatically: an overlay that seizes the screen on
   * first load is the thing everybody dismisses without reading, and this one has something to say
   * — which parts of what you are looking at are measured and which are invented.
   */
  const [guideOpen, setGuideOpen] = useState(false);

  /*
   * ⚠️ A CALLBACK, NOT A SNAPSHOT. The overlay asks for this at the moment it runs a step's hook,
   * so a step that opens the drawer must reach the CURRENT setters rather than the ones that
   * existed when the tour was opened — the wind-farm tour passes its context the same way, for the
   * same reason.
   */
  const guideContext = useCallback(
    (): GuideContext => ({ setCalendarOpen, setPanelOpen, setLowerPane, hasPlanner: planner }),
    [planner]
  );

  // Which lecturer the staffing lens is showing, and the subject the week grid should follow.
  // Held here rather than inside the lens because it crosses panels: that crossing is the whole
  // point of borrowing the Einsatzplanung question instead of shipping a separate staffing tool.
  const [staffing, setStaffing] = useState<StaffingState>({ lecturerId: null });
  const [quality, setQuality] = useState<QualityState>({ cohortId: null });

  /**
   * Is the planner backend serving THIS university?
   *
   * ⚠️ One backend, one `SCHEDULER_SITE`, two universities in the header. Selecting LMU used to
   * leave the calendar and the assistant answering from OTH's plan under an LMU heading — the
   * calendar merely came back empty, but the assistant would have answered confidently and
   * wrongly, which is this project's worst failure mode. `null` means not yet known or no backend
   * configured; only a definite disagreement counts as a mismatch.
   */
  const [servingSite, setServingSite] = useState<string | null>(null);
  /**
   * ⚠️ SEPARATE FROM `servingSite`, because null is ambiguous. `backendSite()` returns null both
   * while the answer is in flight AND when the backend cannot say — and the guard treated that as
   * "no mismatch", i.e. as permission to proceed. The container scales to zero, so a cold start
   * gave a twenty-second window in which LMU quietly queried OTH's plan.
   */
  const [siteKnown, setSiteKnown] = useState(!schedulerConfigured());
  useEffect(() => {
    // A site with no planner has no backend to disagree with, and asking would wake a container
    // that serves a different university to answer a question about one it does not hold.
    if (!planner) {
      setSiteKnown(true);
      return;
    }
    let cancelled = false;
    backendSite().then((site) => {
      if (cancelled) return;
      setServingSite(site);
      setSiteKnown(true);
    });
    return () => {
      cancelled = true;
    };
  }, [planner]);
  const siteMismatch = Boolean(
    servingSite && aoi.schedulerSite && servingSite !== aoi.schedulerSite
  );
  const mismatchExpected = aoi.site.name[locale].split(' — ')[0];
  const [calendarFocus, setCalendarFocus] = useState<{
    scope: 'teacher' | 'cohort' | 'room';
    key: string;
  } | null>(null);

  // ── Side panel geometry ────────────────────────────────────────────────────
  // The 3D campus is the subject, so the panel has to be able to get out of the way completely,
  // and to grow when the chat transcript is what matters. Both are remembered: re-choosing a
  // layout on every reload is the kind of small friction that makes a demo feel unfinished.
  const [panelWidth, setPanelWidth] = usePaneSize('campus.panelWidth', 384, {
    min: PANEL_MIN,
    max: panelMax,
  });
  const [panelOpen, setPanelOpen] = useState(
    () => localStorage.getItem('campus.panelOpen') !== 'false'
  );

  /*
   * ── The navigation rail ───────────────────────────────────────────────────────────────────
   *
   * ⚠️ WHICH HALF OF THE ASIDE IS SHOWING, because `Assistent` and `Analyse` are two rail items
   * over one column. `both` is the default and the interesting state — asking a question while the
   * lens that answers it is on screen is the entire argument for this layout — so turning one off
   * narrows the column to the other rather than closing anything, and turning the second one off
   * closes the panel. That keeps the two items honest toggles instead of a hidden tab pair.
   */
  const [asidePane, setAsidePane] = useState<'both' | 'chat' | 'lenses'>('both');

  /**
   * What the CANVAS is showing.
   *
   * ⚠️ AUSWERTUNG IS A MAIN VIEW, NOT A SIDE PANEL. Utilisation was a lens in the 384 px aside,
   * which is the right home for a control — open a building, pick a room — and the wrong one for
   * a report. The figures a space planner actually argues with are a table: every building, its
   * rooms, its share of the teaching week. Wrapped into a narrow column that reads as a ribbon,
   * and the column is already carrying the assistant.
   *
   * The accepted cost, stated because it is a real loss: with the analysis on the canvas the
   * occupancy lens is not on screen, so **rooms cannot be selected from the side panel while it is
   * open**. Closing it puts the campus and its controls straight back.
   */
  const [mainView, setMainView] = useState<'campus' | 'analysis'>('campus');

  /*
   * The lower half of the calendar drawer. `Wege` and Änderungen` are both there because the drawer
   * already owns a resize handle and a close button, and giving each its own panel would cost the
   * campus another slice of screen — the same reasoning as the drawer's existing tabs.
   */
  const [lowerPane, setLowerPane] = useState<'walks' | 'changes' | 'availability'>('walks');

  // Furniture, so it persists like every other pane size here. A layout choice that dies on reload
  // is friction.
  const [railCollapsed, setRailCollapsed] = useState(
    () => localStorage.getItem('campus.railCollapsed') === 'true'
  );
  useEffect(() => {
    localStorage.setItem('campus.railCollapsed', String(railCollapsed));
  }, [railCollapsed]);

  /*
   * How many sessions differ from the published plan — the one number in this app worth putting on
   * a badge, because it is what a planner is accountable for and it is otherwise invisible until
   * you go looking. Declared with the other rail state but WIRED below, next to `proposalId`: the
   * count has to be re-read after a proposal is applied, and a dependency array cannot name a
   * `const` that has not been declared yet.
   */
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const [changes, setChanges] = useState<RestoredMove[] | null>(null);

  /*
   * Whether this university's week is REAL. Only TUM's is, and until it is said out loud a
   * published TUMonline timetable looks exactly like one this project made up.
   */
  const [timetableReal, setTimetableReal] = useState(false);
  const [lecturerLookup, setLecturerLookup] = useState(true);
  const [inventedAttributes, setInventedAttributes] = useState<string[]>([]);
  /**
   * What the SOURCE does not publish — as opposed to what we invented.
   *
   * ⚠️ THESE ARE THE OPPOSITE OF `inventedAttributes` AND MUST NOT BE MERGED WITH IT. That list
   * says "this field is fiction, hide it". This one says "this field is missing from a real
   * export, say so". Hiding a lecturer's Untis code would throw away the identifier the planner
   * actually uses; printing it unbadged would pass a three-letter code off as a name.
   */
  const [sourceLimits, setSourceLimits] = useState<{
    lecturerNamesAreCodes: boolean;
    roomsWithoutGeometry: number;
    roomsCampusOnly: string[];
    capacityPublished: boolean;
  }>({
    lecturerNamesAreCodes: false,
    roomsWithoutGeometry: 0,
    roomsCampusOnly: [],
    capacityPublished: true,
  });
  useEffect(() => {
    if (!planner) return;
    let cancelled = false;
    planFacts().then((facts) => {
      if (cancelled) return;
      setTimetableReal(facts.provenance === 'measured');
      setLecturerLookup(facts.lecturerLookup);
      setInventedAttributes(facts.inventedAttributes);
      setSourceLimits({
        lecturerNamesAreCodes: facts.lecturerNamesAreCodes,
        roomsWithoutGeometry: facts.roomsWithoutGeometry,
        roomsCampusOnly: facts.roomsCampusOnly,
        capacityPublished: facts.capacityPublished,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [planner, aoiId]);

  // How the panel divides between the assistant and the lenses below it. This was a hard-coded
  // flex-[3]/flex-[2], which meant the occupancy readout — rooms, slots, the thing the twin exists
  // to show — could never be given more than two fifths of the column no matter how much someone
  // wanted to study it.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const chatMax = useCallback(
    () => Math.max(CHAT_MIN, (splitRef.current?.clientHeight ?? 640) - LENS_MIN),
    []
  );
  const [chatHeight, setChatHeight] = usePaneSize('campus.chatHeight', 340, {
    min: CHAT_MIN,
    max: chatMax,
  });

  // The calendar starts closed: the 3D campus is the subject, and a drawer that opens itself would
  // take half the screen before anyone asked a question.
  const [calendarOpen, setCalendarOpen] = useState(false);

  // A solver proposal waiting to be looked at. It opens the calendar on arrival, because a preview
  // nobody can see is not a preview — but it writes nothing until the planner confirms.
  const [proposalId, setProposalId] = useState<string | null>(null);

  /*
   * ⚠️ ABSENCE IS NOT ZERO. If no store is configured, or nobody is signed in, the badge stays OFF
   * rather than showing 0 — "nothing has changed" and "I could not find out" look identical on a
   * badge, and only one of them is a statement. Re-read when a proposal lands, because applying
   * one is exactly what changes the number.
   *
   * ⚠️ AND DO NOT ASK A QUESTION THAT IS GOING TO BE REFUSED. Saved changes live behind a Rayfin
   * session; without one the data plane answers 401 and the browser logs it, so the first version
   * of this put two console errors on every anonymous load of a planner site and failed the deploy
   * verifier. The count is genuinely unknowable when signed out, so the honest move is not to ask
   * — the badge is absent, which is what "unknown" looks like here.
   */
  useEffect(() => {
    if (!planner || !aoi.schedulerSite || !planStoreIdentity()) return;
    let cancelled = false;
    currentPlanMoves(aoi.schedulerSite)
      .then((moves) => {
        if (cancelled) return;
        setChanges(moves);
        setChangeCount(moves.length);
      })
      .catch(() => {
        if (!cancelled) {
          setChanges(null);
          setChangeCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [planner, aoi.schedulerSite, proposalId]);

  useEffect(() => {
    localStorage.setItem('campus.panelOpen', String(panelOpen));
  }, [panelOpen]);

  // The renderer sizes itself from its container, and the container only changes when the panel
  // does — so tell it, rather than waiting for a window resize that may never come.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(id);
  }, [panelWidth, panelOpen]);

  // Ribbons only while the lens is open; otherwise they compete with the campus they sit on.
  useEffect(() => {
    handle?.setFlowVisible(activeLens === 'flow');
  }, [handle, activeLens]);

  useEffect(() => {
    handle?.setFlowSlot(flowState.slot);
  }, [handle, flowState.slot]);

  // Open on the busiest moment of the week. A flow lens that starts on an empty Friday evening
  // looks broken, and the peak is the thing the lens exists to show.
  //
  // ⚠️ LANDING IS A GESTURE, NOT A STATE — and keying this on `flowState.slot === null` made
  // "whole week" UNREACHABLE. That button sets the slot to null; this effect saw null and snapped
  // it straight back to the peak, so the mode existed, rendered its own label, and could never be
  // entered. Same shape as the drawer-reveal bug in §13: an effect that re-runs on the state the
  // user just changed will always win the argument. It now fires only when the lens BECOMES
  // active, which is the moment that actually needs a landing place.
  const flowLandedFor = useRef<string | null>(null);
  useEffect(() => {
    if (activeLens !== 'flow' || !handle?.flows) {
      if (activeLens !== 'flow') flowLandedFor.current = null;
      return;
    }
    if (flowLandedFor.current === aoi.id) return;
    flowLandedFor.current = aoi.id;
    if (flowState.slot === null) setFlowState({ slot: handle.flows.meta.peakSlot });
  }, [activeLens, handle, aoi.id, flowState.slot]);

  // The model is only fetched for sites that have one, and only once.
  useEffect(() => {
    let cancelled = false;
    loadCondition(aoiId)
      .then((model) => {
        if (cancelled || !model) return;
        setCondition(model);
        setConditionState({ scenario: 'priorisiert', year: model.years[0] });
      })
      .catch(() => setCondition(null));
    return () => {
      cancelled = true;
    };
  }, [aoiId]);

  // Attaching the grades is a one-off pass over 2.6 million vertices; after that the year slider
  // is a uniform, which is what keeps it smooth.
  useEffect(() => {
    if (!handle || !condition) return;
    handle.setBuildingCondition(
      condition.grade,
      condition.scenarios[conditionState.scenario].renovatedYear
    );
  }, [handle, condition, conditionState.scenario]);

  useEffect(() => {
    handle?.setBuildingConditionYear(conditionState.year);
  }, [handle, conditionState.year]);

  useEffect(() => {
    handle?.setBuildingConditionMix(activeLens === 'condition' ? 0.92 : 0);
  }, [handle, activeLens]);

  /**
   * Follow the camera latch, rather than drive it.
   *
   * ⚠️ There is no drone button any more. W A S D takes the camera and a second of stillness
   * gives it back, so a toggle was a second way to say what the keys already said — and one that
   * could disagree with them, because a flip requested mid-drag is deferred to the end of the
   * gesture. The scene is the only authority on whether the camera is flying; this just mirrors it
   * so the HUD can appear.
   */
  useEffect(() => {
    if (!handle) return;
    handle.onDroneMode(setDroneOn);
    setDroneOn(handle.droneEngaged());
    return () => handle.onDroneMode(null);
  }, [handle]);

  // ── Keep the link honest ──────────────────────────────────────────────────────────────────
  // Driven from STATE rather than from click handlers, so every route out — the close button,
  // Escape, clicking beside a building, switching lens — updates the URL without each one having
  // to remember to. A link that lies is worse than no link.
  // ⚠️ REVEALING THE READOUT IS A GESTURE, NOT A STATE. This counts CLICKS on a lens button; it
  // is deliberately not an effect on `activeLens`, and the difference is the whole bug it replaces.
  // Driving it from state fired on mount too, so every deep link — `?lens=staffing&teacher=…`, the
  // links the lenses themselves write — threw the drawer onto the analysis tab and hid the week it
  // had just loaded. A link to a lecturer means "show me their week"; only a click on "Lehrende"
  // means "show me the lecturer table".
  const [revealDetail, setRevealDetail] = useState(0);

  const pickLens = useCallback(
    (id: LensId) => {
      setActiveLens(id);
      // The table lenses read in the drawer, so asking for one has to open it — otherwise the
      // click does nothing visible and reads as a dead button while the table renders correctly
      // inside something closed. A lens that STEERS THE TWIN is exempt: it renders beside the
      // campus, and raising the drawer over the campus would cover the thing it steers.
      // ⚠️ This was hard-coded to `id !== 'occupancy'`; `flow` and `condition` are the same kind
      // of surface and were only getting the right behaviour by having no planner to open.
      if (!LENSES[id]?.steersTheTwin) {
        setCalendarOpen(true);
        setRevealDetail((n) => n + 1);
      }
    },
    []
  );

  useEffect(() => rememberLens(activeLens), [activeLens]);
  useEffect(() => rememberBuilding(occupancy.building), [occupancy.building]);
  useEffect(() => rememberLecturer(staffing.lecturerId), [staffing.lecturerId]);

  // A linked lecturer brings its own lens and its own week, exactly as picking one by hand does.
  // An id that no longer exists is cleared by StaffingPanel once the model has loaded.
  useEffect(() => {
    if (lecturerLinkUsed.current || !linkedLecturer) return;
    lecturerLinkUsed.current = true;
    setActiveLens('staffing');
    setStaffing({ lecturerId: linkedLecturer });
    setCalendarFocus({ scope: 'teacher', key: linkedLecturer });
    setCalendarOpen(true);
  }, [linkedLecturer]);

  const onReady = useCallback((created: Campus3DHandle) => setHandle(created), []);

  /**
   * A named place on the map that this dataset has no rooms for.
   *
   * Clicking "OTH Regensburg" or "Campus Prüfeninger Straße" names a campus, not a building, and
   * several real buildings carry no teaching rooms on purpose. The map flies there and this says
   * what it is — which beats both doing nothing and opening an empty shell.
   */
  const [pickedPlace, setPickedPlace] = useState<PickedPlace | null>(null);

  // Clicking in the 3D scene and clicking in the panel have to reach the same state, or the two
  // disagree about what is selected the moment anyone uses both.
  useEffect(() => {
    if (!handle) return;
    handle.onBuildingPicked((code) => {
      setActiveLens('occupancy');
      handle.explodeBuilding(code);
      setOccupancy((prev) => ({ ...prev, building: code, room: null }));
      // A building takes over from a place note: two things claiming to be the subject is worse
      // than either on its own.
      setPickedPlace(null);
    });
    handle.onPlacePicked((place) => setPickedPlace(place));
    handle.onRoomPicked((room: RoomView | null) => {
      setOccupancy((prev) => ({ ...prev, room }));
    });
    // The scene can now close a building on its own — the camera left, or someone clicked beside
    // it. Without this the panel would go on listing rooms for a building that is shut, and the
    // `?building=` link would keep naming it.
    handle.onBuildingClosed(() => {
      setOccupancy((prev) => ({ ...prev, building: null, room: null }));
    });
    return () => handle.onBuildingClosed(null);
  }, [handle]);

  const explode = useCallback(
    (code: string | null) => {
      handle?.explodeBuilding(code);
      setOccupancy((prev) => ({ ...prev, building: code, room: null }));
    },
    [handle]
  );

  /**
   * Open the building a link named, once the scene knows its buildings.
   *
   * The ref makes this fire at most once. ⚠️ It is DEFENSIVE, not currently load-bearing: the
   * dependencies below never change again after the scene has loaded, so the effect does not
   * re-run today and removing the guard breaks no test — verified by removing it and watching the
   * suite still pass. It stays because the failure it prevents is nasty and silent: if anything
   * later gives this effect a dependency that changes, the captured `?building=` re-fires and the
   * building springs back open seconds after someone dismisses it.
   *
   * A code the site does not have is dropped silently, so a stale link degrades to the plain
   * campus instead of retrying forever.
   */
  useEffect(() => {
    if (buildingLinkUsed.current || !linkedBuilding || !handle?.rooms) return;
    buildingLinkUsed.current = true;
    if (!handle.rooms.buildings.some((b) => b.code === linkedBuilding)) return;
    setActiveLens('occupancy');
    explode(linkedBuilding);
  }, [handle, linkedBuilding, explode]);

  const selectRoom = useCallback(
    (room: RoomView | null) => {
      handle?.selectRoom(room ? room.index : null);
      setOccupancy((prev) => ({ ...prev, room }));
    },
    [handle]
  );

  /**
   * Take a room CODE from the timetable and show it in the campus.
   *
   * The two halves of this app name rooms identically — every one of the 105 booked `roomId`s in
   * `plan_assignment` exists as a geometry `code` — so a click in the calendar can open the right
   * building and light the right room without a translation table. That agreement is worth relying
   * on and worth stating: it is why a session in a grid cell and a room in the 3D are the same
   * object rather than two things that look similar.
   */
  const focusRoomsById = useCallback(
    (roomIds: string[]) => {
      if (!handle?.rooms || !roomIds.length) return;
      const target = handle.rooms.rooms.find((r) => r.code === roomIds[0]);
      if (!target) return;
      // Open the building first: a selected room inside a closed shell is invisible, which would
      // look exactly like the click doing nothing.
      handle.explodeBuilding(target.building);
      handle.selectRoom(target.index);
      setActiveLens('occupancy');
      setOccupancy((prev) => ({ ...prev, building: target.building, room: target }));
    },
    [handle]
  );

  const setSlot = useCallback(
    (slot: number | null) => {
      handle?.setTimeSlot(slot);
      setOccupancy((prev) => ({ ...prev, slot }));
    },
    [handle]
  );

  /**
   * Scrubbing by hand stops the playback.
   *
   * Without this, dragging the slider fought the loop: the drag moved the hour, the next frame
   * moved it back, and the control felt broken rather than busy. Whoever grabs the slider has
   * taken over.
   */
  const setSlotManually = useCallback(
    (slot: number | null) => {
      setPlaying(false);
      handle?.setWeekTime(null);
      if (slot !== null) weekTime.current = slot;
      paintedSlot.current = slot;
      setSlot(slot);
    },
    [handle, setSlot]
  );

  const weekSlots = handle?.rooms
    ? DAYS_PLAYED * handle.rooms.meta.occupancyGrid.hours
    : 0;

  useEffect(() => {
    if (!playing || !handle || weekSlots <= 0) return;

    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      // ⚠️ Clamp the delta. A backgrounded tab hands back one enormous frame on return, and an
      // unclamped step would fling the week forward by hours in a single tick.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      weekTime.current = (weekTime.current + dt * SLOTS_PER_SECOND) % weekSlots;
      handle.setWeekTime(weekTime.current);

      // Only repaint the rooms when the HOUR changes: setTimeSlot rebuilds the occupancy uniform
      // for every room in the campus, and doing that 60 times a second for a value that changes
      // once a second is how a smooth clock turns into a slideshow.
      const slot = Math.floor(weekTime.current);
      if (slot !== paintedSlot.current) {
        paintedSlot.current = slot;
        setSlot(slot);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, handle, weekSlots, setSlot]);

  // Leaving the occupancy lens stops the clock: the control that started it is no longer on
  // screen, and a week playing behind a different panel is a thing nobody can turn off.
  useEffect(() => {
    if (activeLens !== 'occupancy' && playing) setPlaying(false);
  }, [activeLens, playing]);

  const togglePlay = useCallback(() => {
    setPlaying((was) => {
      if (was) {
        handle?.setWeekTime(null);
        return false;
      }
      // Starting from the whole-week view has no hour to start at, so begin the week properly.
      if (occupancy.slot === null) {
        weekTime.current = 0;
        paintedSlot.current = 0;
        setSlot(0);
      } else {
        weekTime.current = occupancy.slot;
      }
      return true;
    });
  }, [handle, occupancy.slot, setSlot]);

  /**
   * The active lens's readout, rendered into the bottom drawer rather than the side panel.
   *
   * ⚠️ OCCUPANCY IS DELIBERATELY NOT HERE. It is not a readout, it is the control that drives the
   * twin — open a building, pick a room, scrub the time slider — and putting it in a drawer that
   * covers the campus would hide the very thing it manipulates. The rule that fell out of trying
   * it both ways: **controls that drive the 3D stay beside the 3D; tables go beside the week they
   * describe.** Staffing and quality are tables of people and cohorts, and a 384 px column wrapped
   * every row of them into a ribbon.
   *
   * `null` is a real state, not a gap: the flow lens needs a built flow layer and the condition
   * lens needs a condition model, and neither site has both.
   */
  const lensDetail =
    activeLens === 'staffing' ? (
      <StaffingPanel
        aoiId={aoiId}
        state={staffing}
        onChange={setStaffing}
        onSelectLecturer={(lecturer) => {
          // One object, three views: the lecturer picked here becomes the subject of the week
          // grid, which in turn can fly the twin to any of their rooms. A new object each time,
          // so re-picking the same person re-focuses rather than doing nothing.
          setCalendarFocus({ scope: 'teacher', key: lecturer.teacherId });
          setCalendarOpen(true);
        }}
      />
    ) : activeLens === 'quality' ? (
      <QualityPanel
        aoiId={aoiId}
        state={quality}
        onChange={setQuality}
        onSelectCohort={(cohort) => {
          // Same move as the staffing lens: the cohort picked here becomes the subject of the
          // week grid, so the gap being complained about is visible in the same view.
          setCalendarFocus({ scope: 'cohort', key: cohort.cohortId });
          setCalendarOpen(true);
        }}
      />
    ) : activeLens === 'condition' && condition ? (
      <ConditionPanel model={condition} state={conditionState} onChange={setConditionState} />
    ) : activeLens === 'flow' && handle?.flows ? (
      <FlowPanel meta={handle.flows.meta} state={flowState} onChange={setFlowState} />
    ) : null;

  /*
   * WHICH HALF OF THE RULE THIS LENS FALLS UNDER — read from the registry, not from the site.
   *
   * ⚠️ This used to be `!hasPlanner`, and that is a fact about the SITE. It happened to agree
   * with the rule while the only lenses beside the campus belonged to twins with no timetable.
   * Giving Garching a real week silently moved its flow timeline into the drawer — over the
   * campus it scrubs — and broke all five of its tests.
   */
  const lensSteers = Boolean(activeLens && LENSES[activeLens]?.steersTheTwin);
  /** Controls: beside the 3D they drive, on every site. */
  const controlDetail = lensSteers ? lensDetail : null;
  /** Tables: beside the week they describe, which only exists where there is a planner. */
  const tableDetail = lensSteers ? null : lensDetail;

  return (
    <div className="flex h-screen w-screen flex-col bg-stone-900 text-stone-100">
      <header className="flex shrink-0 items-baseline gap-4 border-b border-stone-700 px-5 py-3">
        {/*
          One university on screen at a time. The switch used to be a row of buttons here, naming
          every customer in the build to whichever customer was in the room; it now lives behind
          the title — see `SiteMenu`.
        */}
        <SiteMenu aoiId={aoiId} />
        <span className="text-xs text-stone-400">{aoi.site.region[locale]}</span>

        <nav className="ml-auto flex items-center gap-2">
          {/*
            ⚠️ THE ONLY WAY IN, so the label has to survive being read in a demo. It said "Was ist
            das hier?" on the theory that answering the viewer's own question gets it opened — but
            in front of an audience a control phrased as a question reads as uncertainty about the
            product, not curiosity about the campus. "Guide" is the same word in both languages and
            needs no translation to be understood.
          */}
          <button
            type="button"
            data-testid="guide-open"
            onClick={() => setGuideOpen(true)}
            className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
          >
            {t('guide.open')}
          </button>
          <LanguageToggle />
          <ThemeToggle />
        </nav>
      </header>

      <GuideOverlay
        steps={guideSteps(planner, timetableReal)}
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        getContext={guideContext}
        vars={{ university: aoi.site.name[locale] }}
      />

      <div className="relative flex min-h-0 flex-1">
        {/*
          ⚠️ TOGGLES, NOT TABS. Every item below turns its own surface on or off and leaves the
          others where they are, which is what keeps the split screen this app is built around:
          the week open under the campus while a lens reads out beside it. A tab bar would make
          those mutually exclusive and quietly delete the thing worth demonstrating.
        */}
        <NavRail
          collapsed={railCollapsed}
          onCollapsedChange={setRailCollapsed}
          items={[
            {
              id: 'campus',
              available: true,
              // Not a toggle of its own: "show me just the map" is a real request, and hunting for
              // two separate close buttons to satisfy it is not an answer. Active only when the
              // campus really is unobstructed, so the item describes the screen rather than a mode.
              active: !calendarOpen && !panelOpen,
              onToggle: () => {
                setCalendarOpen(false);
                setPanelOpen(false);
              },
            },
            {
              id: 'week',
              available: planner,
              active: calendarOpen,
              onToggle: () => setCalendarOpen((open) => !open),
            },
            {
              /*
                ⚠️ THIS NOW OWNS THE CANVAS, not a column of the aside. It used to toggle the lens
                half of the side panel; utilisation is a report and a report needs the width. The
                campus stays mounted underneath — see the overlay in `<main>` — so switching back
                is instant and the 3D scene is never rebuilt.
              */
              id: 'analysis',
              available: true,
              active: mainView === 'analysis',
              onToggle: () => setMainView((v) => (v === 'analysis' ? 'campus' : 'analysis')),
            },
            {
              id: 'assistant',
              // The assistant answers from a timetable; on a twin without one there is nothing for
              // it to be right about.
              available: planner,
              active: panelOpen && asidePane !== 'lenses',
              onToggle: () => {
                if (panelOpen && asidePane !== 'lenses') {
                  if (asidePane === 'both') setAsidePane('lenses');
                  else setPanelOpen(false);
                } else {
                  setAsidePane(panelOpen && asidePane === 'lenses' ? 'both' : 'chat');
                  setPanelOpen(true);
                }
              },
            },
            {
              id: 'changes',
              available: planner,
              active: calendarOpen && lowerPane === 'changes',
              badge: changeCount ?? undefined,
              onToggle: () => {
                if (calendarOpen && lowerPane === 'changes') {
                  setLowerPane('walks');
                  return;
                }
                setLowerPane('changes');
                setCalendarOpen(true);
              },
            },
            {
              id: 'walks',
              available: planner,
              active: calendarOpen && lowerPane === 'walks',
              onToggle: () => {
                if (calendarOpen && lowerPane === 'walks') {
                  setCalendarOpen(false);
                  return;
                }
                setLowerPane('walks');
                setCalendarOpen(true);
              },
            },
            {
              /*
                ⚠️ A TOGGLE LIKE THE OTHERS, not a tab. Pressing it again returns to the walks
                pane rather than closing the drawer, because availability is read ALONGSIDE the
                week — the whole reason to open it is to look at somebody's Monday while deciding
                whether to block it.
              */
              id: 'availability',
              available: planner,
              active: calendarOpen && lowerPane === 'availability',
              onToggle: () => {
                if (calendarOpen && lowerPane === 'availability') {
                  setLowerPane('walks');
                  return;
                }
                setLowerPane('availability');
                setCalendarOpen(true);
              },
            },
            {
              id: 'help',
              available: true,
              active: guideOpen,
              onToggle: () => setGuideOpen((open) => !open),
            },
          ] satisfies RailItem[]}
        />

        <main className="relative min-w-0 flex-1">
          <Twin3DView aoi={aoi} onReady={onReady} />

          {/*
            ⚠️ AN OVERLAY, NOT A SWAP, AND THE THREE.JS SCENE IS WHY. Rendering the Auswertung
            INSTEAD of `<Twin3DView>` reads as the obvious thing and unmounts it, which disposes
            every geometry, material and texture on the campus and rebuilds all of it on the way
            back. §28 is a whole section about how expensive that turned out to be when it was
            happening once a second by accident; doing it deliberately on a tab click is the same
            bill. Overlaid, the scene keeps running underneath with its camera, its exploded
            building and its point in the week exactly where they were left.

            And it is worse than slow: the report reads its figures from `handle.rooms`, which is
            the LIVE scene's room layer. Unmount the view and the handle goes with it, so the swap
            does not render a slower Auswertung — it renders an empty one. Confirmed by breaking
            it on purpose: the guard in rail.spec.ts fails on the view never appearing at all.
          */}
          {mainView === 'analysis' && handle?.rooms ? <AnalysisView layer={handle.rooms} /> : null}

          {/*
            ⚠️ The drone toggle used to live here and deliberately does not any more. The camera and
            the map are one mode now: W A S D takes the camera, Escape or a second of stillness
            gives it back, and while it is theirs the wheel is a throttle rather than the map zoom
            and a drag looks rather than orbits.

            What a button cannot do, and what replaces it, is say which of those two the mouse is
            currently doing. That is the HUD's second job — it appearing IS the statement — and the
            line below is what tells anyone who has not flown yet that the keys exist at all.
          */}
          {handle?.hasTerrain && !droneOn && (
            <p
              data-testid="drone-hint"
              className="pointer-events-none absolute right-4 top-4 rounded border border-stone-600/70 bg-stone-900/80 px-3 py-1.5 text-xs text-stone-300 backdrop-blur"
            >
              {t('drone.idle')}
            </p>
          )}

          {handle && droneOn && <DroneHud handle={handle} />}

          {/*
            The build state, stated plainly. A fresh clone has no terrain because the pipeline
            output is tens of megabytes and is not committed — that is expected, not a failure, so
            it is explained in place rather than thrown as a fetch error. Sits at the bottom so the
            sky and the resolved places stay visible behind it.
          */}
          {handle && !handle.hasTerrain && (
            <div
              data-testid="terrain-notice"
              className="absolute bottom-4 left-4 max-w-md rounded border border-amber-500/60 bg-stone-900/90 p-4 text-xs leading-relaxed"
            >
              <p className="font-semibold uppercase tracking-[0.18em] text-amber-400">
                {t('setup.eyebrow')}
              </p>
              <p className="mt-2 text-stone-200">{t('setup.body')}</p>
              <pre className="mt-3 overflow-x-auto rounded bg-stone-950 p-3 text-[0.7rem] text-stone-300">
                {`pip install -r tools/requirements.txt\nnpm run data:build -- --aoi ${aoiId}`}
              </pre>
            </div>
          )}

          {/*
            The week grid lives over the campus rather than in the side panel: five days by seven
            blocks needs width, and the 3D stays the main pane. It is also where the proposal diff
            will render (PLAN §13.4), so it is a drawer from the start rather than something that
            has to be moved once confirmations arrive.

            ⚠️ `planner &&` — the CalendarPanel below is already gated on it and this button was
            not, so Garching and Tübingen showed "Kalender öffnen" underneath a note saying this
            site has no timetable. Pressing it hid the button and opened nothing. Same rule as the
            comment on the drawer itself: a button that silently does nothing is its own bug.
          */}
          {planner && !calendarOpen && (
            <button
              type="button"
              data-testid="calendar-open"
              onClick={() => setCalendarOpen(true)}
              className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded border border-stone-600 bg-stone-900/85 px-3 py-1.5 text-xs text-stone-200 backdrop-blur transition hover:bg-stone-800 hover:text-stone-50"
            >
              {t('calendar.show')}
            </button>
          )}

          {pickedPlace && (
            <PlaceNote
              place={pickedPlace}
              onDismiss={() => {
                setPickedPlace(null);
                handle?.clearPlaceHighlight();
              }}
            />
          )}

          {planner && (
            <CalendarPanel
              open={calendarOpen}
              onClose={() => setCalendarOpen(false)}
              onSelectRooms={focusRoomsById}
              proposalId={proposalId}
              focus={calendarFocus}
              /*
               * The drawer still OPENS on a mismatch and explains itself, rather than being gated
               * shut. The staffing and quality lenses both open it, and a button that silently does
               * nothing is its own bug.
               */
              mismatch={siteMismatch ? { serving: servingSite ?? '', expected: mismatchExpected } : null}
              siteKnown={siteKnown}
              aoiId={aoiId}
              onShowRoute={(points) => handle?.showWalkRoute(points)}
            /*
             * The same handler the assistant's proposals go through. A repair reached by clicking
             * a day and one reached by asking in German must land in the identical preview and the
             * identical confirm gate, or "nothing is written until you confirm" becomes a property
             * of which door you came through.
             */
              onProposal={(id) => setProposalId(id)}
              detail={tableDetail}
              lowerPane={lowerPane}
              onLowerPaneChange={setLowerPane}
              changes={changes}
            onChangesChanged={setChanges}
              timetableReal={timetableReal}
              lecturerLookup={lecturerLookup}
              inventedAttributes={inventedAttributes}
              sourceLimits={sourceLimits}
              detailLabel={
                // The tab carries the lens's own name, so the drawer says what is in it rather than
                // making the reader remember which lens they left open.
                lenses.find((lens) => lens.id === activeLens)?.labelKey
                  ? t(lenses.find((lens) => lens.id === activeLens)!.labelKey)
                  : undefined
              }
              revealDetail={revealDetail}
            />
          )}
        </main>

        {/*
          Reopen affordance. When the panel is gone the campus is full-bleed, and something has to
          remain that says the panel exists — otherwise collapsing it once is indistinguishable
          from losing it.
        */}
        {!panelOpen && (
          <button
            type="button"
            data-testid="panel-open"
            onClick={() => setPanelOpen(true)}
            title={t('panel.show')}
            className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l border border-r-0 border-stone-600 bg-stone-900/90 px-2 py-4 text-stone-300 backdrop-blur hover:bg-stone-800 hover:text-stone-50"
          >
            <span aria-hidden>‹</span>
            <span className="sr-only">{t('panel.show')}</span>
          </button>
        )}

        {panelOpen && (
          <>
            {/*
              The drag handle is its own element rather than a CSS resize, because the renderer has
              to be told the viewport changed and a native resize gives no hook to do it. Pointer
              capture is what keeps the drag alive when the cursor crosses the WebGL canvas, which
              otherwise swallows the events.
            */}
            <ResizeHandle
              axis="x"
              testId="panel-resize"
              label={t('resize.panel')}
              value={panelWidth}
              min={PANEL_MIN}
              max={panelMax}
              onChange={setPanelWidth}
              growKey="ArrowLeft"
              measure={(event) => window.innerWidth - event.clientX}
              presets={[
                { size: 384, labelKey: 'default' },
                { size: (available) => Math.round(available * 0.55), labelKey: 'wide' },
                { size: (available) => available, labelKey: 'widest' },
              ]}
              format={(value) => `${Math.round(value)} px`}
              className="border-l border-stone-700"
            />

            <aside
              data-testid="side-panel"
              style={{ width: panelWidth }}
              className="flex shrink-0 flex-col p-5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs uppercase tracking-[0.18em] text-amber-400">
                  {t('chat.heading')}
                </h2>
                <button
                  type="button"
                  data-testid="panel-collapse"
                  onClick={() => setPanelOpen(false)}
                  title={t('panel.hide')}
                  className="rounded px-2 py-0.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100"
                >
                  <span aria-hidden>›</span>
                  <span className="sr-only">{t('panel.hide')}</span>
                </button>
              </div>
              {/*
                ⚠️ ONE PANEL, NO TAB RAIL. The 3D twin is the interface and this column is how you
                talk to it: the assistant on top because a question is the fastest way to an answer,
                the analytical lenses beneath it in the same scroll. Tabs would hide whichever half
                the viewer is not looking at, and in a demo that means hiding the half that proves
                the other one is real.

                The proportion between the two is dragged, not fixed. It was flex-[3]/flex-[2],
                which capped the occupancy readout at two fifths of the column however much someone
                wanted to study it — and studying it is the point of the lens.
              */}
              <div ref={splitRef} className="mt-3 flex min-h-0 flex-1 flex-col">
                {/*
                  ⚠️ `asidePane` narrows this column to one half; it does NOT turn the split into a
                  tab pair. `both` remains the default and the state worth having — the drag handle
                  between the two only exists because someone wants to study a lens WHILE the
                  assistant is on screen. Hiding a half is for the moment you want the other one
                  full height, and the rail turns it straight back on.
                */}
                {asidePane !== 'lenses' && (
                <div
                  data-testid="panel-chat"
                  style={{ height: asidePane === 'chat' ? undefined : chatHeight }}
                  className={
                    asidePane === 'chat'
                      ? 'flex min-h-0 flex-1 flex-col'
                      : 'flex min-h-0 shrink-0 flex-col'
                  }
                >
                  {!planner ? (
                    /*
                     * A campus twin without a timetable. Saying so is the whole point: an empty
                     * assistant box invites someone to type a question that nothing can answer,
                     * and a blank column reads as a component that failed to load.
                     */
                    <p
                      data-testid="no-planner"
                      className="rounded border border-stone-700 bg-stone-800/60 p-3 text-xs text-stone-400"
                    >
                      {t('site.noPlanner')}
                    </p>
                  ) : siteMismatch ? (
                    /*
                     * The assistant is the one surface that would answer a question about THIS
                     * university with the other one's plan and sound completely certain doing it.
                     * Withholding it is the honest option; the notice names the site the backend
                     * is on, so the gap is diagnosable rather than mysterious.
                     */
                    <SiteMismatchNotice serving={servingSite ?? ''} expected={mismatchExpected} />
                  ) : (
                    <PlannerChat
                      onProposal={(id) => {
                        setProposalId(id);
                        setCalendarOpen(true);
                      }}
                    />
                  )}
                </div>
                )}

                {asidePane === 'both' && (
                <ResizeHandle
                  axis="y"
                  testId="panel-split"
                  label={t('resize.split')}
                  value={chatHeight}
                  min={CHAT_MIN}
                  max={chatMax}
                  onChange={setChatHeight}
                  growKey="ArrowDown"
                  measure={(event) =>
                    event.clientY - (splitRef.current?.getBoundingClientRect().top ?? 0)
                  }
                  presets={[
                    { size: CHAT_MIN, labelKey: 'lensFocus' },
                    { size: (available) => Math.round(available / 2), labelKey: 'even' },
                    { size: (available) => available, labelKey: 'chatFocus' },
                  ]}
                  format={(value, available) =>
                    `${Math.round((value / Math.max(available, 1)) * 100)}% / ${Math.round(
                      100 - (value / Math.max(available, 1)) * 100
                    )}%`
                  }
                  className="my-2"
                />
                )}

                {asidePane !== 'chat' && (
                <div
                  data-testid="panel-lenses"
                  className="min-h-0 flex-1 overflow-y-auto border-t border-stone-700 pt-4"
                >
            <h2 className="text-xs uppercase tracking-[0.18em] text-stone-400">{t('lens.heading')}</h2>
          {/*
            ⚠️ THE THREE LENSES WERE NOT TELLING THEMSELVES APART. Two of them were called
            "…Auslastung" and all three were named after a department rather than after a question,
            so the panel read as three similar reports instead of three different subjects. What
            actually distinguishes them is WHOSE day is being examined — the rooms', the lecturers',
            the students' — and one line saying so does more than any amount of renaming.
          */}
          <p className="mt-1 text-[0.68rem] leading-relaxed text-stone-500">{t('lens.intro')}</p>

          <ul className="mt-3 space-y-2">
            {lenses.map((lens) => (
              <li key={lens.id}>
                <button
                  type="button"
                  data-testid={`lens-${lens.id}`}
                  disabled={!lens.status.implemented}
                  onClick={() => pickLens(lens.id)}
                  className={`w-full rounded border p-3 text-left transition ${
                    activeLens === lens.id
                      ? 'border-stone-300 bg-stone-800'
                      : 'border-stone-700 hover:border-stone-500'
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{t(lens.labelKey)}</span>
                    {lens.provenance === 'synthetic' && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-amber-300">
                        {t('provenance.synthetic')}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-400">
                    {t(lens.blurbKey)}
                  </span>
                  {!lens.status.implemented && (
                    <span className="mt-2 block text-[0.65rem] uppercase tracking-wider text-stone-500">
                      {t('lens.pending', { phase: lens.status.phase })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/*
            Why a lens is missing, rather than silently offering fewer buttons. Tübingen has no
            indoor mapping at all, and an unexplained absence reads as an unfinished app instead of
            as a property of the data (PLAN D6).
          */}
          {!aoi.rooms && (
            <p
              data-testid="no-rooms-note"
              className="mt-5 rounded border border-stone-700 bg-stone-800/60 p-3 text-xs leading-relaxed text-stone-400"
            >
              {t('lens.noRooms')}
            </p>
          )}

          {/*
            ⚠️ OCCUPANCY STAYS HERE, the table lenses do not. This one is a control, not a report:
            it opens buildings, selects rooms and scrubs the teaching week on the twin. Moving it
            into the bottom drawer put the campus behind the very panel used to steer it. Staffing
            and quality moved, because they are tables and this column is 384 px wide.
          */}
          {activeLens === 'occupancy' && handle?.rooms && (
            <OccupancyPanel
              layer={handle.rooms}
              state={occupancy}
              onExplode={explode}
              onSelectRoom={selectRoom}
              onSlot={setSlotManually}
              playing={playing}
              onTogglePlay={togglePlay}
              shuttle={handle.shuttleLeg()}
            />
          )}

          {/*
            ⚠️ AND SO DOES EVERY LENS ON A SITE WITH NO WEEK TO SIT BESIDE.

            `lensDetail` is rendered inside the calendar drawer, and the drawer is gated on
            `hasPlanner`. On the two campus twins that made their only lenses DEAD BUTTONS: the
            card was offered, clicking it set `activeLens`, and the panel it opens had nowhere to
            render — so Tübingen's Zustand and Garching's Campus-Flow both looked broken while
            working perfectly. The rule "tables go beside the week they describe" has no meaning
            where there is no week; beside the campus is the only place left, which is where these
            two lived before the drawer existed. Both are compact controls rather than tables, so
            the 384 px column that wrapped the staffing rows is not a problem for them.

            ⚠️ NOW KEYED ON THE LENS, NOT THE SITE. A control belongs here on EVERY site — see
            `steersTheTwin`. A table belongs here only where there is no week to sit beside.
          */}
          {controlDetail}
          {!planner && tableDetail}

          {/*
            What the site actually has, when no lens is open. Verification made visible rather than
            decoration: the counts come straight from the built data, so a pipeline that silently
            produced half a campus is obvious on screen instead of only in a log.
          */}
          {!lensDetail && activeLens !== 'occupancy' && handle && handle.roomCount > 0 && handle.rooms && (
            <section
              data-testid="room-stats"
              className="mt-5 rounded border border-stone-700 bg-stone-800/60 p-3"
            >
              <h3 className="text-xs uppercase tracking-[0.18em] text-stone-400">
                {t('rooms.heading')}
              </h3>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-400">{t('rooms.count')}</dt>
                  <dd className="font-medium tabular-nums">
                    {handle.roomCount.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB')}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-400">{t('rooms.buildings')}</dt>
                  <dd className="font-medium tabular-nums">{handle.rooms.meta.buildings}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-400">{t('rooms.withUsage')}</dt>
                  <dd className="font-medium tabular-nums">
                    {handle.rooms.meta.withUsage.toLocaleString(
                      locale === 'de' ? 'de-DE' : 'en-GB'
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-400">{t('rooms.withCalendar')}</dt>
                  <dd className="font-medium tabular-nums">{handle.rooms.distinct.withOccupancy}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-stone-400">{t('rooms.neverBooked')}</dt>
                  <dd className="font-medium tabular-nums">{handle.rooms.distinct.neverBooked}</dd>
                </div>
              </dl>
              {/*
                ⚠️ TEST ID BECAUSE THIS SENTENCE CHANGES WITH THE DATA. `interiorProvenanceKey`
                swaps to the `-synthetic` variant when `config/release.json` substitutes a site's
                interiors, and a stale note here would name TUMonline as the source of a week that
                was invented — on a screen showing real room numbers in a real building, which is
                exactly the reading that would be taken as the university's own figure. Nothing
                could check that claim until it had a handle.
              */}
              <p
                data-testid="rooms-provenance"
                className="mt-2 text-[0.65rem] leading-relaxed text-stone-500"
              >
                {t(interiorProvenanceKey('rooms', aoiId))}
              </p>
            </section>
          )}

          {/*
            ⚠️ ALWAYS rendered, never inside the lens ternary. Jumping between the two campuses is
            navigation, not analysis, and it used to disappear the moment a lens was opened — which
            became a real fault the day the occupancy lens started opening by default: the only way
            to reach Prüfening vanished from the UI entirely.
          */}
          <section className="mt-6 border-t border-stone-700 pt-4">
            <h2 className="text-xs uppercase tracking-[0.18em] text-stone-400">
              {t('places.heading')}
            </h2>
            <ul className="mt-2 space-y-1">
              {aoi.focusPlaces.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    data-testid={`place-${place.id}`}
                    onClick={() => handle?.focusPlace(place.id)}
                    className="w-full rounded px-2 py-1 text-left text-xs text-stone-300 transition hover:bg-stone-800 hover:text-stone-50"
                  >
                    {place.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <footer className="mt-6 border-t border-stone-700 pt-4 text-[0.65rem] leading-relaxed text-stone-500">
            <p>{aoi.geobasis.attribution}</p>
            <p className="mt-1">{t('attribution.more')}</p>
          </footer>
                </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
