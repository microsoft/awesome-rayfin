import aachen from '@config/aoi/aachen.json';
import fauErlangen from '@config/aoi/fau-erlangen.json';
import garching from '@config/aoi/garching.json';
import koeln from '@config/aoi/koeln.json';
import lmuMuenchen from '@config/aoi/lmu-muenchen.json';
import muenster from '@config/aoi/muenster.json';
import othRegensburg from '@config/aoi/oth-regensburg.json';
import tuebingen from '@config/aoi/tuebingen.json';

import {
  EXCLUDED_AOIS,
  INTERIORS_ARE_SYNTHETIC,
  KEEPS_INTERIORS,
  NAVIGATUM_DEPENDENT_LENSES,
  NAVIGATUM_MODE,
  shipsSchedulerSite,
  substituteSchedulerSite,
  usesNavigatum,
} from '@/config/release';

/**
 * The area of interest, as configuration — PLAN §5.
 *
 * Forked from Campus-Insights, which shipped two AOIs from its first commit for a good reason:
 * the app IT came from shipped one site for six phases and only discovered on the seventh how
 * much of "the AOI is configuration" was untrue — components had simply imported the one JSON
 * file by name. Campus-Scheduler shipped ONE site (OTH Regensburg) at first, because it is a
 * customer tool rather than a reusable showcase, so that trap was live again. The mitigation was
 * to keep the registry below a map rather than a constant, so a second Hochschule would be an
 * entry rather than a refactor — and when LMU München arrived, it was exactly that.
 *
 * Both AOIs are unusual in the same way, and it is worth knowing before reading the rest of the
 * engine: each holds TWO campuses and the corridor between them in a single box (PLAN §5.1).
 * Anything that assumes "the campus" is one contiguous blob will look right at Seybothstraße and
 * be wrong 2.5 km west, and right at the Geschwister-Scholl-Platz and wrong 2.4 km south.
 *
 * They differ in one thing the code has to respect: OTH's campuses are fenced sites with
 * outlines, LMU's are addresses in a city it shares with TUM. Which buildings belong to the
 * university is therefore per-AOI configuration (`ownership` in the LMU config), never geometry.
 *
 * Switching sites reloads the page rather than swapping the scene in place: a site change replaces
 * the heightmap, the land cover, the buildings, the vegetation and the drape, so the honest
 * implementation of "switch" is the one that tears everything down.
 */

export interface AoiBbox {
  crs: string;
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Which analytical lens an AOI can support. Not every lens works everywhere — PLAN D6. */
export type LensId = 'occupancy' | 'condition' | 'flow' | 'staffing' | 'quality';

export interface AoiFocusPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind?: string;
  /**
   * Where the coordinate came from, e.g. `"OSM way/29153707"`.
   *
   * Every focus place in both config files carries one. It is shown when a label names something
   * the dataset cannot open, because "this is a real place we did not model" is only credible if
   * the app can say which real place it means.
   */
  source?: string;
}

export interface AoiAttribution {
  authority: string;
  licence: string;
  licenceUrl: string;
  attribution: string;
}

/**
 * A fenced site within the AOI. Both universities here hold two.
 *
 * ⚠️ The ids MATTER, not just the names: a focus place sharing an id with a campus is naming the
 * whole site rather than a building on it. Clicking "Campus Prüfeninger Straße" was opening
 * whichever building happened to stand nearest the campus centroid — a plausible-looking answer to
 * a question nobody asked.
 */
export interface AoiCampus {
  id: string;
  name: Record<string, string>;
}

/**
 * The indoor-data block. Present only where room-level analytics are actually possible.
 *
 * Its absence is meaningful and is not a gap to be filled with defaults. **OTH Regensburg has
 * no `rooms` block** because the probe found 29 mapped rooms in one building and none at the
 * second campus (PLAN §5.4) — the app has to say so rather than render an empty building and
 * let the viewer assume it is loading. What the probe found lives in `indoorProbe` instead.
 */
