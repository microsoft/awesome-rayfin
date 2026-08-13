/**
 * The scene: terrain under an orthophoto, an opaque sea, and 54 000 buildings.
 *
 * Conventions, and they are load-bearing:
 *   * **+x east, +z south, y up.** The rasters have row 0 at the NORTH, and the building mesh was
 *     written to the same convention. Getting this wrong mirrors the coast against its own map.
 *   * **True scale.** No vertical exaggeration. With only ~72 m of relief the temptation is real,
 *     but the app's whole argument is a shadow cast by measured terrain.
 *   * **The scene has no lights.** Every material bakes its own shading, so a standard Three.js
 *     material renders black. The same sun vector is repeated in each one.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ProtectedAsset, TerrainData } from "./loader";
import { createFlyControls, type FlyControls, type FlyTelemetry } from "./flyControls";
import {
  createBuffers, fill, LIVE_CAPACITY, LIVE_HEAD_SCALE, type LiveBuffers, type LiveVessel,
} from "./liveSource";
import {
  azimuthsFor,
  computeViewshed,
  hasLineOfSight,
  measureApproachCoverage,
  radarHorizonM,
  resampleGround,
  type ApproachCoverage,
  type ViewshedResult,
} from "./viewshed";
import { summariseNetwork, type NetworkCoverage } from "./network";
import { clockUtc, type ReportMissedPassage, type ReportModel, type ReportSite } from "./report";
import { coverageOf, greedyMaxCoverage, type CoverageCandidate } from "./optimise";
import { SCENE_THEMES, type ThemeName } from "../theme";

/**
 * How far below the water plane hidden sea geometry is pushed.
 *
 * 🔴 This started at 0.5 m, which is plenty in principle and nowhere near enough in practice: with
 * a far plane of 90 km the depth buffer cannot separate two surfaces half a metre apart at fjord
 * distance, and the water rendered as a field of speckle where the terrain and the plane fought.
 * The fix is separation, not precision — the geometry is under an opaque surface and nobody can
 * see how far under it is.
 */
const SUBMERGED_DROP_M = 25;

/**
 * How close a click has to be to a vessel to select it, **in pixels**.
 *
 * A moving vessel is a few pixels across, so the target is deliberately larger than the mark —
 * about a fingertip on a trackpad. The trail radius is tighter because a trail covers most of the
 * water on a narrow inlet, and a click that lands on water is far more likely to mean "put a mast
 * here" than "tell me about this passage".
 */
const VESSEL_PICK_PX = 16;
const TRAIL_PICK_PX = 7;

const SUN = new THREE.Vector3(-0.55, 0.62, -0.55).normalize();

/**
 * Shell cells at or below this height are treated as sea and hidden under the water plane.
 * Copernicus GLO-30 reports the Baltic at roughly 0 m with a few metres of noise, so a cut a
 * little above zero is what actually separates its water from its land. It is a rendering
 * decision on a coarse background tier and it touches no measured value in the core.
 */
const SHELL_SEA_CUT_M = 1.5;

/**
 * Hillshade z-factor — **shading only, geometry untouched**.
 *
 * 🔴 This coast is genuinely flat: the core spans −11.4 … 60.8 m over 11 × 18 km, an aspect ratio
 * of about 1:180, and the whole shell tops out at 176 m (the Bungsberg, the highest point in the
 * state, is 168 m). At true scale the real slopes are 1–3°, so the surface normal barely moves and
 * every lit term lands within a few percent of the same value. The terrain does not look flat
 * because of a bug; it looks flat because it *is* flat, and because nothing in the shading was
 * amplifying the little relief there is.
 *
 * The fix is the cartographer's one, not the game developer's: exaggerate the **normal** used for
 * shading, which is exactly equivalent to a hillshade z-factor, and leave every vertex where the
 * survey put it.
 *
 * ⚠️ Exaggerating the GEOMETRY instead would have been the obvious move and would have broken the
 * app's central claim. The viewshed marches over true elevations, so a stretched landscape would
 * render a shadow that no longer matched the terrain drawn under it — a demo that contradicts
 * itself in front of the one audience most likely to check.
 */
const HILLSHADE_Z_FACTOR = 7.0;

/**
 * The coverage field, shared verbatim by the terrain, the sea and the vessel tracks.
 *
 * Sampling one texture from three materials is what makes the shadow a property of the *place*
 * rather than a decal on one surface: the same headland shadow falls across the water, up the
 * beach behind it, and over any vessel sitting inside it, because all three ask the same question
 * of the same field.
 *
 * The field encodes three states, and the third one matters as much as the other two:
 * unknown (nothing is claimed), shadowed (in range, terrain in the way), visible. Painting
 * "not visible" as a single colour would quietly merge *we modelled this and it is blocked* with
 * *we did not model this at all*.
 */
const COVERAGE_GLSL = /* glsl */ `
  uniform sampler2D uField;
  uniform sampler2D uCount;
  uniform vec2 uFieldOrigin;
  uniform vec2 uFieldSize;
  uniform float uCoverageMode;
  uniform float uCoverageStrength;
  uniform float uOverlapMode;
  uniform vec3 uCoverVisible;
  uniform vec3 uCoverOverlap;
  uniform vec3 uCoverShadow;
  uniform float uCoverShadowMix;

  // Returns 0.0 unknown, 0.5 shadowed, 1.0 visible.
  float coverageAt(vec2 worldXZ) {
    vec2 uv = (worldXZ - uFieldOrigin) / uFieldSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uField, uv).r;
  }

  // How many sites hold this ground, as a count rather than a normalised fraction.
  float sitesAt(vec2 worldXZ) {
    vec2 uv = (worldXZ - uFieldOrigin) / uFieldSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uCount, uv).r * 255.0;
  }

  vec3 applyCoverage(vec3 base, vec2 worldXZ) {
    if (uCoverageMode < 0.5) return base;
    float state = coverageAt(worldXZ);

    // Overlap view: the question is not whether the ground is held but by how many, because that
    // is what decides whether losing one site loses the ground with it.
    if (uOverlapMode > 0.5) {
      float n = sitesAt(worldXZ);
      if (n > 1.5) {
        // Held twice or more: survives a site going down.
        return mix(base, uCoverVisible, 0.34 * uCoverageStrength);
      } else if (n > 0.5) {
        // Held by exactly one site. Not a failure — a dependency, and worth seeing as one.
        return mix(base, uCoverOverlap, 0.34 * uCoverageStrength);
      } else if (state > 0.25) {
        return mix(base, uCoverShadow, uCoverShadowMix * uCoverageStrength);
      }
      return base;
    }
    // Thresholding after a linear fetch keeps the boundary crisp at sub-cell precision instead of
    // showing the 16 m grid the field is stored on.
    if (state > 0.75) {
      return mix(base, uCoverVisible, 0.30 * uCoverageStrength);
    } else if (state > 0.25) {
      // Shadow reads as absence, not as an alarm colour. It is a geometric fact, not a threat.
      return mix(base, uCoverShadow, uCoverShadowMix * uCoverageStrength);
    }
    return base;
  }
`;

/** What to do about the drape texture's memory, and why — see `drapeMemoryPlan`. */
export interface DrapeMemoryPlan {
  /** Whether to build a mip chain. */
  mipmaps: boolean;
  /** Whether the texture exceeds the GPU's limit and will therefore not render at all. */
  oversize: boolean;
  /** Bytes the base level occupies as RGBA, before any mip chain. */
  bytes: number;
  /** A sentence the next reader can act on. Never empty — the failure mode here was silence. */
  note: string;
}

/**
 * Decide whether the drape can afford a mip chain.
 *
 * 🔴 **This shipped wrong once and it made the entire core terrain black.** The Förde drape is
 * 5260 × 8192 — 164 MB as RGBA, around 230 MB with a mip chain. On a shared-memory integrated GPU,
 * `generateMipmap` on that surface produced a texture that sampled **zero**: no exception, no
 * warning, no GL error. Sky, sea, horizon shell and buildings all kept rendering, so the result
 * looked like a deliberate dark basemap rather than a broken one.
 *
 * Measured one variable at a time: mipmaps on → 0/3 land sample points lit, 0.366 of the frame
 * near-black, first frame 38 s (133 s with anisotropy off). Mipmaps off → 3/3 lit, 0.001 near
 * black, first frame 7.5 s.
 *
 * ⚠️ A budget, not a blanket ban. Dropping the chain costs minification aliasing at range, and a
 * smaller site has no reason to pay that — so the threshold is stated here as a decision rather
 * than left to whichever texture happens to break first.
 */
export function drapeMemoryPlan(
  width: number,
  height: number,
  maxTextureSize: number,
): DrapeMemoryPlan {
  const bytes = width * height * 4;
  const megabytes = bytes / 1024 / 1024;
  const size = `${width}x${height}`;

  // PLAN §10: a texture over MAX_TEXTURE_SIZE fails silently, so assert the dimensions in code.
  if (width > maxTextureSize || height > maxTextureSize) {
    return {
      mipmaps: false,
      oversize: true,
      bytes,
      note: `${size} exceeds MAX_TEXTURE_SIZE ${maxTextureSize}; the drape will not render. `
        + "Split it into tiles or downsample the source.",
    };
  }

  if (megabytes > DRAPE_MIPMAP_BUDGET_MB) {
    return {
      mipmaps: false,
      oversize: false,
      bytes,
      note: `${size} is ${megabytes.toFixed(0)} MB as RGBA, over the `
        + `${DRAPE_MIPMAP_BUDGET_MB} MB budget: mipmaps dropped, because generating them on a `
        + "surface this size has been measured to produce a texture that samples black with no "
        + "error. Costs minification aliasing at range.",
    };
  }

  return {
    mipmaps: true,
    oversize: false,
    bytes,
    note: `${size} is ${megabytes.toFixed(0)} MB as RGBA, within the `
      + `${DRAPE_MIPMAP_BUDGET_MB} MB budget: mipmaps kept for clean minification at range.`,
  };
}

/**
 * The largest base texture, in MB, that may still build a mip chain.
 *
 * 64 MB is 4096 × 4096 exactly — deliberately a round texture size rather than a round number of
 * megabytes, so the boundary lands where a reader would expect it to.
 */
const DRAPE_MIPMAP_BUDGET_MB = 64;

/**
 * What the app is able to say about one vessel.
 *
 * ⚠️ The identity fields are **optional, and the panel must treat an absent one as unknown rather
 * than as a blank**. AIS transmits identity in a *static* report every few minutes while positions
 * arrive every few seconds, so a vessel can be tracked perfectly well and still have no name in
 * the data — and an anonymised build (`fetch_ais.py --identity anonymous`) has none at all. In
 * that case `vessel` is a salted digest that means nothing outside the day it was built from.
 * Everything below the identity block is measured from the track itself, not looked up.
 */
export interface VesselDetails {
  /** MMSI when the day carries identity, otherwise a salted pseudonym stable within the day. */
  vessel: string;
  /** AIS ship type as the feed reported it (ITU-R M.1371 class). */
  type: string;
  /** Identity as transmitted. Absent when never received, or when the build is anonymised. */
  name?: string;
  mmsi?: string;
  callSign?: string;
  imo?: string;
  destination?: string;
  draughtM?: string;
  lengthM?: number;
  beamM?: number;
  /** Whether the vessel is under way at the current replay clock. */
  underWay: boolean;
  speedKn: number;
  courseDeg: number | null;
  lat: number;
  lon: number;
  fromS: number;
  toS: number;
  reportCount: number;
  distanceKm: number;
  /** Fastest report of the passage. */
  maxSpeedKn: number;
  avgSpeedKn: number;
  /** Share of reports under 0.5 kn — moored, waiting for a lock, or holding station. */
  stoppedShare: number;
  /** Median seconds between reports. A real AIS characteristic: it varies with speed and class. */
  medianReportGapS: number | null;
  /**
   * Whether the currently placed site would have seen this passage, and how much of it.
   * Null when no site is placed — the question does not exist yet.
   */
  observed: { seen: boolean; share: number } | null;
}

/**
 * What a site would have observed of a real day's traffic — the figure a requirement can be
 * written against, as opposed to an area in km².
 */
export interface TrafficCoverage {
  /** Passages that entered the modelled area at all. Those that never did are excluded. */
  passages: number;
  /** Passages with at least one position in a cell the model marks visible. */
  observedPassages: number;
  missedPassages: number;
  passageShare: number;
  /** Share of individual reports observed — how continuously traffic was held, not just seen. */
  positionShare: number;
}

/**
 * How many sites a network may hold.
 *
 * Five, because the passage-observation masks are bit-per-site and because a chain longer than
 * this stops being something a viewer can reason about on one screen — not because the solver
 * cares. Raising it means widening the mask type and nothing else.
 */
const MAX_SITES = 5;

/** Mast height a first site starts at, in metres. Later ones inherit from the selected site. */
const DEFAULT_MAST_M = 25;

/**
 * Distance a passage must travel before the optimiser treats it as a transit.
 *
 * 🔴 The same 0.5 km the exported annex uses to label stationary vessels — deliberately one
 * threshold with one explanation rather than two that could drift. Measured on the real day: of
 * 261 passages, 108 never travel this far, and they are overwhelmingly moored craft whose standing
 * transmissions the 20-minute gap rule splits into several counted "passages".
 */
const TRANSIT_MIN_KM = 0.5;

/**
 * Spacing of the positions the optimiser is allowed to consider, in metres.
 *
 * This is the **resolution of the recommendation** and is reported alongside it: the answer is the
 * best position on this lattice, not the best position that exists. Tightening it multiplies the
 * search cost, since every candidate costs one viewshed.
 */
const CANDIDATE_SPACING_M = 800;

/** One proposed mast position, and what it adds to the ones before it. */
export interface OptimisedSite {
  col: number;
  row: number;
  lat: number;
  lon: number;
  groundM: number;
  newlyCovered: number;
  cumulative: number;
}

export interface OptimisationResult {
  /** Passages that qualified as transits — the denominator for every count here. */
  transits: number;
  candidatesTried: number;
  candidateSpacingM: number;
  mastM: number;
  /** Transits the network the user placed by hand covers, scored on the same objective. */
  currentCovered: number;
  currentSites: number;
  picks: OptimisedSite[];
}

/**
 * Which question the app is asking. Same terrain, same solver, different target and different
 * object — see the note on `scenario` in `createScene`.
 */
export type Scenario = "maritime" | "counterUas";

/** One rung of the altitude ladder: how much of the approach is covered at this drone height. */
export interface AltitudeRung {
  heightM: number;
  share: number;
  widestGapDeg: number;
}

