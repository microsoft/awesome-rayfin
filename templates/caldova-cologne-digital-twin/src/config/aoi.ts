import koelnMesse from '@config/aoi/koeln-messe.json';

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
 * engine: each holds TWO campuses and the corridor between them in a single box.
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

/** Which analytical lens an AOI can support. Not every lens works everywhere. */
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
  /**
   * The OpenStreetMap feature this coordinate was resolved from, e.g. `"way/164569310"`.
   *
   * ⚠️ THIS IS WHAT IDENTIFIES THE HALL, and it is why the app asks the data rather than matching
   * on a name or on proximity. `site3d.heroBuilding` names the building the interior was modelled
   * from; the focus place carrying the same OSM id IS that building. Matching by distance would
   * work today and break the moment a second site building is added within a hundred metres,
   * and matching on a display name would break as soon as the name is translated.
   */
  osm?: string;
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
 * second campus — the app has to say so rather than render an empty building and
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

/**
 * The distribution centre's own interior model.
 *
 * ⚠️ EVERYTHING UNDER HERE IS SYNTHETIC AND THE UI MUST SAY SO. The building ENVELOPE is measured
 * — footprint from the LoD2 survey, height from the same mesh — but no pharmaceutical wholesaler
 * publishes its zone layout, its automation configuration or its shift pattern, and the operator is a
 * named real company. So the chain below is a plausible full-line wholesaler configuration, seeded
 * and committed, rather than a claim about this building. The distinction is the same one the
 * condition lens makes at Tübingen, and it is the one thing this project cannot get wrong quietly.
 */
export interface AoiSite3d {
  seed: number;
  /** The measured OSM way whose footprint the interior is fitted into. */
  heroBuilding: string;
  /** Process order, goods-in first. The explode pulls the hall apart along THIS axis, not by floor —
   * a distribution centre is one tall hall and floors are the wrong dimension to separate it on. */
  zoneChain: string[];
  coldChainRangeC: [number, number];
  shiftPattern: {
    nightPickStart: string;
    nightPickEnd: string;
    tourWaves: string[];
  };
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
  site3d?: AoiSite3d;
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
 * ⚠️ ONE SITE, ON PURPOSE. The engine this is forked from shipped four universities and a site
 * switcher, and both came across in the fork — but their terrain, drape and building assets are
 * gitignored and were never generated here, so every one of them would render as a black canvas
 * over an empty scene. A switcher offering four broken sites is worse than no switcher: it turns a
 * working demo into one where three of the four things a customer might click are faults. The
 * campus AOIs and their configs stay in `config/aoi/` as reference for the geodata pipeline, and
 * deliberately do NOT appear here.
 */
export const AOIS: Record<string, AoiConfig> = {
  'koeln-messe': koelnMesse as unknown as AoiConfig,
};

export const DEFAULT_AOI = 'koeln-messe';

/** `?aoi=<id>` in the URL, falling back to a build-time default. A link is the simplest
 * thing to hand to a colleague, which is how this app gets shared. */
export function activeAoiId(): string {
  const fromUrl =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('aoi') : null;
  const requested = fromUrl ?? import.meta.env.VITE_AOI ?? DEFAULT_AOI;
  return requested in AOIS ? requested : DEFAULT_AOI;
}

export function activeAoi(): AoiConfig {
  return AOIS[activeAoiId()];
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