export interface AoiRooms {
  codePattern: string;
  osmRefKey: string;
  navigatumBase: string;
  navigatumCampusId: string;
  referenceSemester: { id: string; startDate: string; endDate: string };
  exploreBuildings: {
    code: string;
    name: string;
    osmRooms: number;
    navigatumRooms: number;
    levels: string[];
  }[];
  heroBuilding: string;
  storeyHeightM: number;
  /** ⚠️ Synthetic. Floor area per seat, by room usage type — see the AOI config note. */
  seatDensityM2: Record<string, number>;
}

/**
 * What an indoor-data probe FOUND.
 *
 * Recording the result is the point: "we looked, and this is what is there" is a different
 * statement from "nobody has looked yet", and only one of them is safe to build on. The two
 * shipped sites answered the same question differently enough that the shape has to be optional
 * on both halves:
 *
 * - **OTH Regensburg** — 29 mapped rooms in one building at Seybothstraße, none at Prüfening, so
 *   the count is reported PER CAMPUS (`osmIndoorRooms`).
 * - **LMU München** — 952 mapped rooms in the core, of which only 527 are LMU's; the rest belong
 *   to TUM, which shares the box. A per-campus count would have been a per-campus lie, so the
 *   figures reported are the raw total and the attributed one.
 */
export interface AoiIndoorProbe {
  /** OTH form: rooms per campus id. */
  osmIndoorRooms?: Record<string, number>;
  /** LMU form: everything mapped inside the core, whoever owns it. */
  osmIndoorRoomsInCore?: number;
  /** LMU form: the subset this university actually owns. The only figure safe to quote. */
  attributedToLmu?: number;
  codePattern: string;
  buildingsWithLevelTags: Record<string, number>;
}

export interface AoiCondition {
  seed: number;
  gradeScale: number[];
  gradeDistribution: number[];
  costPerM2ByGrade: Record<string, number>;
  priorityWeights: Record<string, number>;
  scenarios: string[];
  horizonYears: { from: number; to: number };
}

export interface AoiConfig {
  id: string;
  site: {
    name: Record<string, string>;
    region: Record<string, string>;
    timezone: string;
  };
  lenses: LensId[];
  bbox: AoiBbox;
  shell: AoiBbox;
  workingCrs: string;
  verticalDatum: string;
  elevationRangeM: { min: number; max: number };
  grids: { sourceResolutionM: number; renderResolutionM: number; renderDecimation: number };
  focusPlaces: AoiFocusPlace[];
  campuses?: AoiCampus[];
  rooms?: AoiRooms;
  indoorProbe?: AoiIndoorProbe;
  condition?: AoiCondition;
  /**
   * Present when the site has a generated timetable, which is what the staffing lens divides.
   * Declared here rather than inferred, so `world.test.ts` can refuse a site that offers the lens
   * without the plan behind it — the same guard that already caught `occupancy` being declared
   * before any room data existed.
   */
  staffing?: { source: string; lecturerTypesModelled: boolean };
  /**
   * Present when the site's plan has been measured for day shape. Same guard as `staffing`:
   * a site with no timetable has no quality to report, and an empty lens reads as a broken one.
   */
  /**
   * Which `SCHEDULER_SITE` the planner backend must be serving for this AOI's plan data to be
   * about THIS university. One backend serves one site, so a mismatch means the calendar and the
   * assistant would be answering from the other university's timetable.
   */
  schedulerSite?: string;
  planQuality?: { source: string; studentGroupMappingModelled: boolean };
  geobasis: AoiAttribution & Record<string, unknown>;
  shellGeobasis: AoiAttribution & Record<string, unknown>;
  tour: { placeId: string; captionKey: string; rangeM: number; holdMs: number }[];
}

/**
 * Every AOI that ships.
 *
 * Listed rather than globbed, so adding a site is a deliberate act with a diff, and so a stray
 * JSON file in `config/aoi/` cannot become a shipped location by accident.
 *
 * ⚠️ SIX OF THESE HAVE NO PLANNER BACKEND, AND THAT IS THE POINT OF `schedulerSite`. Garching and
 * Tübingen came from Campus-Insights, which is a campus twin with no solver behind it; FAU
 * Erlangen, Köln, Aachen and Münster were built later for the same reason — they are the largest
 * German universities this project can reach, and none of them publishes a timetable. They have
 * scenes and no week to replan. Anything that needs the backend keys off `schedulerSite` being
 * present rather than assuming every site has one — see `TwinShell`.
 *
 * ⚠️ FILTERED THROUGH `config/release.json` BEFORE IT IS EXPORTED — see `applyRelease`. For a
 * public release the TUM data, or the whole TUM site, can be withheld without editing this list.
 */