export interface SceneHandle {
  dispose(): void;
  frameCount(): number;
  /** Replay clock, seconds since 00:00 UTC of the track day. */
  setTime(seconds: number): void;
  vesselsVisible(): number;
  /** Place another notional site. Returns null when the click missed, or the network is full. */
  placeSiteFromPointer(ndcX: number, ndcY: number): { col: number; row: number } | null;
  /** Every site in the network, with what its own field cost and reaches. */
  sites(): {
    id: number; col: number; row: number; mastM: number;
    groundM: number; eyeM: number; horizonM: number; visibleKm2: number;
  }[];
  maxSites(): number;
  selectedSiteId(): number | null;
  /** The selected site is the one the mast slider and `flyToMast` act on. */
  selectSite(id: number | null): void;
  removeSite(id: number): void;
  setSiteMast(id: number, mastM: number, quality?: "drag" | "full"): void;
  /**
   * What the network as a whole observed, and what each site contributed to it.
   *
   * Null until a site exists. The per-site `uniquePassages` is the figure that decides a purchase:
   * strike that site and those passages stop being observed by anything.
   */
  networkStats(): NetworkCoverage | null;
  /**
   * Everything the exportable annex needs. Null until a site exists.
   *
   * `missedLimit` caps the missed-passage table so a 200-row annex does not bury its own summary;
   * the full counts are in the figures above it either way.
   */
  reportData(missedLimit?: number): ReportModel | null;
  /**
   * Search for good mast positions by greedy maximum coverage.
   *
   * Chunked across frames; resolves null if cancelled or if there is nothing to measure. The
   * objective counts **transits only** — see the implementation note on why that is not the same
   * as the headline figure.
   */
  optimiseSites(
    count: number,
    mastM: number,
    onProgress?: (done: number, total: number) => void,
    shouldCancel?: () => boolean,
  ): Promise<OptimisationResult | null>;
  /** Replace the network with the given sites, each keeping its own mast height. */
  applySites(positions: { col: number; row: number; mastM: number }[]): void;
  /** Colour the ground by how many sites hold it, rather than by whether any does. */
  setOverlapMode(on: boolean): void;
  setLevers(mastM: number, targetM: number): void;
  /** Re-run at full ray density once a slider is released. */
  settleLevers(): void;
  coverageStats(): {
    visibleKm2: number;
    shadowedKm2: number;
    siteGroundM: number;
    eyeM: number;
    horizonM: number;
    elapsedMs: number;
    traffic: TrafficCoverage | null;
    /** Approach coverage of the selected object. Null outside the counter-UAS scenario. */
    approach: ApproachCoverage | null;
  } | null;
  setCoverageMode(on: boolean): void;
  setGapMode(on: boolean): void;
  /**
   * Switch between the maritime and counter-UAS questions.
   *
   * This is a view decision, not a model one: it changes which layers draw and which figure is
   * reported, and touches no measured value. Switching also presets the vessel layer, because the
   * ship trails are the single biggest source of clutter when the subject is an airfield.
   */
  setScenario(next: Scenario): void;
  scenario(): Scenario;
  /** The published objects the counter-UAS scenario can be measured against. Empty without data. */
  protectedAssets(): ProtectedAsset[];
  setSelectedAsset(id: string | null): void;
  selectedAsset(): ProtectedAsset | null;
  /** Notional planning radius around the selected object. Cites no regulation. */
  setProtectionRadius(radiusM: number): void;
  protectionRadiusM(): number;
  /** Approach coverage of the selected object at the current target height, or null. */
  approachStats(): ApproachCoverage | null;
  /** Run the altitude ladder. One full solve per rung, so call it on demand, not per frame. */
  sweepAltitudes(heightsM: number[]): AltitudeRung[];
  /** Show or hide the vessel layer independently of the scenario preset. */
  setVesselsVisible(on: boolean): void;
  vesselsShown(): boolean;
  /**
   * Remove the notional site and put the scene back to plain terrain.
   *
   * Placing a site tints every surface in the AOI, which is the point while you are reading
   * coverage and very much not the point when you want to look at the fjord. There has to be a
   * way back out.
   */
  clearSite(): void;
  /**
   * Select the vessel nearest the pointer, if one is under way and close enough on screen.
   * Returns null when the click lands on empty water, which also clears any selection.
   */
  pickVesselFromPointer(ndcX: number, ndcY: number): VesselDetails | null;
  /** Live state of the selected vessel at the current clock. Safe to poll. */
  selectedVessel(): VesselDetails | null;
  clearVessel(): void;
  siteMarkerVisible(): boolean;
  /**
   * Switch between the observer camera (orbit) and drone mode (free flight).
   *
   * Drone mode has no collision and no flight physics. It is a camera, not a simulator.
   */
  setDroneMode(on: boolean): void;
  /** Whether the viewer currently has the camera. Flips on its own, so also see `onDroneMode`. */
  droneEngaged(): boolean;
  /** Subscribe to the latch, so the UI can follow a mode it did not switch. Null to unsubscribe. */
  onDroneMode(listener: ((engaged: boolean) => void) | null): void;
  droneTelemetry(): FlyTelemetry | null;
  /**
   * Whether the site could see the camera **where it actually is**, at its own altitude.
   *
   * Not a lookup in the coverage field: that field is solved for the target-height slider, and
   * the drone is wherever it has been flown to. Null without a site or off the grid.
   */
  coverageAtCamera(): "visible" | "shadowed" | null;
  /** Put the camera on top of the mast, looking out to sea. Returns false without a site. */
  flyToMast(): boolean;
  /**
   * Bring a geographic position into view, looking down at it from the south.
   *
   * Returns false when the position falls outside the modelled area — a live feed is bounded by
   * the relay's box, which is the shell rather than this core, so a vessel can legitimately be
   * real and still be somewhere this app does not draw.
   */
  flyToLonLat(lon: number, lat: number, rangeM?: number): boolean;
  /** Frame the live traffic currently on the water. False when there is none to frame. */
  focusOnTraffic(rangeM?: number): boolean;
  /** Drop the notional site directly beneath the camera. */
  placeSiteAtCamera(): boolean;
  /**
   * Switch the vessel layer between the recorded day and the live feed.
   *
   * Both draw through the same geometry layout, the same materials and the same clock uniform;
   * only the buffer contents and what "now" means differ. They are mutually exclusive because
   * showing a recorded day beside live traffic on one clock would be a lie.
   */
  setLiveMode(on: boolean): void;
  /**
   * Repaint the scene in the given palette.
   *
   * ⚠️ Uniform writes only — no material is rebuilt, so this cannot change geometry, the
   * viewshed, or any measured figure. `e2e/theme.spec.ts` asserts exactly that.
   */
  setTheme(name: ThemeName): void;
  /** Push the current live picture into the render buffers. Returns points drawn. */
  setLiveVessels(vessels: Map<string, LiveVessel>): number;
  stats(): { triangles: number; drawCalls: number; textureMB: number; geometryMB: number };
}