const ALL_AOIS: Record<string, AoiConfig> = {
  'oth-regensburg': othRegensburg as unknown as AoiConfig,
  'lmu-muenchen': lmuMuenchen as unknown as AoiConfig,
  garching: garching as unknown as AoiConfig,
  tuebingen: tuebingen as unknown as AoiConfig,
  'fau-erlangen': fauErlangen as unknown as AoiConfig,
  koeln: koeln as unknown as AoiConfig,
  aachen: aachen as unknown as AoiConfig,
  muenster: muenster as unknown as AoiConfig,
};

/**
 * Strip what a site can no longer support once its source is withheld or substituted.
 *
 * ⚠️ THE LENSES MUST GO WITH THE DATA. `lensesFor()` offers whatever the AOI declares, and
 * `world.test.ts` refuses an `occupancy` lens on a site with no `rooms` block — so dropping the
 * data and leaving the declaration standing produces a lens that opens onto nothing, which reads
 * as a broken app rather than a deliberately smaller one.
 *
 * ⚠️ BUT `rooms` SURVIVES IN SYNTHETIC MODE, and that is the point of that mode. The room
 * POLYGONS are OpenStreetMap's under ODbL — they were never TUM's to withhold — so the building
 * still opens into real floors and real rooms. Only the week inside them is invented.
 *
 * `schedulerSite` goes in both non-`include` modes: `hasPlanner` is `Boolean(schedulerSite)`, and
 * Garching's backend is loaded from `data/tum/`, which is derived from the same TUMonline
 * bookings. Substituting the twin's occupancy does not substitute that.
 */
function withoutNavigatum(aoi: AoiConfig): AoiConfig {
  const { rooms, schedulerSite: _schedulerSite, ...rest } = aoi;
  const lenses = aoi.lenses.filter((id) => !NAVIGATUM_DEPENDENT_LENSES.includes(id));
  return KEEPS_INTERIORS ? { ...rest, rooms, lenses } : { ...rest, lenses };
}

function applyRelease(all: Record<string, AoiConfig>): Record<string, AoiConfig> {
  const shipped: Record<string, AoiConfig> = {};
  for (const [id, aoi] of Object.entries(all)) {
    if (EXCLUDED_AOIS.includes(id)) continue;
    const withoutTum =
      NAVIGATUM_MODE !== 'include' && usesNavigatum(aoi) ? withoutNavigatum(aoi) : aoi;
    shipped[id] = withCustomerDataApplied(withoutTum);
  }
  return shipped;
}

/**
 * Lever C: point a site at the generated week when its customer export is withheld.
 *
 * ⚠️ THIS IS THE SUBSTITUTION, NOT A REMOVAL — see `substituteSchedulerSite` for why dropping the
 * planner from OTH would gut the published template rather than protect anything.
 *
 * ⚠️ THE OBJECT IS ONLY REPLACED WHEN THE SITE ACTUALLY CHANGES. `Twin3DView`'s build effect is
 * keyed on the AOI object's identity, so spreading unconditionally would hand every site a fresh
 * object and reintroduce the WebGL teardown loop documented on `activeAoi()` below.
 */
function withCustomerDataApplied(aoi: AoiConfig): AoiConfig {
  const substitute = substituteSchedulerSite(aoi.schedulerSite);
  if (substitute === aoi.schedulerSite) return aoi;
  if (substitute === undefined) {
    const { schedulerSite: _withheld, ...rest } = aoi;
    return rest as AoiConfig;
  }
  return { ...aoi, schedulerSite: substitute };
}

export const AOIS: Record<string, AoiConfig> = applyRelease(ALL_AOIS);

/**
 * The i18n key for a site's interior-provenance note, which changes when the interiors do.
 *
 * ⚠️ THE NOTE IS THE HONESTY CLAIM, AND A STALE ONE IS WORSE THAN NONE. Garching's note names
 * TUMonline as the source of its bookings. In `synthetic` mode that sentence is false, and it is
 * false on a screen showing REAL room numbers in a REAL building — which is exactly the reading
 * that would be taken as the university's own utilisation. This swaps to the `-synthetic`
 * variant so the claim tracks the data.
 */
export function interiorProvenanceKey(prefix: 'rooms' | 'occupancy', aoiId: string): string {
  const aoi = AOIS[aoiId];
  const substituted = INTERIORS_ARE_SYNTHETIC && aoi != null && usesNavigatum(aoi);
  return `${prefix}.provenance.${aoiId}${substituted ? '-synthetic' : ''}`;
}


export const DEFAULT_AOI = 'oth-regensburg';

/** `?aoi=<id>` in the URL, falling back to a build-time default. A link is the simplest
 * thing to hand to a colleague, which is how this app gets shared. */
export function activeAoiId(): string {
  const fromUrl =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('aoi') : null;
  const requested = fromUrl ?? import.meta.env.VITE_AOI ?? DEFAULT_AOI;
  return requested in AOIS ? requested : DEFAULT_AOI;
}

/**
 * The scheduler sites this build can actually reach.
 *
 * ⚠️ DUPLICATED FROM `SITE_BASES` ON PURPOSE, AND GUARDED BY A TEST. `src/api/scheduler.ts`
 * already imports `activeAoi` from here, so importing `knownSchedulerSites` back would be a cycle
 * — and a cycle evaluated during module initialisation, which is the kind that fails as an empty
 * list rather than as an error. `sites.test.ts` asserts the two agree, which is the same technique
 * this repo uses for the `PlanChange` entity: duplication is fine when something checks it.
 */
const SCHEDULER_SITES = ['oth', 'oth-real', 'lmu', 'tum'] as const;

/**
 * The AOI this build is showing, with `?scheduler=` applied.
 *
 * ⚠️ THE RESULT IS CACHED, AND THAT IS LOAD-BEARING — NOT A MICRO-OPTIMISATION.
 *
 * `Twin3DView`'s build effect is keyed on `[aoi]`, so the OBJECT IDENTITY of what this returns
 * decides whether the 3D scene survives a render. Spreading a fresh `{ ...aoi, schedulerSite }`
 * on every call handed React a new object every time `TwinShell` rendered, and the campus was
 * disposed and rebuilt underneath it — measured at ~25 full WebGL teardowns in 25 seconds, on a
 * page nobody was touching.
 *
 * It only bit when `?scheduler=` was present, because the plain path returns the shared `AOIS`
 * entry and is stable by construction. Pinning the e2e suite to `?scheduler=oth` therefore turned
 * the fault on for every navigation at once: the suite went to 27 minutes, the camera and label
 * specs started failing on timeouts, and clicking a session in the calendar opened its building
 * and then lost it about a second later when the next rebuild landed.
 *
 * The URL cannot change without a reload, so caching on `id + override` is safe and keeps every
 * caller — not just the one that noticed — on a stable object. `aoi.test.ts` guards the identity.
 */
let overriddenAoi: { key: string; value: AoiConfig } | null = null;

export function activeAoi(): AoiConfig {
  const id = activeAoiId();
  const base = AOIS[id];
  const override = schedulerOverride();
  if (!override) return base;

  const key = `${id}::${override}`;
  if (!overriddenAoi || overriddenAoi.key !== key) {
    overriddenAoi = { key, value: { ...base, schedulerSite: override } as AoiConfig };
  }
  return overriddenAoi.value;
}