export function createScene(
  canvas: HTMLCanvasElement,
  data: TerrainData,
  initialTheme: ThemeName = "dark",
): SceneHandle {
  const { meta, elevation, land, drape, shell, los, assets, tracks, buildings } = data;
  const widthM = meta.width * meta.resolutionM;
  const depthM = meta.height * meta.resolutionM;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Without this `readPixels` always returns zeroes, which makes any rendered-output test
    // silently pass on a black frame.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x9fb8c4);

  const scene = new THREE.Scene();
  // 🔴 Fog has to reach as far as the terrain does — and no further. It used to end at
  // depthM * 2.2 ≈ 39 km, which was fine while the shell stopped at roughly the same distance and
  // pointless afterwards: a horizon widened to ~180 km would have been built, shipped and then
  // hidden inside grey.
  //
  // The far distance is derived from the shell's SHORTEST half-extent, not picked. The shell is a
  // rectangle, so its nearest edge is the one that decides when the data runs out; a fog that
  // reaches past it leaves that edge faintly visible as a straight line across the sea, which
  // reads as a rendering fault rather than as a horizon. Deriving it also means the next person to
  // widen the shell gets the right fog for free.
  const shellHalfM = shell
    ? Math.min(shell.meta.width * (shell.meta.resolutionM ?? 90),
               shell.meta.height * (shell.meta.resolutionM ?? 90)) / 2
    : depthM * 2.2;
  const fogFarM = Math.max(depthM * 2.2, shellHalfM * 0.97);
  // Near distance stays close to the core so the fjord itself is never hazy.
  scene.fog = new THREE.Fog(0x9fb8c4, widthM * 1.6, fogFarM);

  // Far plane sized to what the fog actually reveals, plus margin — NOT to the shell's full
  // diagonal. 🔴 The depth buffer is the reason: SUBMERGED_DROP_M was tuned against a 90 km far
  // plane, and precision at fjord range degrades with the near:far ratio, so quietly tripling it
  // would bring back the speckle across the water that the drop exists to prevent.
  const camera = new THREE.PerspectiveCamera(50, 1, 60, Math.round(fogFarM * 1.3));
  camera.position.set(2600, 3400, 9000);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.minDistance = 250;
  controls.maxDistance = 40_000;
  // Stops the camera dropping under the terrain, which on a coast means ending up inside the sea.
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.target.set(0, 0, 1200);

  // ---------------------------------------------------------------- the coverage field
  // Uniforms are created up front and shared by reference across every material that draws the
  // field, so recomputing a viewshed is one texture upload rather than a per-material update.
  //
  // 🔴 The blocking surface and the ground a mast stands on are two different rasters, and they
  // only became different when the measured surface top (bDOM) went in. `surfaceM` is what stops
  // a sight line — canopy included. `groundM` is bare earth, resampled here from the 4 m
  // heightmap that is already loaded, so it costs no download. Reading the site's own elevation
  // out of `surfaceM` would stand every mast in a wood on top of the trees and hand it 20 m of
  // free antenna, which is precisely the overstatement the vegetation layer was bought to end.
  const losGrid = los
    ? { width: los.meta.width, height: los.meta.height, resolutionM: los.meta.resolutionM,
        surfaceM: los.surfaceM,
        groundM: resampleGround(elevation, meta, los.meta) }
    : null;
  const fieldWidthM = losGrid ? losGrid.width * losGrid.resolutionM : widthM;
  const fieldDepthM = losGrid ? losGrid.height * losGrid.resolutionM : depthM;
  const fieldTexture = new THREE.DataTexture(
    new Uint8Array(losGrid ? losGrid.width * losGrid.height : 1),
    losGrid ? losGrid.width : 1,
    losGrid ? losGrid.height : 1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  fieldTexture.minFilter = THREE.LinearFilter;
  fieldTexture.magFilter = THREE.LinearFilter;
  fieldTexture.needsUpdate = true;

  /**
   * How many sites hold each cell.
   *
   * A separate texture rather than a second channel on the field, because the two are read for
   * different questions and one of them is usually off. **Nearest** filtering, unlike the field:
   * interpolating between one site and two would paint a fringe of "one and a half sites", and a
   * redundancy view that invents intermediate values is worse than none.
   */
  const countTexture = new THREE.DataTexture(
    new Uint8Array(losGrid ? losGrid.width * losGrid.height : 1),
    losGrid ? losGrid.width : 1,
    losGrid ? losGrid.height : 1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  countTexture.minFilter = THREE.NearestFilter;
  countTexture.magFilter = THREE.NearestFilter;
  countTexture.needsUpdate = true;

  const coverage = {
    uniforms: {
      uField: { value: fieldTexture },
      uCount: { value: countTexture },
      // The LOS grid is trimmed to whole cells, so it is a few metres shorter than the terrain.
      // Anchoring on the shared north-west corner keeps the two aligned to the metre.
      uFieldOrigin: { value: new THREE.Vector2(-widthM / 2, -depthM / 2) },
      uFieldSize: { value: new THREE.Vector2(fieldWidthM, fieldDepthM) },
      uCoverageMode: { value: 0 },
      uCoverageStrength: { value: 1 },
      uGapMode: { value: 0 },
      uOverlapMode: { value: 0 },
    },
  };

  /**
   * Every colour the 3D scene used to hard-code, as uniforms.
   *
   * 🔴 Spread **wholesale** into every ShaderMaterial rather than picked per material. three
   * silently ignores uniforms a program does not declare, so one object can serve all six shaders
   * and there is no per-material list to keep in step — which is the maintenance failure that
   * would otherwise reintroduce a hard-coded colour the next time a shader is edited.
   *
   * ⚠️ Switching theme is a handful of `.set()` calls: no material is recompiled, no program is
   * relinked, and no frame is dropped. That is the whole reason this is uniforms and not a second
   * set of materials.
   */
  const initialScene = SCENE_THEMES[initialTheme];
  const themeUniforms = {
    uTerrainRamp: { value: new THREE.Vector2(...initialScene.terrainRamp) },
    uShellLow: { value: new THREE.Color(...initialScene.shellLow) },
    uShellHigh: { value: new THREE.Color(...initialScene.shellHigh) },
    uShellRamp: { value: new THREE.Vector2(...initialScene.shellRamp) },
    uSeaGlitter: { value: initialScene.seaGlitter },
    uBuildingBase: { value: new THREE.Color(...initialScene.buildingBase) },
    uBuildingRamp: { value: new THREE.Vector2(...initialScene.buildingRamp) },
    uCoverVisible: { value: new THREE.Color(...initialScene.coverVisible) },
    uCoverOverlap: { value: new THREE.Color(...initialScene.coverOverlap) },
    uCoverShadow: { value: new THREE.Color(...initialScene.coverShadow) },
    uCoverShadowMix: { value: initialScene.coverShadowMix },
    uTrailSlow: { value: new THREE.Color(...initialScene.trailSlow) },
    uTrailFast: { value: new THREE.Color(...initialScene.trailFast) },
    uTrailMuted: { value: new THREE.Color(...initialScene.trailMuted) },
    uTrailAlert: { value: new THREE.Color(...initialScene.trailAlert) },
    uHeadSlow: { value: new THREE.Color(...initialScene.headSlow) },
    uHeadFast: { value: new THREE.Color(...initialScene.headFast) },
    uHeadMuted: { value: new THREE.Color(...initialScene.headMuted) },
    uHeadAlert: { value: new THREE.Color(...initialScene.headAlert) },
  };

  // ---------------------------------------------------------------- terrain
  // Decimated 4x to 16 m posting. One vertex per heightmap cell would be 12.5 M — far more than
  // is visible at any sensible camera distance.
  const step = 4;
  const segX = Math.floor(meta.width / step) - 1;
  const segZ = Math.floor(meta.height / step) - 1;
  const geometry = new THREE.PlaneGeometry(widthM, depthM, segX, segZ);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  // 🔴 Sea cells are pushed BELOW the sea plane rather than drawn at their measured height.
  // DGM1 carries real values under water and they straddle zero (−11.38 … +0.05 m), so at 16 m
  // posting individual shallow cells poke through the plane and the coast renders as a band of
  // speckle — which is exactly how it looked on the first deploy. The data is left untouched;
  // only the rendered surface is corrected, and the land mask is what decides.
  const seaFloorY = meta.seaLevelM - SUBMERGED_DROP_M;
  for (let row = 0; row <= segZ; row += 1) {
    for (let col = 0; col <= segX; col += 1) {
      const index = row * (segX + 1) + col;
      const cell = Math.min(row * step, meta.height - 1) * meta.width
        + Math.min(col * step, meta.width - 1);
      position.setY(index, land[cell] ? elevation[cell] : seaFloorY);
      // 🔴 PlaneGeometry's v=0 lands on the SOUTH edge after rotateX(-PI/2), while the raster and
      // the drape both start at the NORTH. Without this flip the entire map is mirrored, and it
      // looks plausible enough to survive review.
      uv.setY(index, 1 - uv.getY(index));
    }
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();

  const drapeTexture = new THREE.Texture(drape as unknown as HTMLImageElement);
  drapeTexture.colorSpace = THREE.SRGBColorSpace;

  // 🔴 The mip chain is a budget decision, and getting it wrong rendered the entire core terrain
  // BLACK — see `drapeMemoryPlan` for the measurements. The plan is logged rather than applied
  // silently, because the failure it prevents produced no exception, no warning and no GL error.
  const drapePlan = drapeMemoryPlan(
    drape.width, drape.height, renderer.capabilities.maxTextureSize);
  drapeTexture.generateMipmaps = drapePlan.mipmaps;
  if (!drapePlan.mipmaps) {
    // Without a mip chain, LinearMipmap* filtering samples a chain that does not exist and the
    // texture reads as black — the minification filter has to come down with it.
    drapeTexture.minFilter = THREE.LinearFilter;
  }
  drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  drapeTexture.needsUpdate = true;
  if (drapePlan.oversize) console.error(`drape: ${drapePlan.note}`);
  else console.info(`drape: ${drapePlan.note}`);

  const terrainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uDrape: { value: drapeTexture },
      uSun: { value: SUN },
      uZFactor: { value: HILLSHADE_Z_FACTOR },
      ...coverage.uniforms,
      ...themeUniforms,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
  uniform vec2 uTerrainRamp;
      uniform sampler2D uDrape;
      uniform vec3 uSun;
      uniform float uZFactor;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorld;
      ${COVERAGE_GLSL}

      /**
       * Steepen a surface normal as if the height field had been multiplied by z, without moving
       * anything. For a height field the normal is proportional to (-dh/dx, 1, -dh/dz), so scaling
       * the horizontal components by z is identical to exaggerating the height by z.
       */
      vec3 steepen(vec3 n, float z) {
        return normalize(vec3(n.x * z, n.y, n.z * z));
      }

      void main() {
        vec3 photo = texture2D(uDrape, vUv).rgb;
        vec3 N = steepen(normalize(vNormal), uZFactor);
        float lambert = clamp(dot(N, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
        // Wider than the old 0.62..1.00 band, but not so wide that the orthophoto's own lighting
        // gets fought. With the normal steepened there is finally something for the range to
        // show; at the previous width every slope on this coast landed between 0.90 and 0.95 and
        // the ground read as a painted plane.
        vec3 lit = photo * (uTerrainRamp.x + uTerrainRamp.y * lambert);
        gl_FragColor = vec4(applyCoverage(lit, vWorld.xz), 1.0);
      }
    `,
  });
  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  scene.add(terrain);

  // ---------------------------------------------------------------- the sea
  // 🔴 An opaque plane at mean sea level, NOT a tint on the terrain. The drape is a photograph of
  // the ground and the sea is not ground: over water it carries the WMS request seams as visible
  // banding and a white block where the survey ends. A plane at y = 0 hides both, and it is also
  // simply what is true — the Baltic is tideless to ~0.2 m, so the surface really is a plane.
  //
  // ⚠️ It has to span the SHELL, not the core. Sized to the core it left the Baltic beyond the
  // core's edge being drawn by the horizon tier as green land, which is what the first render with
  // a shell actually looked like. The shell is now ~181 x 156 km, so the old
  // `max(width, depth) * 6` (106 km) would have reintroduced exactly that bug at the new extent.
  // Fixed at 400 km: comfortably past both the shell and the 120 km far plane, and it costs two
  // triangles either way.
  const seaSpan = 400_000;
  const seaGeometry = new THREE.PlaneGeometry(seaSpan, seaSpan);
  seaGeometry.rotateX(-Math.PI / 2);

  /**
   * Shore proximity — and pointedly **not** depth.
   *
   * 🔴 The first version of this shaded the water by "bathymetry" read out of DGM1, and it was
   * wrong in a way that looked convincing. Measured afterwards: of the sea cells, the median
   * depth is **0.13 m** and p75 is 0.23 m — DGM1 is a *ground* survey and simply does not map the
   * fjord floor. Worse, 21 % of sea cells sit at exactly 11.38 m, which is `heightMinM`: the
   * floor value Phase 1 assigns to **no-data**. Colouring by that would have drawn the unsurveyed
   * north-east corner as deep water and the entire fjord as a shallow lagoon — presenting missing
   * data as a measurement, which PLAN §3.2 rule 6 exists to forbid.
   *
   * What *is* real is the coastline, so the water is shaded by distance to it instead. That
   * claims only what the land mask actually knows, and it is why the shallows brighten near the
   * shore rather than over an invented seabed.
   */
  const SHORE_STEP = 8;
  const shoreW = Math.floor(meta.width / SHORE_STEP);
  const shoreH = Math.floor(meta.height / SHORE_STEP);
  const shoreFrac = new Float32Array(shoreW * shoreH);
  for (let r = 0; r < shoreH; r += 1) {
    for (let c = 0; c < shoreW; c += 1) {
      // Fraction of the block that is land: 1 inland, 0 open water, in between at the coast.
      let hits = 0;
      for (let dr = 0; dr < SHORE_STEP; dr += 1) {
        const row = (r * SHORE_STEP + dr) * meta.width + c * SHORE_STEP;
        for (let dc = 0; dc < SHORE_STEP; dc += 1) if (land[row + dc]) hits += 1;
      }
      shoreFrac[r * shoreW + c] = hits / (SHORE_STEP * SHORE_STEP);
    }
  }
  // Separable box blur widens the coastal band to something visible (~250 m) without a distance
  // transform. Two cheap passes over 190 k texels.
  const blurRadius = 8;
  const blurred = new Float32Array(shoreW * shoreH);
  const tmp = new Float32Array(shoreW * shoreH);
  for (let r = 0; r < shoreH; r += 1) {
    for (let c = 0; c < shoreW; c += 1) {
      let sum = 0;
      let n = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 1) {
        const cc = c + k;
        if (cc < 0 || cc >= shoreW) continue;
        sum += shoreFrac[r * shoreW + cc];
        n += 1;
      }
      tmp[r * shoreW + c] = sum / n;
    }
  }
  const shoreData = new Uint8Array(shoreW * shoreH);
  for (let r = 0; r < shoreH; r += 1) {
    for (let c = 0; c < shoreW; c += 1) {
      let sum = 0;
      let n = 0;
      for (let k = -blurRadius; k <= blurRadius; k += 1) {
        const rr = r + k;
        if (rr < 0 || rr >= shoreH) continue;
        sum += tmp[rr * shoreW + c];
        n += 1;
      }
      blurred[r * shoreW + c] = sum / n;
      shoreData[r * shoreW + c] = Math.min(255, Math.round(blurred[r * shoreW + c] * 255));
    }
  }
  const shoreTexture = new THREE.DataTexture(shoreData, shoreW, shoreH,
                                             THREE.RedFormat, THREE.UnsignedByteType);
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.needsUpdate = true;

  const seaUniforms = {
    uDeep: { value: new THREE.Color(0.043, 0.105, 0.16) },
    uCoastal: { value: new THREE.Color(0.075, 0.185, 0.225) },
    // The same colour the scene clears and fogs to, so the water meets the horizon instead of
    // stopping at it.
    uSky: { value: new THREE.Color(0x9fb8c4) },
    uSun: { value: SUN },
    uTime: { value: 0 },
    uShore: { value: shoreTexture },
    uCoreOrigin: { value: new THREE.Vector2(-widthM / 2, -depthM / 2) },
    uCoreSize: { value: new THREE.Vector2(widthM, depthM) },
  };

  const sea = new THREE.Mesh(
    seaGeometry,
    new THREE.ShaderMaterial({
      uniforms: { ...seaUniforms, ...coverage.uniforms, ...themeUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
  uniform float uSeaGlitter;
        uniform vec3 uDeep;
        uniform vec3 uCoastal;
        uniform vec3 uSky;
        uniform vec3 uSun;
        uniform float uTime;
        uniform sampler2D uShore;
        uniform vec2 uCoreOrigin;
        uniform vec2 uCoreSize;
        varying vec3 vWorld;
        ${COVERAGE_GLSL}

        /**
         * Four crossing swells, summed analytically so the normal is exact rather than sampled.
         * No texture and no extra geometry: the sea is still a single quad, and the whole ocean
         * costs four cosines per pixel.
         *
         * 🔴 The amplitudes are surface SLOPES, not an arbitrary scale factor. The first attempt
         * multiplied the gradient by 55, which gives slopes around 12:1 — facets steeper than a
         * cliff — and at grazing angles the Fresnel term then swung between its extremes across
         * every wavelength. It rendered as corrugated metal. Real open water sits nearer 0.1, and
         * the long swell has to dominate the short chop or the surface turns into a lattice.
         */
        vec3 waveNormal(vec2 p, float t) {
          vec2 d1 = normalize(vec2( 0.80,  0.60));
          vec2 d2 = normalize(vec2(-0.50,  0.90));
          vec2 d3 = normalize(vec2( 0.20, -1.00));
          vec2 d4 = normalize(vec2(-0.90, -0.30));
          vec2 g = vec2(0.0);
          g += d1 * cos(dot(p, d1) * 0.020 + t * 0.55) * 0.026;   // ~310 m swell
          g += d2 * cos(dot(p, d2) * 0.045 + t * 0.90) * 0.020;   // ~140 m
          g += d3 * cos(dot(p, d3) * 0.110 + t * 1.60) * 0.014;   // ~57 m
          g += d4 * cos(dot(p, d4) * 0.260 + t * 2.60) * 0.009;   // ~24 m chop
          return normalize(vec3(-g.x, 1.0, -g.y));
        }

        void main() {
          vec3 view = cameraPosition - vWorld;
          float dist = length(view);
          vec3 V = view / dist;

          // 🔴 Fade the ripples out with distance. At fjord range a metre-scale wave is far
          // smaller than a pixel, and leaving it in makes the whole bay crawl with aliasing that
          // reads as broken rendering rather than as water.
          float detail = clamp(1.0 - dist / 7000.0, 0.0, 1.0);
          vec3 N = normalize(mix(vec3(0.0, 1.0, 0.0), waveNormal(vWorld.xz, uTime), detail));

          // Distance to the coast, where the coast is known. Outside the core this is simply 0 —
          // open water — which is also what makes the core boundary invisible.
          vec2 uv = (vWorld.xz - uCoreOrigin) / uCoreSize;
          float shore = 0.0;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            shore = texture2D(uShore, uv).r;
          }
          vec3 body = mix(uDeep, uCoastal, smoothstep(0.02, 0.45, shore));

          // Grazing angles reflect the sky, steep angles look into the water. This single term is
          // most of what separates "a blue plane" from "water".
          float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          vec3 colour = mix(body, uSky, clamp(0.02 + 0.55 * fresnel, 0.0, 0.62));

          // 🔴 Sun glitter, deliberately tight. A broad lobe over a 300 m swell does not read as
          // sparkle at all — it smears into pale diagonal bands that look like haze or a
          // rendering fault. Narrow exponent, low weight, and gone entirely at distance.
          vec3 L = normalize(uSun);
          vec3 H = normalize(L + V);
          colour += vec3(1.0, 0.97, 0.90) * pow(max(dot(N, H), 0.0), 480.0) * uSeaGlitter * detail;

          gl_FragColor = vec4(applyCoverage(colour, vWorld.xz), 1.0);
        }
      `,
    }),
  );
  sea.position.y = meta.seaLevelM;
  scene.add(sea);

  // ---------------------------------------------------------------- the horizon shell
  // 🔴 Without this the photoreal core sits on the sea as a slab and the whole scene reads as a
  // diorama — which is exactly how the first deploy looked. It is also what gives a ~41 km sensor
  // horizon real coastline to end on rather than the edge of the data.
  //
  // The shell is a DSM on a different datum, already shifted onto the core by a seam offset
  // MEASURED over land only (+0.581 m); the descriptor carries the figure and the caveat.
  let shellMesh: THREE.Mesh | null = null;
  if (shell) {
    const s = shell.meta;
    // Degrees → scene metres, calibrated on the CORE's own extent rather than on textbook
    // constants: the core's metric size and its WGS84 bounds are both known, so the scale factor
    // is taken from the real projection at this latitude. Good to a few metres over 79 km, which
    // is well inside a 30 m horizon tier — and it is stated rather than hidden.
    const bounds = meta.boundsWgs84;
    const metresPerLon = widthM / (bounds.east - bounds.west);
    const metresPerLat = depthM / (bounds.north - bounds.south);
    const lon0 = (bounds.east + bounds.west) / 2;
    const lat0 = (bounds.north + bounds.south) / 2;

    // ⚡ Decimated. The shell is now STORED at 90 m rather than 30 m — the old build shipped
    // three times the samples in each axis and then threw eight of every nine away here, which is
    // what funded widening the window from 79 x 79 km to 181 x 156 km for LESS payload
    // (4.03 MB → 2.56 MB). Stepping 2 over the 90 m grid gives a 180 m horizon mesh: indis-
    // tinguishable at the 40-90 km this tier is seen from, and it keeps the triangle count flat
    // while the area grows about fivefold.
    const shellStep = 2;
    const cols = Math.floor(s.width / shellStep);
    const rows = Math.floor(s.height / shellStep);
    const positions = new Float32Array(cols * rows * 3);
    for (let row = 0; row < rows; row += 1) {
      const lat = s.latNorth + (s.latSouth - s.latNorth) * (row / (rows - 1));
      for (let col = 0; col < cols; col += 1) {
        const lon = s.lonWest + (s.lonEast - s.lonWest) * (col / (cols - 1));
        const i = (row * cols + col) * 3;
        const e = shell.elevation[row * shellStep * s.width + col * shellStep];
        positions[i] = (lon - lon0) * metresPerLon;
        // 🔴 Anything the shell puts at or below sea level is water, and it is pushed under the
        // sea plane rather than drawn. Copernicus reports the Baltic at roughly 0 m with a few
        // metres of noise, so left alone it z-fights the plane — which rendered as a band of
        // blue-and-olive speckle right across the far water. Same rule the core follows with its
        // land mask: the sea is a surface, not ground, and only the render is corrected.
        positions[i + 1] = e < SHELL_SEA_CUT_M ? meta.seaLevelM - SUBMERGED_DROP_M : e;
        positions[i + 2] = (lat0 - lat) * metresPerLat;
      }
    }

    // Cut the core's rectangle out instead of drawing one tier over the other. Overlapping them
    // would z-fight, and the shell is a SURFACE model so it would also poke canopy and rooftops
    // up through the bare-earth core.
    const halfW = widthM / 2;
    const halfD = depthM / 2;
    const indices: number[] = [];
    const insideCore = (x: number, z: number) =>
      x > -halfW && x < halfW && z > -halfD && z < halfD;
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const a = row * cols + col;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        const cx = (positions[a * 3] + positions[d * 3]) / 2;
        const cz = (positions[a * 3 + 2] + positions[d * 3 + 2]) / 2;
        if (insideCore(cx, cz)) continue;
        indices.push(a, c, b, b, c, d);
      }
    }

    const shellGeometry = new THREE.BufferGeometry();
    shellGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    shellGeometry.setIndex(indices);
    shellGeometry.computeVertexNormals();

    shellMesh = new THREE.Mesh(shellGeometry, new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN }, uZFactor: { value: HILLSHADE_Z_FACTOR },
                  ...themeUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying float vHeight;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vHeight = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
  uniform vec3 uShellHigh;
  uniform vec3 uShellLow;
  uniform vec2 uShellRamp;
        uniform vec3 uSun;
        uniform float uZFactor;
        varying vec3 vNormal;
        varying float vHeight;
        void main() {
          // Muted on purpose. The shell is context, not subject: if it competes with the core's
          // photograph the eye goes to the wrong tier.
          // Ramp left at 120 m on purpose. Shortening it to 90 m "to use the range better" pushed
          // the median 23.7 m of shell land toward the pale end and turned the whole province
          // khaki — a colour regression smuggled in alongside a shading fix. Change one thing.
          vec3 base = mix(uShellLow, uShellHigh, clamp(vHeight / 120.0, 0.0, 1.0));
          vec3 N = normalize(vec3(vNormal.x * uZFactor, vNormal.y, vNormal.z * uZFactor));
          float lambert = clamp(dot(N, normalize(uSun)) * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(base * (uShellRamp.x + uShellRamp.y * lambert), 1.0);
        }
      `,
    }));
    scene.add(shellMesh);
  }

  // ---------------------------------------------------------------- vessel tracks
  // One geometry for every track in the day, filtered by time in the shader. Rebuilding buffers
  // per frame for 44 000 positions would be the obvious approach and the wrong one: the data
  // never changes, only the window over it does, so the clock is a uniform.
  const trailUniforms = { uNow: { value: 0 }, uTrail: { value: 1800 }, uHeadScale: { value: 1 } };
  let trackLines: THREE.LineSegments | null = null;
  let trackHeads: THREE.Points | null = null;
  const visibleAt = (seconds: number) => {
    if (!tracks) return 0;
    let count = 0;
    for (const track of tracks.meta.tracks) {
      if (track.fromS <= seconds && seconds <= track.toS) count += 1;
    }
    return count;
  };

  /**
   * The state at `seconds` for one passage, or null if it is not under way then.
   *
   * The head shader shows the report nearest to now within a 90 s window; this reproduces that
   * rule on the CPU so what you can click is exactly what you can see. Anything else and the
   * app would let you select a vessel that is not on screen, or refuse to select one that is.
   */
  const stateAt = (trackIndex: number, seconds: number) => {
    if (!tracks) return null;
    const track = tracks.meta.tracks[trackIndex];
    if (seconds < track.fromS - 90 || seconds > track.toS + 90) return null;
    const { x, z, t, speed, meta: tMeta } = tracks;

    let best = -1;
    let bestGap = Infinity;
    for (let i = track.start; i < track.start + track.count; i += 1) {
      const gap = Math.abs(t[i] * tMeta.timeStepS - seconds);
      if (gap < bestGap) { bestGap = gap; best = i; }
      // Times increase along a track, so once the gap starts growing the nearest is behind us.
      else if (t[i] * tMeta.timeStepS > seconds) break;
    }
    if (best < 0 || bestGap > 90) return null;

    // Course from the neighbouring reports rather than from a stored heading — the feed's own
    // heading field was dropped at ingest along with everything else identifying.
    const prev = Math.max(track.start, best - 1);
    const next = Math.min(track.start + track.count - 1, best + 1);
    let courseDeg: number | null = null;
    if (next !== prev) {
      const dx = x[next] - x[prev];
      const dz = z[next] - z[prev];
      if (dx * dx + dz * dz > 1) {
        // +z is south, so north is -z: bearing = atan2(east, north).
        courseDeg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      }
    }
    return { index: best, x: x[best], z: z[best],
             speedKn: speed[best] * tMeta.speedStepKn, courseDeg };
  };

  /** Great-circle-free path length of a whole passage, in kilometres. */
  const passageLengthKm = (trackIndex: number) => {
    if (!tracks) return 0;
    const track = tracks.meta.tracks[trackIndex];
    const { x, z } = tracks;
    let metres = 0;
    for (let i = track.start + 1; i < track.start + track.count; i += 1) {
      metres += Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    }
    return metres / 1000;
  };

  /**
   * Which passages actually went somewhere.
   *
   * 🔴 **The denominator rule, and it applies to every fleet figure in the app.** A moored vessel
   * transmits all day, and Phase 3's 20-minute gap rule splits that standing transmission into
   * several separately counted "passages" — one tug tied up in the harbour produced eight of them.
   * Counting those as traffic a sensor failed to observe was measurably wrong: on the recorded day
   * it reported 46 missed passages when only about four were transits, which understates a real
   * system badly and would have been quoted back at us.
   *
   * Measured before choosing (2026-08-02, 261 passages): `distance ≥ 0.5 km` keeps 153,
   * `≥1 report over 0.5 kn` keeps 160, `≥3 reports over 0.5 kn` keeps 157, `max speed ≥ 1 kn`
   * keeps 159. The rules disagree on nine passages, and the speed rules' extra keeps are boats
   * swinging on a mooring — one report at 1.4 kn. Distance is the rule that says what it means:
   * **the vessel went somewhere.**
   *
   * It is the same 0.5 km the exported annex and the site optimiser already used, so the app now
   * has one definition rather than three, and the annex discloses how many were excluded.
   */
  const transitMask: boolean[] = [];
  let excludedStationary = 0;
  if (tracks) {
    for (let index = 0; index < tracks.meta.tracks.length; index += 1) {
      const isTransit = passageLengthKm(index) >= TRANSIT_MIN_KM;
      transitMask.push(isTransit);
      if (!isTransit) excludedStationary += 1;
    }
  }

  /** Scene metres → WGS84, using the core's own bounds so it matches every other layer. */
  const toLonLat = (worldX: number, worldZ: number) => {
    const b = meta.boundsWgs84;
    return {
      lon: b.west + ((worldX + widthM / 2) / widthM) * (b.east - b.west),
      lat: b.north - ((worldZ + depthM / 2) / depthM) * (b.north - b.south),
    };
  };

  /** WGS84 → scene metres. The exact inverse, so an asset lands where the imagery draws it. */
  const fromLonLat = (lon: number, lat: number) => {
    const b = meta.boundsWgs84;
    return {
      x: ((lon - b.west) / (b.east - b.west)) * widthM - widthM / 2,
      z: ((b.north - lat) / (b.north - b.south)) * depthM - depthM / 2,
    };
  };

  /**
   * WGS84 → line-of-sight grid cell, by way of the scene frame.
   *
   * Routed through the world rather than through the grid's own UTM origin on purpose: the site
   * the user clicks is converted this way too, so an asset and a hand-placed site can never end up
   * a cell apart because two conversions disagreed.
   */
  const assetCell = (lon: number, lat: number) => {
    if (!losGrid) return null;
    const { x, z } = fromLonLat(lon, lat);
    const col = (x + fieldWidthM / 2) / losGrid.resolutionM;
    const row = (z + fieldDepthM / 2) / losGrid.resolutionM;
    if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) return null;
    return { col, row };
  };

  if (tracks) {
    const { x, z, t, speed, meta: tMeta } = tracks;
    const n = tMeta.pointCount;
    const points = new Float32Array(n * 3);
    const times = new Float32Array(n);
    const speeds = new Float32Array(n);
    // Drawn just above the water plane. Not zero: coincident with the sea it would z-fight, which
    // is the same lesson the submerged geometry taught, applied before it could bite.
    const trackY = meta.seaLevelM + 2;
    for (let i = 0; i < n; i += 1) {
      points[i * 3] = x[i];
      points[i * 3 + 1] = trackY;
      points[i * 3 + 2] = z[i];
      times[i] = t[i] * tMeta.timeStepS;
      speeds[i] = speed[i] * tMeta.speedStepKn;
    }

    // Segment indices, built per track so no line is drawn between the end of one vessel's
    // passage and the start of another's.
    const segments: number[] = [];
    for (const track of tMeta.tracks) {
      for (let k = 0; k < track.count - 1; k += 1) {
        segments.push(track.start + k, track.start + k + 1);
      }
    }

    const geometryFor = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(points, 3));
      g.setAttribute("aTime", new THREE.BufferAttribute(times, 1));
      g.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
      return g;
    };

    const trailGeometry = geometryFor();
    trailGeometry.setIndex(segments);
    trackLines = new THREE.LineSegments(trailGeometry, new THREE.ShaderMaterial({
      uniforms: { ...trailUniforms, ...coverage.uniforms, ...themeUniforms },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aTime;
        attribute float aSpeed;
        varying float vTime;
        varying float vSpeed;
        varying vec3 vWorld;
        void main() {
          vTime = aTime;
          vSpeed = aSpeed;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
  uniform vec3 uTrailAlert;
  uniform vec3 uTrailFast;
  uniform vec3 uTrailMuted;
  uniform vec3 uTrailSlow;
        uniform float uNow;
        uniform float uTrail;
        uniform float uGapMode;
        varying float vTime;
        varying float vSpeed;
        varying vec3 vWorld;
        ${COVERAGE_GLSL}
        void main() {
          float age = uNow - vTime;
          if (age < 0.0 || age > uTrail) discard;
          // Slow traffic reads cool, fast traffic warm. Speed is the one attribute that is both
          // measured and meaningful at a glance.
          vec3 colour = mix(uTrailSlow, uTrailFast, clamp(vSpeed / 16.0, 0.0, 1.0));
          float alpha = 0.85 * (1.0 - age / uTrail);
          if (uGapMode > 0.5) {
            // Mode D. What is left bright is traffic the model does NOT see. That is a statement
            // about the model, not about the vessel — see the caption in the UI.
            float state = coverageAt(vWorld.xz);
            if (state > 0.75) { colour = uTrailMuted; alpha *= 0.35; }
            else { colour = uTrailAlert; }
          }
          gl_FragColor = vec4(colour, alpha);
        }
      `,
    }));
    trackLines.frustumCulled = false;
    scene.add(trackLines);

    trackHeads = new THREE.Points(geometryFor(), new THREE.ShaderMaterial({
      uniforms: { ...trailUniforms, ...coverage.uniforms, ...themeUniforms },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aTime;
        attribute float aSpeed;
        varying float vSpeed;
        varying float vAge;
        varying vec3 vWorld;
        uniform float uNow;
        uniform float uHeadScale;
        void main() {
          vSpeed = aSpeed;
          vAge = uNow - aTime;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // 🔴 The +3.0 pixel floor is what makes live traffic hard to find: the default camera
          // sits ~9 km back, where the distance term contributes well under a pixel, so every
          // vessel collapses to the same 3 px dot. uHeadScale enlarges them in live mode only —
          // the recorded day is watched from close in, live is watched from wherever the user left
          // the camera. Kept as a UNIFORM on the shared material rather than a second material:
          // the recorded and live heads are never visible at the same time, and forking the shader
          // would let the two drift apart, which is exactly what sharing it is meant to prevent.
          gl_PointSize = (340.0 / max(-mv.z, 1.0) + 3.0) * uHeadScale;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
  uniform vec3 uHeadAlert;
  uniform vec3 uHeadFast;
  uniform vec3 uHeadMuted;
  uniform vec3 uHeadSlow;
        uniform float uGapMode;
        varying float vSpeed;
        varying float vAge;
        varying vec3 vWorld;
        ${COVERAGE_GLSL}
        void main() {
          // Only the position closest to "now" survives, which is what makes a vessel read as a
          // single moving object rather than a smear of every report it ever sent.
          if (vAge < 0.0 || vAge > 90.0) discard;
          vec2 d = gl_PointCoord - vec2(0.5);
          if (dot(d, d) > 0.25) discard;
          vec3 colour = mix(uHeadSlow, uHeadFast, clamp(vSpeed / 16.0, 0.0, 1.0));
          float alpha = 0.95;
          if (uGapMode > 0.5) {
            float state = coverageAt(vWorld.xz);
            if (state > 0.75) { colour = uHeadMuted; alpha = 0.35; }
            else { colour = uHeadAlert; }
          }
          gl_FragColor = vec4(colour, alpha);
        }
      `,
    }));
    trackHeads.frustumCulled = false;
    scene.add(trackHeads);
  }

  // ---------------------------------------------------------------- live vessels
  // 🔴 The phase gate, made structural rather than asserted: these meshes carry the same attribute
  // layout as the recorded day and are handed **the same material instances** — not equivalent
  // shaders, the same compiled programs and the same uniform objects. Live traffic therefore
  // inherits speed colouring, the trail window and the Mode D coverage test for free, and any
  // future change to how a vessel is drawn cannot apply to one and miss the other.
  const liveBuffers: LiveBuffers = createBuffers();
  const livePositions = new Float32Array(LIVE_CAPACITY * 3);
  // The attributes are shared objects across both geometries; only the index and the draw range
  // differ. 🔴 One geometry for both would be wrong twice over: `Points` would inherit the line
  // index and draw every vertex twice, and `setDrawRange` counts INDICES on indexed geometry but
  // VERTICES on non-indexed, so a single range cannot be right for both.
  const livePositionAttr = new THREE.BufferAttribute(livePositions, 3);
  const liveTimeAttr = new THREE.BufferAttribute(liveBuffers.t, 1);
  const liveSpeedAttr = new THREE.BufferAttribute(liveBuffers.speed, 1);
  livePositionAttr.setUsage(THREE.DynamicDrawUsage);
  liveTimeAttr.setUsage(THREE.DynamicDrawUsage);
  liveSpeedAttr.setUsage(THREE.DynamicDrawUsage);

  const liveTrailGeometry = new THREE.BufferGeometry();
  liveTrailGeometry.setAttribute("position", livePositionAttr);
  liveTrailGeometry.setAttribute("aTime", liveTimeAttr);
  liveTrailGeometry.setAttribute("aSpeed", liveSpeedAttr);
  liveTrailGeometry.setDrawRange(0, 0);

  const liveHeadGeometry = new THREE.BufferGeometry();
  liveHeadGeometry.setAttribute("position", livePositionAttr);
  liveHeadGeometry.setAttribute("aTime", liveTimeAttr);
  liveHeadGeometry.setAttribute("aSpeed", liveSpeedAttr);
  liveHeadGeometry.setDrawRange(0, 0);

  let liveLines: THREE.LineSegments | null = null;
  let liveHeads: THREE.Points | null = null;
  if (trackLines && trackHeads) {
    liveLines = new THREE.LineSegments(liveTrailGeometry, trackLines.material);
    liveHeads = new THREE.Points(liveHeadGeometry, trackHeads.material);
    for (const mesh of [liveLines, liveHeads] as THREE.Object3D[]) {
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
    }
  }

  // The scene's centre in WGS84, taken from the heightmap's own bounds rather than restated, so
  // the live projection lands on the same origin every other asset was built around.
  const liveFrame = {
    centreLat: (meta.boundsWgs84.north + meta.boundsWgs84.south) / 2,
    centreLon: (meta.boundsWgs84.east + meta.boundsWgs84.west) / 2,
  };
  let liveMode = false;

  // ---------------------------------------------------------------- buildings
  let buildingMesh: THREE.Mesh | null = null;
  if (buildings) {
    const { x, y, z, meta: bMeta, } = buildings;
    const q = bMeta.quantisation;
    const n = bMeta.vertexCount;
    const positions = new Float32Array(n * 3);
    // The building origin is the AOI centre in UTM; the terrain plane is centred on the same
    // point, so the two line up without an offset. Verified offline: 99.97 % of these vertices
    // stand on cells the land mask calls land.
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = x[i] * q.xzScaleM;
      positions[i * 3 + 1] = y[i] * q.yScaleM + q.yOffsetM;
      positions[i * 3 + 2] = z[i] * q.xzScaleM;
    }
    const bGeometry = new THREE.BufferGeometry();
    bGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const bMaterial = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: SUN }, ...themeUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
  uniform vec3 uBuildingBase;
  uniform vec2 uBuildingRamp;
        uniform vec3 uSun;
        varying vec3 vWorld;
        void main() {
          // Flat normals from screen-space derivatives. The mesh carries no normal attribute and
          // adding one would grow the download by half for surfaces that ARE flat.
          vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          float lambert = clamp(abs(dot(n, normalize(uSun))), 0.0, 1.0);
          gl_FragColor = vec4(uBuildingBase * (uBuildingRamp.x + uBuildingRamp.y * lambert), 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    buildingMesh = new THREE.Mesh(bGeometry, bMaterial);
    // Cadastral geometry is not sorted, so let three cull it as one object rather than compute a
    // bounding sphere per frame.
    buildingMesh.frustumCulled = false;
    scene.add(buildingMesh);
  }

  // ---------------------------------------------------------------- loop
  let frames = 0;
  let running = true;
  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------------- the notional sites
  // 🔴 PLAN §3.2 rule 2: no real installation is ever depicted. There is no site until the user
  // puts one somewhere, none of them carries a name, and the UI labels them fictitious locations.
  // Each mast is drawn as a plain vertical line at true height — a 25 m mast really is that small
  // against a fjord, and pretending otherwise would misrepresent the very geometry the app argues
  // about.
  const siteGroup = new THREE.Group();
  scene.add(siteGroup);
  const mastGeometry = new THREE.CylinderGeometry(6, 6, 1, 6);
  const mastMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.35) });
  // The selected mast is the one the sliders act on, so it has to be findable among five.
  const selectedMastMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.98, 0.80),
  });
  const selectionDiscGeometry = new THREE.RingGeometry(90, 130, 32);
  const selectionDiscMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.92, 0.55), transparent: true, opacity: 0.75,
    side: THREE.DoubleSide, depthWrite: false,
  });

  /**
   * Rebuild the masts from the site list. Cheap: at most five cylinders and one ring.
   *
   * ⚠️ Geometries and materials are shared and created once, so this only ever adds and removes
   * meshes. Building a fresh material per site per rebuild leaks one GPU program per drag frame,
   * which is invisible until the tab has been open for a while.
   */
  const refreshSiteMarkers = () => {
    siteGroup.clear();
    if (!losGrid) return;
    for (const s of sites) {
      const ground = s.result?.siteGroundM
        ?? losGrid.groundM[Math.round(s.row) * losGrid.width + Math.round(s.col)];
      const x = -fieldWidthM / 2 + (s.col + 0.5) * losGrid.resolutionM;
      const z = -fieldDepthM / 2 + (s.row + 0.5) * losGrid.resolutionM;
      const isSelected = s.id === selectedSiteId;

      const mastMesh = new THREE.Mesh(mastGeometry,
        isSelected ? selectedMastMaterial : mastMaterial);
      mastMesh.scale.set(1, s.mastM, 1);
      mastMesh.position.set(x, ground + s.mastM / 2, z);
      siteGroup.add(mastMesh);

      if (isSelected) {
        const disc = new THREE.Mesh(selectionDiscGeometry, selectionDiscMaterial);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(x, ground + 4, z);
        disc.renderOrder = 6;
        siteGroup.add(disc);
      }
    }
  };


  // ---------------------------------------------------------------- protected assets
  /**
   * The objects the counter-UAS scenario is about.
   *
   * 🔴 These are the one thing in the scene that is **real and named**, which is the opposite of
   * the site rule above and needs saying: a published aerodrome, a published lock and a published
   * hospital pad, resolved from OpenStreetMap and carried in `assets.json` with their OSM ids.
   * PLAN §3.2 rule 2 forbids depicting a real *installation of the customer's* — a sensor site —
   * not the public infrastructure everybody can already see on any map. Military sites are
   * excluded at the source; see tools/geodata/resolve_assets.py.
   *
   * Only the selected object draws its protection ring. Drawing all of them at once was the first
   * thing tried and it buried the fjord in circles, which is exactly the overload the scenario
   * switch exists to prevent.
   */
  const assetPins = new THREE.Group();
  const assetRings = new THREE.Group();
  assetPins.visible = false;
  assetRings.visible = false;
  scene.add(assetPins);
  scene.add(assetRings);

  const assetList = assets?.assets ?? [];
  const assetCells = new Map<string, { col: number; row: number }>();
  const assetPinByeId = new Map<string, THREE.Object3D>();

  /**
   * Bare ground at a grid cell — where a pin is planted. Distinct from the world-space `groundAt`
   * used by the camera, and deliberately not the blocking surface: an aerodrome marker belongs on
   * the apron, not on the tree line beside it.
   */
  const cellGroundM = (col: number, row: number) => {
    if (!losGrid) return 0;
    const c = Math.min(Math.max(Math.round(col), 0), losGrid.width - 1);
    const r = Math.min(Math.max(Math.round(row), 0), losGrid.height - 1);
    return losGrid.groundM[r * losGrid.width + c];
  };

  // ⚠️ Shared, created once. Two reasons: `setTheme` recolours the markers by writing `.color` on
  // these instances (a per-object material would leave half the scene on the old palette), and
  // `showProtectionRing` rebuilds on every selection — a fresh material there leaks a GPU program
  // per click. Only the opacity differs per role, and opacity is not themed.
  const assetMarkerMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.45, 0.82, 1.0),
  });
  const assetDiscMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.45, 0.82, 1.0),
    transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  });
  const assetLineMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.45, 0.82, 1.0), transparent: true, opacity: 0.9, depthWrite: false,
  });
  const assetRingMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0.45, 0.82, 1.0),
    transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
  });

  for (const asset of assetList) {
    const cell = assetCell(asset.lon, asset.lat);
    if (!cell) continue;
    assetCells.set(asset.id, cell);
    const { x, z } = fromLonLat(asset.lon, asset.lat);
    const ground = cellGroundM(cell.col, cell.row);

    // A short vertical pin plus a small disc. Kept deliberately modest: the aerial imagery already
    // shows the runway, and a big glowing icon over real infrastructure reads as a target marker.
    const pin = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4, 120, 6),
      assetMarkerMaterial,
    );
    stem.position.y = ground + 60;
    pin.add(stem);
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(70, 110, 32),
      assetDiscMaterial,
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = ground + 4;
    disc.renderOrder = 5;
    pin.add(disc);
    pin.position.set(x, 0, z);
    assetPins.add(pin);
    assetPinByeId.set(asset.id, pin);

    // The runway centreline, at its true length and bearing. It is drawn because the two runway
    // headings are the approach corridors a drone would matter most on — the geometry is the
    // argument, not decoration.
    if (asset.runway?.ends?.length === 2) {
      const [a, b] = asset.runway.ends;
      const pa = fromLonLat(a[1], a[0]);
      const pb = fromLonLat(b[1], b[0]);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(pa.x, ground + 6, pa.z),
          new THREE.Vector3(pb.x, ground + 6, pb.z),
        ]),
        assetLineMaterial,
      );
      line.renderOrder = 5;
      assetPins.add(line);
    }
  }

  /** The protection ring of whichever object is selected. Rebuilt on selection, never stacked. */
  let ringMesh: THREE.Mesh | null = null;
  const showProtectionRing = (assetId: string | null, radiusM: number) => {
    if (ringMesh) {
      assetRings.remove(ringMesh);
      ringMesh.geometry.dispose();
      ringMesh = null;
    }
    if (!assetId) return;
    const asset = assetList.find((a) => a.id === assetId);
    const cell = assetCells.get(assetId);
    if (!asset || !cell) return;
    const { x, z } = fromLonLat(asset.lon, asset.lat);
    const ground = cellGroundM(cell.col, cell.row);
    ringMesh = new THREE.Mesh(
      // A thin annulus, not a filled disc: a filled circle would hide the coverage tint that is
      // the actual answer.
      new THREE.RingGeometry(radiusM - 25, radiusM + 25, 128),
      assetRingMaterial,
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(x, ground + 5, z);
    ringMesh.renderOrder = 5;
    assetRings.add(ringMesh);
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // ---------------------------------------------------------------- vessel selection
  // A flat ring drawn on the water under the selected vessel. Deliberately not a billboard or a
  // label: at true scale a 100 m ship is a few pixels across from the default camera, and a ring
  // reads at every zoom without pretending the vessel is bigger than it is.
  const vesselRingMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.85, 0.35),
    transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
  });
  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(55, 78, 40),
    vesselRingMaterial,
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  selectionRing.renderOrder = 5;
  scene.add(selectionRing);

  let selectedTrack: number | null = null;

  /** The nearest report to a given second, whether or not the passage is under way then. */
  const sampleAt = (trackIndex: number, seconds: number) => {
    if (!tracks) return null;
    const track = tracks.meta.tracks[trackIndex];
    const { x, z, t, speed, meta: tMeta } = tracks;
    let best = -1;
    let bestGap = Infinity;
    for (let k = 0; k < track.count; k += 1) {
      const i = track.start + k;
      const gap = Math.abs(t[i] * tMeta.timeStepS - seconds);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) return null;
    const next = best + 1 < track.start + track.count ? best + 1 : best - 1;
    const courseDeg = next >= track.start && next !== best
      ? (Math.atan2(x[next] - x[best], -(z[next] - z[best])) * 180 / Math.PI + 360) % 360
      : null;
    return {
      x: x[best], z: z[best],
      speedKn: speed[best] * tMeta.speedStepKn,
      courseDeg: bestGap < Infinity ? courseDeg : null,
    };
  };

  /**
   * Summary statistics for a whole passage. All derived from the track itself — nothing is looked
   * up, because there is nothing to look it up with.
   */
  const passageProfile = (trackIndex: number) => {
    const track = tracks!.meta.tracks[trackIndex];
    const { t, speed, meta: tMeta } = tracks!;
    let maxKn = 0;
    let sumKn = 0;
    let stopped = 0;
    const gaps: number[] = [];
    for (let k = 0; k < track.count; k += 1) {
      const i = track.start + k;
      const kn = speed[i] * tMeta.speedStepKn;
      if (kn > maxKn) maxKn = kn;
      sumKn += kn;
      if (kn < 0.5) stopped += 1;
      if (k > 0) gaps.push((t[i] - t[i - 1]) * tMeta.timeStepS);
    }
    gaps.sort((a, b) => a - b);
    return {
      maxSpeedKn: maxKn,
      avgSpeedKn: track.count ? sumKn / track.count : 0,
      stoppedShare: track.count ? stopped / track.count : 0,
      medianReportGapS: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    };
  };

  /**
   * Would the placed site have seen this passage? Null when no site exists.
   *
   * This is the per-vessel view of the fleet-wide figure in the Sichtbarkeit panel, and it is what
   * turns "84 % observed" from a statistic into something you can interrogate: click the ones that
   * were missed and see where they went.
   */
  /**
   * Would the network have seen this passage? Null when there is no site.
   *
   * Reads the composite, so a passage counts as observed if **any** site held it — the same rule
   * the headline figure uses. Answering per-site here would contradict the panel.
   */
  const observedByCurrentSite = (trackIndex: number): { seen: boolean; share: number } | null => {
    if (!losGrid || !sites.length || !composite || !tracks) return null;
    const track = tracks.meta.tracks[trackIndex];
    const { x, z } = tracks;
    let inGrid = 0;
    let seen = 0;
    for (let k = 0; k < track.count; k += 1) {
      const i = track.start + k;
      const col = Math.floor((x[i] + fieldWidthM / 2) / losGrid.resolutionM);
      const row = Math.floor((z[i] + fieldDepthM / 2) / losGrid.resolutionM);
      if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) continue;
      inGrid += 1;
      if (composite[row * losGrid.width + col] === 2) seen += 1;
    }
    if (!inGrid) return null;
    return { seen: seen > 0, share: seen / inGrid };
  };

  const describe = (trackIndex: number, seconds: number): VesselDetails | null => {
    if (!tracks) return null;
    const track = tracks.meta.tracks[trackIndex];
    const state = stateAt(trackIndex, seconds);

    // 🔴 When the passage is not under way at the clock — which is most of them, most of the time —
    // fall back to the moment the user actually clicked on rather than reporting zeroes. A trail
    // is a real thing on screen; clicking it and getting a blank panel reads as a broken feature.
    const anchor = state ?? sampleAt(trackIndex, Math.min(Math.max(seconds, track.fromS), track.toS));
    const here = anchor ? toLonLat(anchor.x, anchor.z) : null;
    const profile = passageProfile(trackIndex);

    return {
      vessel: track.vessel,
      type: track.type || "Undefined",
      // Spread only the keys the asset actually carries, so an anonymised build leaves them
      // `undefined` rather than empty strings the panel would have to tell apart from "not
      // transmitted".
      ...(track.name ? { name: track.name } : {}),
      ...(track.mmsi ? { mmsi: track.mmsi } : {}),
      ...(track.callSign ? { callSign: track.callSign } : {}),
      ...(track.imo ? { imo: track.imo } : {}),
      ...(track.destination ? { destination: track.destination } : {}),
      ...(track.draughtM ? { draughtM: track.draughtM } : {}),
      ...(track.length ? { lengthM: track.length } : {}),
      ...(track.width ? { beamM: track.width } : {}),
      underWay: state !== null,
      speedKn: anchor ? anchor.speedKn : 0,
      courseDeg: anchor ? anchor.courseDeg : null,
      lat: here ? here.lat : 0,
      lon: here ? here.lon : 0,
      fromS: track.fromS,
      toS: track.toS,
      reportCount: track.count,
      distanceKm: passageLengthKm(trackIndex),
      ...profile,
      observed: observedByCurrentSite(trackIndex),
    };
  };
  /**
   * The network.
   *
   * 🔴 This was a single `site` object, and generalising it is the whole of tier 1 #2: nobody buys
   * one mast. Each site keeps **its own solved field**, which is what makes the network figures
   * cheap — the composite, the redundancy count and every per-site contribution are array work over
   * fields that already exist, so adding a site costs one solve and changing the target height
   * costs N. Throwing the per-site fields away and re-solving to answer "what does site 3 add"
   * would have made the interesting question the expensive one.
   *
   * Mast height is **per site** because a real chain is not uniform — a tall mast on the headland
   * and short ones in the harbour is the proposal, and a single global slider cannot express it.
   * Target height stays global: it describes the threat, not the installation.
   */
  interface NetworkSite {
    id: number;
    col: number;
    row: number;
    mastM: number;
    result: ViewshedResult | null;
  }
  const sites: NetworkSite[] = [];
  let nextSiteId = 1;
  let selectedSiteId: number | null = null;
  const levers = { targetM: 2 };
  /** Union of every site's field: the ground the network as a whole holds. */
  let composite: Uint8Array | null = null;
  /** How many sites see each cell. 0, 1 or many — the difference between cover and resilience. */
  let coverCount: Uint8Array | null = null;
  let lastTraffic: TrafficCoverage | null = null;
  let lastApproach: ApproachCoverage | null = null;
  let lastNetwork: NetworkCoverage | null = null;

  const selectedSite = () => sites.find((s) => s.id === selectedSiteId) ?? null;

  /**
   * Which question the app is currently asking.
   *
   * The two scenarios share every millimetre of geometry — the same terrain, the same solver, the
   * same curvature. What differs is what the target *is* (a hull on the water against an airframe
   * above the ground), which object the answer is measured against, and therefore which layers are
   * worth drawing. Keeping them as one mode with more checkboxes was the alternative, and it put
   * ship trails, protection rings and two different coverage figures on screen at once.
   */
  let scenario: Scenario = "maritime";
  let selectedAssetId: string | null = assetList[0]?.id ?? null;
  let protectionRadiusM = assetList[0]?.protectionRadiusM ?? 3000;
  let vesselsWanted = true;

  /**
   * How much of a real day's traffic this site would actually have observed.
   *
   * 🔴 This is the number a tender is written in. Coverage in km² cannot be put into a requirement
   * or checked against one; "the system shall observe vessels entering the approach" can. Both
   * halves of this have existed since Phase 4 and had simply never been multiplied together — the
   * viewshed field and the AIS tracks are in the same scene, in the same coordinate frame.
   *
   * The definition, stated because Phase 6 showed that two implementations of one figure drift
   * exactly where the definition was left implicit:
   *
   *   * a passage **counts** if at least one of its positions falls inside the modelled grid —
   *     passages that never enter the area are not failures of the site and are excluded, not
   *     counted as missed;
   *   * a passage is **observed** if at least one of those positions falls in a cell the model
   *     marks visible. One sighting is the honest bar for "would have been seen at all"; the
   *     position share below is the finer measure for how *continuously* it was held.
   *
   * Target height is already baked in: the field was solved for the current `targetM`, so a 2 m
   * RIB and a 20 m container mast give different answers from the same site, which is the point.
   */
  const measureTrafficCoverage = (field: Uint8Array): TrafficCoverage | null => {
    if (!losGrid || !tracks) return null;
    const { x, z, meta: tMeta } = tracks;
    let passages = 0;
    let observedPassages = 0;
    let positionsInGrid = 0;
    let observedPositions = 0;

    for (let index = 0; index < tMeta.tracks.length; index += 1) {
      // Only passages that went somewhere. See `transitMask` for why, and what was measured.
      if (!transitMask[index]) continue;
      const track = tMeta.tracks[index];
      let inGrid = false;
      let seen = false;
      for (let k = 0; k < track.count; k += 1) {
        const i = track.start + k;
        const col = Math.floor((x[i] + fieldWidthM / 2) / losGrid.resolutionM);
        const row = Math.floor((z[i] + fieldDepthM / 2) / losGrid.resolutionM);
        if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) continue;
        inGrid = true;
        positionsInGrid += 1;
        if (field[row * losGrid.width + col] === 2) {
          observedPositions += 1;
          seen = true;
        }
      }
      if (!inGrid) continue;
      passages += 1;
      if (seen) observedPassages += 1;
    }

    return {
      passages,
      observedPassages,
      missedPassages: passages - observedPassages,
      passageShare: passages ? observedPassages / passages : 0,
      positionShare: positionsInGrid ? observedPositions / positionsInGrid : 0,
    };
  };

  /** Solve one site, at reduced ray density while a slider is moving. */
  const solveSite = (target: NetworkSite, quality: "drag" | "full") => {
    if (!losGrid) return;
    const maxRange = radarHorizonM(
      losGrid.groundM[Math.round(target.row) * losGrid.width + Math.round(target.col)]
        + target.mastM,
      levers.targetM,
    );
    const full = azimuthsFor(
      Math.min(maxRange, Math.hypot(fieldWidthM, fieldDepthM)),
      losGrid.resolutionM,
    );
    target.result = computeViewshed(losGrid, {
      col: target.col,
      row: target.row,
      mastM: target.mastM,
      targetM: levers.targetM,
      // While a slider is moving, a quarter of the rays keeps the shadow honest in shape and the
      // frame rate usable; the full sweep runs the moment the user lets go.
      azimuths: quality === "drag" ? Math.ceil(full / 4) : full,
    });
  };

  /**
   * Which sites observed each passage, as one bit per site.
   *
   * Walked once over the tracks rather than once per site: the inner loop is a handful of array
   * reads and the outer one is 44 000 positions, so doing it the other way round would re-walk the
   * whole day for every mast on the map.
   */
  const measureNetwork = (): NetworkCoverage | null => {
    if (!losGrid || !tracks || !sites.length) return null;
    const { x, z, meta: tMeta } = tracks;
    const width = losGrid.width;
    const masks: number[] = [];

    for (let index = 0; index < tMeta.tracks.length; index += 1) {
      if (!transitMask[index]) continue;
      const track = tMeta.tracks[index];
      let inGrid = false;
      let mask = 0;
      for (let k = 0; k < track.count; k += 1) {
        const i = track.start + k;
        const col = Math.floor((x[i] + fieldWidthM / 2) / losGrid.resolutionM);
        const row = Math.floor((z[i] + fieldDepthM / 2) / losGrid.resolutionM);
        if (col < 0 || col >= width || row < 0 || row >= losGrid.height) continue;
        inGrid = true;
        const cell = row * width + col;
        for (let s = 0; s < sites.length; s += 1) {
          const field = sites[s].result;
          if (field && field.field[cell] === 2) mask |= 1 << s;
        }
      }
      // A passage that never entered the modelled area is not a failure of the network, exactly as
      // in the single-site figure. Excluded from the denominator rather than counted as missed.
      if (inGrid) masks.push(mask);
    }
    return summariseNetwork(masks, sites.length);
  };

  /**
   * Fold every site's field into the one the scene draws and the figures are measured against.
   *
   * A cell is **visible** if any site sees it and **shadowed** if at least one site modelled it and
   * none saw it; unknown survives only where no site looked at all. That asymmetry is deliberate —
   * "somebody covers this" is a union, but "nobody claims anything here" has to stay distinguish-
   * able from "we looked and it is blocked", which is the whole reason the field has three states.
   */
  const recomposite = () => {
    if (!losGrid) return;
    const cells = losGrid.width * losGrid.height;
    if (!composite || composite.length !== cells) {
      composite = new Uint8Array(cells);
      coverCount = new Uint8Array(cells);
    }
    composite.fill(0);
    coverCount!.fill(0);

    for (const s of sites) {
      const field = s.result?.field;
      if (!field) continue;
      for (let i = 0; i < cells; i += 1) {
        const state = field[i];
        if (state === 2) {
          coverCount![i] += 1;
          composite[i] = 2;
        } else if (state === 1 && composite[i] === 0) {
          composite[i] = 1;
        }
      }
    }

    const texels = fieldTexture.image.data as Uint8Array;
    const counts = countTexture.image.data as Uint8Array;
    for (let i = 0; i < cells; i += 1) {
      const state = composite[i];
      texels[i] = state === 2 ? 255 : state === 1 ? 128 : 0;
      counts[i] = coverCount![i];
    }
    fieldTexture.needsUpdate = true;
    countTexture.needsUpdate = true;

    coverage.uniforms.uCoverageMode.value = sites.length ? 1 : 0;
    lastTraffic = sites.length ? measureTrafficCoverage(composite) : null;
    lastApproach = sites.length ? measureApproach(composite) : null;
    lastNetwork = measureNetwork();
    refreshSiteMarkers();
  };

  /** Re-solve every site. Needed when the target height changes, since it is shared. */
  const recompute = (quality: "drag" | "full") => {
    if (!losGrid || !sites.length) return;
    for (const s of sites) solveSite(s, quality);
    recomposite();
  };

  /** Re-solve one site only — what a mast slider actually changes. */
  const recomputeSite = (id: number, quality: "drag" | "full") => {
    const target = sites.find((s) => s.id === id);
    if (!target || !losGrid) return;
    solveSite(target, quality);
    recomposite();
  };


  /** Approach coverage of the selected object, or null when the scenario has nothing to measure. */
  const measureApproach = (field: Uint8Array): ApproachCoverage | null => {
    if (!losGrid || !selectedAssetId) return null;
    const cell = assetCells.get(selectedAssetId);
    if (!cell) return null;
    return measureApproachCoverage(losGrid, field, cell.col, cell.row, protectionRadiusM);
  };

  /**
   * At what height does the gap close?
   *
   * 🔴 The number the whole counter-UAS scenario exists to produce. A site that covers an approach
   * at 300 m and not at 30 m has not covered the approach: a drone that matters is flown low, and
   * terrain masking is the entire difficulty. Sweeping the ladder makes the trade explicit instead
   * of leaving the reader to drag a slider and guess.
   *
   * Each rung is a full solve, so this runs on demand rather than on every slider tick. Ray density
   * is the drag setting: the rungs are compared against each other, and a quartered sweep changes
   * every rung the same way while costing a quarter as much.
   */
  const sweepAltitudes = (heightsM: number[]): AltitudeRung[] => {
    if (!losGrid || !sites.length || !selectedAssetId) return [];
    const cell = assetCells.get(selectedAssetId);
    if (!cell) return [];
    const cells = losGrid.width * losGrid.height;
    const scratch = new Uint8Array(cells);
    const rungs: AltitudeRung[] = [];

    for (const heightM of heightsM) {
      // Every rung is a whole-network answer: solve each site at this drone height and take the
      // union, exactly as the live figure does. Measuring one mast here while the panel above
      // reports the network would put two different systems on one screen.
      scratch.fill(0);
      for (const s of sites) {
        const maxRange = radarHorizonM(
          losGrid.groundM[Math.round(s.row) * losGrid.width + Math.round(s.col)] + s.mastM,
          heightM,
        );
        const full = azimuthsFor(
          Math.min(maxRange, Math.hypot(fieldWidthM, fieldDepthM)),
          losGrid.resolutionM,
        );
        const result = computeViewshed(losGrid, {
          col: s.col,
          row: s.row,
          mastM: s.mastM,
          targetM: heightM,
          azimuths: Math.ceil(full / 4),
        });
        for (let i = 0; i < cells; i += 1) {
          const state = result.field[i];
          if (state === 2) scratch[i] = 2;
          else if (state === 1 && scratch[i] === 0) scratch[i] = 1;
        }
      }
      const approach = measureApproachCoverage(
        losGrid, scratch, cell.col, cell.row, protectionRadiusM,
      );
      rungs.push({ heightM, share: approach.share, widestGapDeg: approach.widestGapDeg });
    }
    return rungs;
  };

  /** Vessels are a maritime layer; the switch presets them but the user keeps the last word. */
  const applyVesselVisibility = () => {
    const show = vesselsWanted;
    if (trackLines) trackLines.visible = show && !liveMode;
    if (trackHeads) trackHeads.visible = show && !liveMode;
    if (liveLines) liveLines.visible = show && liveMode;
    if (liveHeads) liveHeads.visible = show && liveMode;
    if (!show) {
      selectionRing.visible = false;
      selectedTrack = null;
    }
  };

  // ---------------------------------------------------------------- drone mode
  /**
   * Surface height under a world position, in real metres.
   *
   * 🔴 Over water this returns the **water plane**, not the seabed. The heightmap carries real
   * bathymetry down to −11.4 m, but the scene draws an opaque sea at zero and hides it — a
   * sampler that reported the seabed would make the camera speed up as it crossed the coast, for a
   * reason invisible on screen. The land mask already decides what counts as ground everywhere
   * else in this file, so it decides it here too.
   *
   * Reads the elevation array rather than raycasting the mesh: the terrain is a displaced plane
   * whose displacement *is* that array, and raycasting millions of vertices per frame to answer
   * "how high am I" would be absurd.
   */
  const groundAt = (x: number, z: number): number | null => {
    const u = x / widthM + 0.5;
    const v = z / depthM + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const col = Math.min(meta.width - 1, Math.max(0, Math.round(u * (meta.width - 1))));
    const row = Math.min(meta.height - 1, Math.max(0, Math.round(v * (meta.height - 1))));
    const cell = row * meta.width + col;
    return land[cell] ? elevation[cell] : meta.seaLevelM;
  };

  let droneListener: ((engaged: boolean) => void) | null = null;
  const drone: FlyControls = createFlyControls({
    camera,
    domElement: renderer.domElement,
    controls,
    groundAt,
    // ⚠️ Every one of these numbers is smaller than the land twins use, and deliberately. This is
    // an 11 x 18 km fjord with about 70 m of relief, worked at the scale of a vessel and a mast
    // rather than a valley: the module's defaults would cross the whole field in a couple of
    // seconds and make it impossible to follow a ship.
    cruiseMinMs: 8,
    cruiseMaxMs: 400,
    cruiseDefaultMs: 60,
    boost: 3,
    // The reference height is a mast top, not a hillside — so *everything* above it is far above
    // it, and the scaling has to reach much further up than it does on land.
    referenceAglM: 25,
    aglScaleMin: 0.3,
    aglScaleMax: 14,
    // ⚠️ This camera has always had mass and a stabilised gimbal, and losing them in the merge
    // would have been a silent change to how the whole app feels.
    accelerateTauS: 0.28,
    brakeTauS: 0.16,
    lookTauS: 0.07,
    // The orbit camera's fallback distance out over open water, where the ray meets no ground.
    handoffDistanceM: 3000,
    onEngagedChange: (engaged) => droneListener?.(engaged),
  });
  let lastFrameTime = performance.now();

  /**
   * Which side of the modelled coverage the camera itself is on.
   *
   * This is what makes drone mode more than sightseeing here: fly into the shadow behind a
   * headland and the readout flips, so the coverage field stops being a coloured overlay and
   * becomes somewhere you can go and stand.
   */
  const coverageAtCamera = (): "visible" | "shadowed" | null => {
    if (!losGrid || !sites.length) return null;
    const col = (camera.position.x + fieldWidthM / 2) / losGrid.resolutionM;
    const row = (camera.position.z + fieldDepthM / 2) / losGrid.resolutionM;
    if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) return null;
    // ⚠️ Tests the camera's OWN altitude, not the target-height slider.
    //
    // This used to sample the coverage field, which is solved for `levers.targetM`. That answered
    // a question nobody asked: "would a 40 m target standing on the ground below the drone be
    // visible" — so flying to 500 m over a headland still reported abgeschattet, because the
    // ground under it was. The readout is about where the viewer actually is, so it has to be a
    // line to where the viewer actually is.
    //
    // Any site seeing the camera is enough: the readout answers "is the network holding me", and
    // asking only the selected mast would make the answer jump when the selection changed.
    return sites.some((s) => hasLineOfSight(
      losGrid,
      { col: s.col, row: s.row, mastM: s.mastM },
      { col, row, aboveDatumM: camera.position.y },
    )) ? "visible" : "shadowed";
  };

  const tick = () => {
    if (!running) return;
    const nowMs = performance.now();
    // Clamped: a backgrounded tab returns a gap of seconds, and applying it would teleport the
    // camera across the fjord the moment the tab is focused again.
    const dt = Math.min((nowMs - lastFrameTime) / 1000, 0.1);
    lastFrameTime = nowMs;
    // The swell runs on its own clock, independent of the AIS replay clock — the water does not
    // stop moving because somebody paused the day.
    seaUniforms.uTime.value += dt;

    // Keep the selection ring on the vessel as the replay clock advances. Done here rather than
    // in React so the marker tracks the ship every frame instead of at the panel's poll rate.
    if (selectedTrack !== null) {
      const state = stateAt(selectedTrack, trailUniforms.uNow.value);
      if (state) {
        selectionRing.position.set(state.x, meta.seaLevelM + 1.5, state.z);
        selectionRing.visible = true;
      } else {
        // The passage has ended or not begun. The selection is kept so the panel can still say so.
        selectionRing.visible = false;
      }
    }
    if (drone.engaged) drone.update(dt);
    else controls.update();
    renderer.render(scene, camera);
    frames += 1;
    if (frames === 1) {
      // The first frame is the one that matters for a demo opening, so it is measured rather
      // than estimated. Read from the page as `window.__maritime`.
      (window as unknown as Record<string, unknown>).__maritime = {
        firstFrameMs: Math.round(performance.now()),
        triangles: renderer.info.render.triangles,
        drawCalls: renderer.info.render.calls,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        loadTimings: data.timings,
        renderer: (() => {
          const gl = renderer.getContext();
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "unknown";
        })(),
        maxTextureSize: renderer.getContext().getParameter(
          renderer.getContext().MAX_TEXTURE_SIZE,
        ),
      };
    }
    requestAnimationFrame(tick);
  };
  tick();

  /**
   * Put the camera on a patch of water, looking down from the south at roughly 50°.
   *
   * Shared by {@link SceneHandle.flyToLonLat} and the live-traffic focus so the two cannot frame
   * the same water differently.
   */
  function frameCamera(x: number, z: number, rangeM: number) {
    const height = rangeM * Math.sin((50 * Math.PI) / 180);
    const back = rangeM * Math.cos((50 * Math.PI) / 180);
    camera.position.set(x, meta.seaLevelM + height, z + back);
    controls.target.set(x, meta.seaLevelM, z);
    controls.update();
    camera.lookAt(x, meta.seaLevelM, z);
    // ⚠️ The drone keeps its own yaw and pitch, so a camera move underneath it is undone on the
    // next frame unless the orientation is re-adopted — the same trap `flyToMast` documents.
    if (drone.engaged) {
      drone.setEngaged(false);
      drone.setEngaged(true);
    }
  }

  return {
    dispose() {
      running = false;
      window.removeEventListener("resize", resize);
      controls.dispose();
      geometry.dispose();
      seaGeometry.dispose();
      shoreTexture.dispose();
      shellMesh?.geometry.dispose();
      trackLines?.geometry.dispose();
      trackHeads?.geometry.dispose();
      liveTrailGeometry.dispose();
      liveHeadGeometry.dispose();
      mastGeometry.dispose();
      selectionDiscGeometry.dispose();
      mastMaterial.dispose();
      selectedMastMaterial.dispose();
      selectionDiscMaterial.dispose();
      fieldTexture.dispose();
      countTexture.dispose();
      drone.dispose();
      buildingMesh?.geometry.dispose();
      drapeTexture.dispose();
      renderer.dispose();
    },
    frameCount: () => frames,
    setTime(seconds: number) {
      trailUniforms.uNow.value = seconds;
    },
    vesselsVisible: () => visibleAt(trailUniforms.uNow.value),
    placeSiteFromPointer(ndcX: number, ndcY: number) {
      if (!losGrid || sites.length >= MAX_SITES) return null;
      pointer.set(ndcX, ndcY);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([terrain, sea], false);
      if (!hits.length) return null;
      const point = hits[0].point;
      const col = (point.x + fieldWidthM / 2) / losGrid.resolutionM;
      const row = (point.z + fieldDepthM / 2) / losGrid.resolutionM;
      if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) return null;
      // A new site inherits the selected one's mast, because the usual next action after placing
      // one 25 m mast is placing another — not re-typing the height.
      const mastM = selectedSite()?.mastM ?? DEFAULT_MAST_M;
      const added: NetworkSite = { id: nextSiteId++, col, row, mastM, result: null };
      sites.push(added);
      selectedSiteId = added.id;
      solveSite(added, "full");
      recomposite();
      return { col, row };
    },
    sites: () => sites.map((s) => ({
      id: s.id,
      col: s.col,
      row: s.row,
      mastM: s.mastM,
      groundM: s.result?.siteGroundM ?? 0,
      eyeM: s.result?.eyeM ?? 0,
      horizonM: s.result?.horizonM ?? 0,
      visibleKm2: losGrid
        ? (s.result?.visibleCells ?? 0) * (losGrid.resolutionM * losGrid.resolutionM) / 1e6
        : 0,
    })),
    maxSites: () => MAX_SITES,
    selectedSiteId: () => selectedSiteId,
    selectSite(id: number | null) {
      selectedSiteId = id;
      refreshSiteMarkers();
    },
    removeSite(id: number) {
      const at = sites.findIndex((s) => s.id === id);
      if (at < 0) return;
      sites.splice(at, 1);
      if (selectedSiteId === id) selectedSiteId = sites[sites.length - 1]?.id ?? null;
      recomposite();
    },
    setSiteMast(id: number, mastM: number, quality: "drag" | "full" = "drag") {
      const target = sites.find((s) => s.id === id);
      if (!target) return;
      target.mastM = mastM;
      recomputeSite(id, quality);
    },
    networkStats: () => lastNetwork,
    /**
     * Search for the best places to put `count` masts.
     *
     * 🔴 The objective is **transits, not passages**, and that distinction is the whole reason this
     * function needed a decision before it needed code. A moored vessel transmits all day and the
     * 20-minute gap rule splits that into several counted passages — 108 of this day's 261 never
     * travelled 500 m. An optimiser rewarded for "passages observed" would therefore put masts over
     * the harbour where the tugs are tied up rather than over the fairway, and it would be right to
     * by its own objective. So the objective states what it means: a passage counts only if it
     * actually went somewhere.
     *
     * ⚠️ This does NOT change the app's headline figure, which still counts every passage. Two
     * definitions live side by side on purpose — the headline was published first and changing it
     * is a separate decision (PLAN §13.5) — so the UI has to say which one it is showing.
     *
     * Work is chunked across frames: one viewshed per candidate is seconds of solving, and doing it
     * in one blocking pass would freeze the tab with no way to show progress or cancel.
     */
    async optimiseSites(
      count: number,
      mastM: number,
      onProgress?: (done: number, total: number) => void,
      shouldCancel?: () => boolean,
    ): Promise<OptimisationResult | null> {
      if (!losGrid || !tracks) return null;
      const width = losGrid.width;
      const height = losGrid.height;
      const res = losGrid.resolutionM;

      // Which passages count, and which cells each one touches. Computed once.
      const transits: { cells: number[] }[] = [];
      const { x, z, meta: tMeta } = tracks;
      for (let index = 0; index < tMeta.tracks.length; index += 1) {
        if (!transitMask[index]) continue;
        const track = tMeta.tracks[index];
        const cells: number[] = [];
        for (let k = 0; k < track.count; k += 1) {
          const i = track.start + k;
          const col = Math.floor((x[i] + fieldWidthM / 2) / res);
          const row = Math.floor((z[i] + fieldDepthM / 2) / res);
          if (col < 0 || col >= width || row < 0 || row >= height) continue;
          cells.push(row * width + col);
        }
        if (cells.length) transits.push({ cells });
      }
      if (!transits.length) return null;

      // Candidate positions on a coarse grid, land only. A mast is built on ground, and the
      // spacing is the resolution of the answer — stated in the UI rather than hidden.
      const stride = Math.max(1, Math.round(CANDIDATE_SPACING_M / res));
      const candidateCells: { col: number; row: number }[] = [];
      for (let row = stride; row < height - stride; row += stride) {
        for (let col = stride; col < width - stride; col += stride) {
          // Land, judged by the same rule the renderer uses: above the water plane.
          if (losGrid.groundM[row * width + col] <= meta.seaLevelM + 0.5) continue;
          candidateCells.push({ col, row });
        }
      }
      if (!candidateCells.length) return null;

      const candidates: CoverageCandidate[] = [];
      // 🔴 Yield in a way that cannot stall.
      //
      // This was a bare `requestAnimationFrame`, which is exactly right while the tab is visible —
      // it hands the frame back so the UI stays alive during a ~7 s search. But rAF is **throttled
      // to a crawl, or stopped entirely, in a background tab**, and it does not run at all in some
      // headless contexts. The search then hangs for as long as the user is looking at something
      // else, with a progress bar frozen mid-count. Caught by the end-to-end suite: the identical
      // test passed headed and timed out headless after 90 s.
      //
      // Racing rAF against a short timer keeps the frame alignment when there are frames, and
      // guarantees the search finishes when there are not.
      const yieldToFrame = () => new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        requestAnimationFrame(finish);
        setTimeout(finish, 32);
      });

      for (let i = 0; i < candidateCells.length; i += 1) {
        if (shouldCancel?.()) return null;
        const { col, row } = candidateCells[i];
        const maxRange = radarHorizonM(losGrid.groundM[row * width + col] + mastM, levers.targetM);
        const full = azimuthsFor(
          Math.min(maxRange, Math.hypot(fieldWidthM, fieldDepthM)), res,
        );
        const result = computeViewshed(losGrid, {
          col, row, mastM, targetM: levers.targetM,
          // Quarter density: candidates are compared against each other, and a quartered sweep
          // changes every candidate the same way while costing a quarter as much.
          azimuths: Math.ceil(full / 4),
        });
        const observes = new Uint8Array(transits.length);
        for (let t = 0; t < transits.length; t += 1) {
          for (const cell of transits[t].cells) {
            if (result.field[cell] === 2) { observes[t] = 1; break; }
          }
        }
        candidates.push({ id: i, observes });
        if (i % 8 === 0) {
          onProgress?.(i, candidateCells.length);
          await yieldToFrame();
        }
      }
      onProgress?.(candidateCells.length, candidateCells.length);

      const picks = greedyMaxCoverage(candidates, transits.length, count);

      // Score what the user already placed, on the same objective, so the two are comparable.
      const currentCandidates: CoverageCandidate[] = sites.map((s, i) => {
        const observes = new Uint8Array(transits.length);
        const field = s.result?.field;
        if (field) {
          for (let t = 0; t < transits.length; t += 1) {
            for (const cell of transits[t].cells) {
              if (field[cell] === 2) { observes[t] = 1; break; }
            }
          }
        }
        return { id: i, observes };
      });

      return {
        transits: transits.length,
        candidatesTried: candidateCells.length,
        candidateSpacingM: CANDIDATE_SPACING_M,
        mastM,
        currentCovered: coverageOf(currentCandidates, transits.length),
        currentSites: sites.length,
        picks: picks.map((p) => {
          const { col, row } = candidateCells[p.id];
          const world = {
            x: -fieldWidthM / 2 + (col + 0.5) * res,
            z: -fieldDepthM / 2 + (row + 0.5) * res,
          };
          const { lat, lon } = toLonLat(world.x, world.z);
          return {
            col, row, lat, lon,
            groundM: losGrid.groundM[row * width + col],
            newlyCovered: p.newlyCovered,
            cumulative: p.cumulative,
          };
        }),
      };
    },
    /**
     * Replace the network with a given set of sites.
     *
     * Mast height travels **per site**, because restoring a saved variant has to reproduce it
     * exactly — a comparison between two configurations is worthless if loading one of them
     * flattens every mast to the same height.
     */
    applySites(positions: { col: number; row: number; mastM: number }[]) {
      sites.length = 0;
      for (const p of positions.slice(0, MAX_SITES)) {
        sites.push({ id: nextSiteId++, col: p.col, row: p.row, mastM: p.mastM, result: null });
      }
      selectedSiteId = sites[0]?.id ?? null;
      for (const s of sites) solveSite(s, "full");
      recomposite();
    },
    /**
     * Everything the exportable annex needs, assembled from what has already been measured.
     *
     * Built here rather than in the UI because only the scene knows where the sites are in WGS84,
     * which passages were missed and how close they came — and because assembling it from the
     * rendered panels would let the annex and the screen drift apart, which is the one failure
     * mode a document that outlives the meeting cannot afford.
     */
    reportData(missedLimit = 40): ReportModel | null {
      if (!losGrid || !sites.length || !composite) return null;
      const cellArea = (losGrid.resolutionM * losGrid.resolutionM) / 1e6;
      let visibleCells = 0;
      let shadowedCells = 0;
      for (let i = 0; i < composite.length; i += 1) {
        if (composite[i] === 2) visibleCells += 1;
        else if (composite[i] === 1) shadowedCells += 1;
      }

      const reportSites: ReportSite[] = sites.map((s, index) => {
        const world = {
          x: -fieldWidthM / 2 + (s.col + 0.5) * losGrid.resolutionM,
          z: -fieldDepthM / 2 + (s.row + 0.5) * losGrid.resolutionM,
        };
        const { lat, lon } = toLonLat(world.x, world.z);
        const contribution = lastNetwork?.perSite[index];
        return {
          index: index + 1,
          lat,
          lon,
          // The cell, so a committed plan restores to the exact mast the figures describe.
          col: s.col,
          row: s.row,
          mastM: s.mastM,
          groundM: s.result?.siteGroundM ?? 0,
          eyeM: s.result?.eyeM ?? 0,
          horizonKm: (s.result?.horizonM ?? 0) / 1000,
          observedPassages: contribution?.observedPassages ?? 0,
          uniquePassages: contribution?.uniquePassages ?? 0,
        };
      });

      // Which passages the network missed, and how near they came to being seen. Sorted by
      // closest approach so the ones that nearly worked — the cheapest to fix — come first.
      const missed: ReportMissedPassage[] = [];
      if (tracks) {
        const { x, z, meta: tMeta } = tracks;
        const siteWorld = sites.map((s) => ({
          x: -fieldWidthM / 2 + (s.col + 0.5) * losGrid.resolutionM,
          z: -fieldDepthM / 2 + (s.row + 0.5) * losGrid.resolutionM,
        }));

        for (let index = 0; index < tMeta.tracks.length; index += 1) {
          // The missed list follows the same rule as the figures above it: only transits.
          if (!transitMask[index]) continue;
          const track = tMeta.tracks[index];
          let inGrid = false;
          let seen = false;
          let nearestM = Infinity;
          for (let k = 0; k < track.count; k += 1) {
            const i = track.start + k;
            const col = Math.floor((x[i] + fieldWidthM / 2) / losGrid.resolutionM);
            const row = Math.floor((z[i] + fieldDepthM / 2) / losGrid.resolutionM);
            if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) continue;
            inGrid = true;
            if (composite[row * losGrid.width + col] === 2) { seen = true; break; }
            for (const site of siteWorld) {
              const d = Math.hypot(x[i] - site.x, z[i] - site.z);
              if (d < nearestM) nearestM = d;
            }
          }
          if (!inGrid || seen) continue;
          missed.push({
            vessel: track.vessel,
            ...(track.name ? { name: track.name } : {}),
            type: track.type,
            fromUtc: clockUtc(track.fromS),
            toUtc: clockUtc(track.toS),
            minutesInArea: Math.max(1, Math.round((track.toS - track.fromS) / 60)),
            distanceKm: passageLengthKm(index),
            nearestSiteKm: Number.isFinite(nearestM) ? nearestM / 1000 : null,
          });
        }
        // Sorted by distance travelled, descending: the real transits belong at the top of an
        // annex. Sorting by nearest approach put a single moored tug's eight stationary "passages"
        // above every actual movement, which made the most prominent table in the document noise.
        missed.sort((a, b) => b.distanceKm - a.distanceKm);
      }

      return {
        generatedUtc: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        aoiName: "Kieler Förde",
        scenario,
        trackDate: tracks?.meta.date ?? "—",
        targetM: levers.targetM,
        sites: reportSites,
        traffic: lastTraffic,
        network: lastNetwork,
        areaVisibleKm2: visibleCells * cellArea,
        areaShadowedKm2: shadowedCells * cellArea,
        missed: missed.slice(0, missedLimit),
        missedShown: missedLimit,
        excludedStationary,
        stationaryBelowKm: TRANSIT_MIN_KM,
        // Straight from the built descriptor, so the annex states what THIS site's surface holds.
        surface: los ? {
          includesBuildings: los.meta.includesBuildings,
          includesVegetation: los.meta.includesVegetation,
          vegetationStats: los.meta.vegetationStats ?? null,
        } : null,
        // Filled by the caller: variants are a UI concept, held where the buttons are.
        variants: [],
      };
    },
    setOverlapMode(on: boolean) {
      coverage.uniforms.uOverlapMode.value = on ? 1 : 0;
    },
    setLevers(mastM: number, targetM: number) {
      // The mast belongs to the selected site; the target height is shared by the whole network.
      const target = selectedSite();
      const targetChanged = targetM !== levers.targetM;
      levers.targetM = targetM;
      if (target && target.mastM !== mastM) {
        target.mastM = mastM;
        if (!targetChanged) { recomputeSite(target.id, "drag"); return; }
      }
      // A new target height invalidates every site's field, not just the selected one.
      if (targetChanged) recompute("drag");
    },
    settleLevers() {
      recompute("full");
    },
    coverageStats() {
      const shown = selectedSite()?.result;
      if (!shown || !losGrid || !composite) return null;
      const cellArea = (losGrid.resolutionM * losGrid.resolutionM) / 1e6;
      // Area is reported for the NETWORK, while the site-specific readouts below describe the
      // selected mast — mixing the two silently was the obvious trap here.
      let visibleCells = 0;
      let shadowedCells = 0;
      for (let i = 0; i < composite.length; i += 1) {
        if (composite[i] === 2) visibleCells += 1;
        else if (composite[i] === 1) shadowedCells += 1;
      }
      return {
        visibleKm2: visibleCells * cellArea,
        shadowedKm2: shadowedCells * cellArea,
        siteGroundM: shown.siteGroundM,
        eyeM: shown.eyeM,
        horizonM: shown.horizonM,
        elapsedMs: shown.elapsedMs,
        traffic: lastTraffic,
        approach: scenario === "counterUas" ? lastApproach : null,
      };
    },
    setCoverageMode(on: boolean) {
      coverage.uniforms.uCoverageMode.value = on ? 1 : 0;
    },
    setGapMode(on: boolean) {
      coverage.uniforms.uGapMode.value = on ? 1 : 0;
    },
    setScenario(next: Scenario) {
      scenario = next;
      const uas = next === "counterUas";
      assetPins.visible = uas;
      assetRings.visible = uas;
      // Presets, not locks: the checkbox in the panel can put the ships back on top of the
      // airfield if somebody wants to argue about a harbour drone.
      vesselsWanted = !uas;
      applyVesselVisibility();
      if (uas) showProtectionRing(selectedAssetId, protectionRadiusM);
      else showProtectionRing(null, 0);
      if (composite) lastApproach = measureApproach(composite);
    },
    scenario: () => scenario,
    protectedAssets: () => assetList,
    setSelectedAsset(id: string | null) {
      selectedAssetId = id;
      const asset = assetList.find((a) => a.id === id);
      if (asset) protectionRadiusM = asset.protectionRadiusM;
      for (const [assetId, pin] of assetPinByeId) {
        // The unselected objects stay on the map but step back, so the scene says "these exist"
        // without three rings competing for the same fjord.
        pin.traverse((child) => {
          const mesh = child as THREE.Mesh;
          const material = mesh.material as THREE.Material | undefined;
          if (material && "opacity" in material) {
            (material as THREE.MeshBasicMaterial).opacity = assetId === id ? 0.9 : 0.35;
            material.transparent = true;
          }
        });
      }
      if (scenario === "counterUas") showProtectionRing(selectedAssetId, protectionRadiusM);
      if (composite) lastApproach = measureApproach(composite);
    },
    selectedAsset: () => assetList.find((a) => a.id === selectedAssetId) ?? null,
    setProtectionRadius(radiusM: number) {
      protectionRadiusM = radiusM;
      if (scenario === "counterUas") showProtectionRing(selectedAssetId, protectionRadiusM);
      if (composite) lastApproach = measureApproach(composite);
    },
    protectionRadiusM: () => protectionRadiusM,
    approachStats: () => lastApproach,
    sweepAltitudes,
    setVesselsVisible(on: boolean) {
      vesselsWanted = on;
      applyVesselVisibility();
    },
    vesselsShown: () => vesselsWanted,
    clearSite() {
      sites.length = 0;
      selectedSiteId = null;
      composite?.fill(0);
      coverCount?.fill(0);
      lastTraffic = null;
      lastApproach = null;
      lastNetwork = null;
      refreshSiteMarkers();
      coverage.uniforms.uCoverageMode.value = 0;
      coverage.uniforms.uOverlapMode.value = 0;
      // Mode D only means anything relative to a site, so it goes with it rather than being left
      // on and quietly dimming traffic against a coverage field that no longer exists.
      coverage.uniforms.uGapMode.value = 0;
      // The field texture is left as it is: nothing samples it while uCoverageMode is 0, and
      // clearing 780 000 texels to achieve nothing visible would just be work.
    },
    siteMarkerVisible: () => siteGroup.visible,
    pickVesselFromPointer(ndcX: number, ndcY: number) {
      if (!tracks) return null;
      const seconds = trailUniforms.uNow.value;
      const trackY = meta.seaLevelM + 2;
      const world = new THREE.Vector3();

      // 🔴 Distance is measured in PIXELS, not in normalised device coordinates.
      //
      // NDC spans -1..1 across the width *and* across the height, so `hypot` on raw NDC treats a
      // step sideways as equal to a step upwards — on a wide window they are nothing alike.
      // Measured on the shipped build at 1650 × 912: the hit region was **151 px wide and 7 px
      // tall**, a 21:1 ellipse. Clicking a hair above a ship missed; clicking well to its side
      // grabbed a different one. That is the whole of "the boat selection is weird", and no amount
      // of tuning the NDC threshold fixes it, because the defect is the shape, not the size.
      const halfW = renderer.domElement.clientWidth / 2;
      const halfH = renderer.domElement.clientHeight / 2;
      const pixelsFrom = (v: THREE.Vector3) =>
        Math.hypot((v.x - ndcX) * halfW, (v.y - ndcY) * halfH);

      // Project every vessel that is actually under way and take the nearest on screen. With at
      // most a few dozen active passages this is far simpler and more predictable than raycasting
      // a Points cloud whose shader discards all but one report per track.
      let bestTrack: number | null = null;
      let bestDistance = Infinity;
      for (let index = 0; index < tracks.meta.tracks.length; index += 1) {
        const state = stateAt(index, seconds);
        if (!state) continue;
        world.set(state.x, trackY, state.z).project(camera);
        if (world.z < -1 || world.z > 1) continue;   // behind the camera or beyond the far plane
        const distance = pixelsFrom(world);
        if (distance < bestDistance) { bestDistance = distance; bestTrack = index; }
      }

      // A vessel is only a few pixels wide, so the target has to be bigger than the mark — but it
      // is now the same size in every direction, which is what makes it feel deliberate.
      if (bestTrack !== null && bestDistance <= VESSEL_PICK_PX) {
        selectedTrack = bestTrack;
        return describe(bestTrack, seconds);
      }

      // 🔴 Second pass: anything on a TRAIL, whether or not it is under way now.
      //
      // The first pass only considers vessels moving at the current clock, so every finished or
      // not-yet-started passage was unclickable — and its trail is still drawn on the water. The
      // trail is a real object on screen; clicking it and getting nothing is indistinguishable
      // from a broken feature. Projecting all reports costs a few milliseconds on a click, which
      // is nothing for something that does not run per frame.
      let trailTrack: number | null = null;
      let trailIndex = -1;
      let trailDistance = Infinity;
      const { x, z, t, meta: tMeta } = tracks;
      for (let ti = 0; ti < tMeta.tracks.length; ti += 1) {
        const track = tMeta.tracks[ti];
        for (let k = 0; k < track.count; k += 1) {
          const i = track.start + k;
          world.set(x[i], trackY, z[i]).project(camera);
          if (world.z < -1 || world.z > 1) continue;
          const distance = pixelsFrom(world);
          if (distance < trailDistance) {
            trailDistance = distance;
            trailTrack = ti;
            trailIndex = i;
          }
        }
      }

      // Tighter than the head threshold: a trail is a thin line the user aimed at deliberately,
      // and a loose radius here would hijack clicks meant for the terrain behind it — on a narrow
      // inlet the trails cover most of the water, so this is the difference between "place a mast"
      // and "select a boat I did not point at".
      if (trailTrack === null || trailDistance > TRAIL_PICK_PX) {
        selectedTrack = null;
        selectionRing.visible = false;
        return null;
      }
      selectedTrack = trailTrack;
      // Describe it at the moment belonging to the point clicked, not at the wall clock.
      return describe(trailTrack, t[trailIndex] * tMeta.timeStepS);
    },
    selectedVessel() {
      if (selectedTrack === null) return null;
      return describe(selectedTrack, trailUniforms.uNow.value);
    },
    clearVessel() {
      selectedTrack = null;
      selectionRing.visible = false;
    },
    setDroneMode(on: boolean) {
      // Everything this used to do — disabling OrbitControls, and deriving an orbit target the
      // orbit camera will accept on the way back out — now lives in `flyControls.ts`, because it
      // has to happen on a keypress as well as on a call and there must be exactly one copy of it.
      //
      // ⚠️ The old hand-back put the target a flat 3 km along the view direction, which the orbit
      // camera then had to clamp: `update()` enforces `maxPolarAngle` every frame by *moving the
      // camera*, so any view that was level or tilted up jumped the moment drone mode ended. The
      // module tilts the direction just under the limit and marches it against the terrain instead.
      drone.setEngaged(on);
    },
    droneEngaged: () => drone.engaged,
    onDroneMode(listener) {
      droneListener = listener;
    },
    droneTelemetry: () => (drone.engaged ? drone.telemetry() : null),
    coverageAtCamera,
    flyToMast() {
      // The selected mast, since with five of them "the mast" is no longer a thing.
      const target = selectedSite();
      if (!losGrid || !target?.result) return false;
      const x = -fieldWidthM / 2 + (target.col + 0.5) * losGrid.resolutionM;
      const z = -fieldDepthM / 2 + (target.row + 0.5) * losGrid.resolutionM;
      // Stand at the eye, not beside it: this is the one viewpoint from which the coverage field
      // is not an abstraction.
      camera.position.set(x, target.result.eyeM, z);
      // Look along the fjord axis, out towards the sea rather than inland.
      camera.lookAt(x, target.result.eyeM, z - 4000);
      // ⚠️ The drone keeps its own yaw and pitch, so moving the camera underneath it would be
      // undone on the next frame. Re-adopting the new orientation is what makes this stick.
      if (drone.engaged) {
        drone.setEngaged(false);
        drone.setEngaged(true);
      }
      return true;
    },
    /**
     * Move the camera to look at one point on the water.
     *
     * 🔴 It **moves rather than animates**, and that is deliberate here. The sibling alpine app
     * arcs between fixed places, which reads as travel over known ground. A live vessel is moving
     * while the camera flies, so a 1.5 s arc lands where the ship *was* — and the longer the
     * flight, the further behind it arrives. Going straight there and letting the follow-up frames
     * track the ship is the honest behaviour for a moving target.
     *
     * ⚠️ The drone keeps its own yaw and pitch, so a camera move underneath it is undone on the
     * next frame unless the orientation is re-adopted — the same trap `flyToMast` documents.
     */
    flyToLonLat(lon: number, lat: number, rangeM = 2600) {
      const b = meta.boundsWgs84;
      if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return false;
      const { x, z } = fromLonLat(lon, lat);
      // Look down from the south at roughly 50°, which keeps the water surface readable and the
      // vessel's wake visible rather than staring straight down at a dot.
      frameCamera(x, z, rangeM);
      return true;
    },
    /**
     * Frame the live traffic that is actually on the water right now.
     *
     * 🔴 The **median** vessel, never the centroid. Traffic here splits into an outer-bay group and
     * an inner-fjord group, and the mean of the two lands in the empty water between them — the
     * camera would fly to a spot with no ships in it and the control would look broken. The median
     * is guaranteed to be *at* a vessel.
     *
     * Returns false when there is nothing to look at, so the caller can leave the camera alone
     * rather than flying to the origin.
     */
    focusOnTraffic(rangeM = 6000) {
      if (!liveMode || liveBuffers.heads.length === 0) return false;
      const xs: number[] = [];
      const zs: number[] = [];
      for (const index of liveBuffers.heads) {
        xs.push(liveBuffers.x[index]);
        zs.push(liveBuffers.z[index]);
      }
      // Medians are taken per axis. That is not the geometric median, but it is stable, cheap and
      // lands inside the traffic, which is all the framing needs.
      xs.sort((a, b) => a - b);
      zs.sort((a, b) => a - b);
      const mid = Math.floor(xs.length / 2);
      frameCamera(xs[mid], zs[mid], rangeM);
      return true;
    },
    placeSiteAtCamera() {
      if (!losGrid || sites.length >= MAX_SITES) return false;
      const col = (camera.position.x + fieldWidthM / 2) / losGrid.resolutionM;
      const row = (camera.position.z + fieldDepthM / 2) / losGrid.resolutionM;
      if (col < 0 || col >= losGrid.width || row < 0 || row >= losGrid.height) return false;
      const mastM = selectedSite()?.mastM ?? DEFAULT_MAST_M;
      const added: NetworkSite = { id: nextSiteId++, col, row, mastM, result: null };
      sites.push(added);
      selectedSiteId = added.id;
      solveSite(added, "full");
      recomposite();
      return true;
    },
    /**
     * Repaint everything the palette owns.
     *
     * 🔴 Uniform `.set()` calls plus three colour objects — deliberately NOT a rebuild. Nothing
     * here touches the heightmap, the LOS field, the site list or any solved result, which is what
     * makes "the theme cannot move a measured figure" a structural property rather than a promise.
     */
    setTheme(name: ThemeName) {
      const t = SCENE_THEMES[name];
      themeUniforms.uTerrainRamp.value.set(...t.terrainRamp);
      themeUniforms.uShellLow.value.setRGB(...t.shellLow);
      themeUniforms.uShellHigh.value.setRGB(...t.shellHigh);
      themeUniforms.uShellRamp.value.set(...t.shellRamp);
      themeUniforms.uSeaGlitter.value = t.seaGlitter;
      themeUniforms.uBuildingBase.value.setRGB(...t.buildingBase);
      themeUniforms.uBuildingRamp.value.set(...t.buildingRamp);
      themeUniforms.uCoverVisible.value.setRGB(...t.coverVisible);
      themeUniforms.uCoverOverlap.value.setRGB(...t.coverOverlap);
      themeUniforms.uCoverShadow.value.setRGB(...t.coverShadow);
      themeUniforms.uCoverShadowMix.value = t.coverShadowMix;
      themeUniforms.uTrailSlow.value.setRGB(...t.trailSlow);
      themeUniforms.uTrailFast.value.setRGB(...t.trailFast);
      themeUniforms.uTrailMuted.value.setRGB(...t.trailMuted);
      themeUniforms.uTrailAlert.value.setRGB(...t.trailAlert);
      themeUniforms.uHeadSlow.value.setRGB(...t.headSlow);
      themeUniforms.uHeadFast.value.setRGB(...t.headFast);
      themeUniforms.uHeadMuted.value.setRGB(...t.headMuted);
      themeUniforms.uHeadAlert.value.setRGB(...t.headAlert);

      // The sea's sky term, the clear colour and the fog are one colour on purpose: the water has
      // to meet the horizon rather than stop at it.
      seaUniforms.uSky.value.set(t.sky);
      seaUniforms.uDeep.value.setRGB(...t.seaDeep);
      seaUniforms.uCoastal.value.setRGB(...t.seaCoastal);
      renderer.setClearColor(t.sky);
      if (scene.fog) (scene.fog as THREE.Fog).color.set(t.sky);

      // The markers are plain materials, not shaders, so they are set directly.
      mastMaterial.color.setRGB(...t.mast);
      selectedMastMaterial.color.setRGB(...t.mastSelected);
      selectionDiscMaterial.color.setRGB(...t.siteDisc);
      // Four asset materials share one themed colour and differ only in opacity, which is not a
      // theme property — recolour every one of them or half the pins stay on the old palette.
      for (const m of [assetMarkerMaterial, assetDiscMaterial, assetLineMaterial,
                       assetRingMaterial]) {
        m.color.setRGB(...t.assetMarker);
      }
      vesselRingMaterial.color.setRGB(...t.vesselRing);
    },
    setLiveMode(on: boolean) {
      liveMode = on;
      applyVesselVisibility();
      // See `uHeadScale`: the same shared material serves both modes, and only one set of heads is
      // ever visible, so the scale can simply follow the mode.
      trailUniforms.uHeadScale.value = on ? LIVE_HEAD_SCALE : 1;
      // The trail window is the same 30 minutes in both modes; only the clock's origin differs —
      // seconds into the recorded day, or seconds since the epoch.
      if (on) trailUniforms.uNow.value = Date.now() / 1000;
    },
    setLiveVessels(vessels: Map<string, LiveVessel>) {
      // 🔴 Bounds are passed, so the SCENE draws the same water the list describes. The relay
      // subscribes to the whole western Baltic shell (~380 vessels) while the modelled water holds
      // ~65; without this the map showed hundreds of ships the panel refused to list, and clicking
      // one only ever answered "outside the model".
      fill(vessels, liveFrame, liveBuffers, { bounds: meta.boundsWgs84 });
      const trackY = meta.seaLevelM + 2;
      for (let i = 0; i < liveBuffers.count; i += 1) {
        livePositions[i * 3] = liveBuffers.x[i];
        livePositions[i * 3 + 1] = trackY;
        livePositions[i * 3 + 2] = liveBuffers.z[i];
      }
      liveTrailGeometry.setIndex(liveBuffers.segments);
      liveTrailGeometry.setDrawRange(0, liveBuffers.segments.length);
      // ⚠️ Heads are INDEXED to one vertex per vessel. Drawing the whole point buffer painted a
      // marker on every report in the tail, so a moving ship wore a string of dots and the fjord
      // looked far busier than the vessel count claimed.
      liveHeadGeometry.setIndex(liveBuffers.heads);
      liveHeadGeometry.setDrawRange(0, liveBuffers.heads.length);
      livePositionAttr.needsUpdate = true;
      liveTimeAttr.needsUpdate = true;
      liveSpeedAttr.needsUpdate = true;
      if (liveMode) {
        // In live mode the clock is wall time, so the most recent report is always "now" even if
        // the relay's own clock drifts a little from the browser's.
        let newest = 0;
        for (let i = 0; i < liveBuffers.count; i += 1) {
          if (liveBuffers.t[i] > newest) newest = liveBuffers.t[i];
        }
        trailUniforms.uNow.value = Math.max(newest, Date.now() / 1000);
      }
      return liveBuffers.count;
    },
    stats: () => ({
      triangles: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      textureMB: renderer.info.memory.textures,
      geometryMB: renderer.info.memory.geometries,
    }),
  };
}

// Land mask is loaded and kept for the visibility model in a later phase; referencing it here
// keeps the unused-variable check honest about the fact that it is not used yet.
export function landCoverage(land: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < land.length; i += 1) sum += land[i];
  return sum / land.length;
}