/**
 * `?scheduler=<site>` — serve this campus's timetable from a different backend.
 *
 * ⚠️ THE POINT IS THAT ONE CAMPUS HAS TWO TIMETABLES AND THE TWIN IS THE SAME EITHER WAY.
 * OTH Regensburg now has both a generated plan (`oth`, what every test pins) and the university's
 * own Untis export (`oth-real`, PLAN §25). The buildings, terrain and walking routes are identical
 * because it is the same campus — only the week differs. Being able to switch between them in
 * front of the customer, on one URL, is the difference between claiming the product reads their
 * data and showing it.
 *
 * ⚠️ AN UNKNOWN VALUE IS IGNORED, NOT PASSED THROUGH. `apiBase()` returns '' for a site it has no
 * URL for, so an unvalidated override would leave the app asking the Fabric host for a timetable
 * and rendering an empty week — a failure that looks like "this university has no plan".
 */
export function schedulerOverride(): string | null {
  if (typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('scheduler');
  if (!requested) return null;
  if (!(SCHEDULER_SITES as readonly string[]).includes(requested)) return null;
  /*
   * ⚠️ THE RELEASE SWITCH HAS TO BE ASKED HERE TOO, NOT ONLY IN `applyRelease`. Substituting the
   * AOI's default protects the site someone LANDS on; this protects the site someone TYPES. A
   * published build that quietly honoured `?scheduler=oth-real` would leave the customer's own
   * timetable one query parameter away — and would answer with an empty week from a backend that
   * does not exist, which reads as a broken product rather than a withheld one.
   */
  return shipsSchedulerSite(requested) ? requested : null;
}

/** Switch site. Reloads, for the reason in the module note. */
export function switchAoi(id: string): void {
  if (!(id in AOIS) || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id === DEFAULT_AOI) url.searchParams.delete('aoi');
  else url.searchParams.set('aoi', id);
  window.location.href = url.toString();
}

/** Does this AOI support a given lens? The UI hides what a site cannot honestly show. */
export function supportsLens(aoi: AoiConfig, lens: LensId): boolean {
  return aoi.lenses.includes(lens);
}

/**
 * Is there a planner behind this site at all?
 *
 * ⚠️ A SITE WITHOUT A BACKEND IS NOT A BROKEN SITE. Garching and Tübingen are campus twins: real
 * terrain, real buildings, real rooms, real lenses — and no timetable, because nobody has given
 * this app one for them. The calendar, the assistant, moves, proposals and replanning all read
 * from a solver that is serving one university's plan, so on a site with no `schedulerSite` they
 * are not degraded, they are meaningless. They are therefore not rendered rather than rendered
 * empty: an empty week grid says "loading" or "no lectures", and both would be untrue.
 */
export function hasPlanner(aoi: AoiConfig): boolean {
  return Boolean(aoi.schedulerSite);
}

/**
 * ── Deep links ────────────────────────────────────────────────────────────────────────────────
 *
 * `activeAoiId` above argues that a link is how this app gets shared — and then only the SITE was
 * linkable, so every interesting view had to be described in prose instead of sent. What is worth
 * sending is rarely a campus: it is `?lens=staffing&teacher=IM-T029`, the lecturer this plan puts
 * at twice his contract, on screen with his week already open.
 *
 * ⚠️ EVERY PARAMETER IS VALIDATED, NEVER TRUSTED. An unknown lens, a lens this site cannot honestly
 * offer, or a building code that does not exist are all IGNORED rather than applied. A stale link
 * should degrade to the plain campus; forcing an empty panel open looks like the app is broken.
 */

export function activeLensId(aoi: AoiConfig): LensId | null {
  if (typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('lens');
  if (!requested) return null;
  return aoi.lenses.includes(requested as LensId) ? (requested as LensId) : null;
}

export function activeBuildingId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('building');
}

export function activeLecturerId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('teacher');
}

/**
 * Write a parameter back, or remove it when the thing it named is closed.
 *
 * ⚠️ `replaceState`, not `pushState`. Opening a panel is not somewhere you navigated to, and
 * filling the back button with lens changes means Back no longer leaves the app.
 */
function remember(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  if (url.toString() !== window.location.href) {
    window.history.replaceState(null, '', url.toString());
  }
}

export const rememberLens = (lens: LensId | null) => remember('lens', lens);
export const rememberBuilding = (code: string | null) => remember('building', code);
export const rememberLecturer = (id: string | null) => remember('teacher', id);
