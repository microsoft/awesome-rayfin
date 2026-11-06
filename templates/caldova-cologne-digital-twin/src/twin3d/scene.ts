import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AoiConfig, AoiFocusPlace } from '@/config/aoi';
import { placeToWorld, toWorld, worldExtent, type WorldExtent } from '@/geo/world';

import { loadBuildings, type BuildingLayer } from './buildings';
import { loadMeshCore, MeshNotBuiltError, type MeshCoreLayer } from './meshCore';
import { applyNightState, REVEAL_SOFT_M, setHeadlamp } from './nightLighting';
import { placeName, subscribeBrand } from '@/config/brand';
import type { DayEvent } from './dayEvents';
import { createFlyControls, type FlyControls, type FlyTelemetry } from './flyControls';
import { createLabelLayer, type LabelAnchor, type LabelLayer } from './labelLayer';
import { EXPLODE_GAP_M, loadRooms, type RoomLayer, type RoomView } from './rooms';
import { createShellMaterial } from './shellMaterial';
import { createSky, type Sky } from './sky';
import {
  AMBIENT,
  createTerrainMaterial,
  HAZE_COLOUR,
  SHADOW_TINT,
  SKY_COLOUR,
  SUN_DIRECTION,
  SUN_TINT,
} from './terrainMaterial';
import {
  loadTerrain,
  TerrainNotBuiltError,
  type ProgressReporter,
  type TerrainAssets,
} from './terrainLoader';
import { loadVegetation, type VegetationLayer } from './vegetation';
import { loadWater, type WaterLayer } from './water';
import { loadFlows, type FlowLayer } from './flows';
import { loadDcInterior, type DcInteriorLayer } from './dcInterior';
import { createTourLayer, nightAt, OPENING_SLOT, type TourLayer } from './tours';
import { createWalkRouteLayer, type WalkRouteLayer } from './walkRoute';

/**
 * The campus scene.
 *
 * One terrain covers the whole AOI, so every building, every tree and — from Phase 3 — every room
 * is a point on one continuous ground rather than a separate map.
 *
 * ⚠️ **This AOI is flat, and that changes what makes it look real.** The engine came from an Alpine
 * app where 1 400 m of relief did most of the work: hillshade alone made that terrain legible.
 * Garching has about 20 m across two kilometres, so terrain shading contributes almost nothing and
 * the realism has to come from the 20 cm orthophoto drape, the LoD2 roofs and the measured trees.
 *
 * The scene degrades cleanly: a fresh clone with no generated geodata still renders sky, a
 * reference plane and the resolved places, because that is a normal first-run state, not an error.
 */

export interface PickedPlace {
  id: string;
  name: string;
  source: string;
  /**
   * `site` names a whole area — a campus outline in the engine's original app, a works site here;
   * `unmodelled` is a real building this dataset holds no interior for. They are different facts
   * and the panel says different things about them — collapsing them into "nothing here" would
   * make a deliberate scope decision look like missing data.
   */
  kind: 'site' | 'unmodelled';
}

export interface Twin3DHandle {
  focusPlace(placeId: string): void;
  /**
   * Do whatever that place's name promises: open the hall if it IS the hall, otherwise fly to it.
   * The same path a click on the map label takes, so the panel and the map cannot behave
   * differently for the same four places.
   */
  activatePlace(placeId: string): void;
  /** True once real terrain has been built and loaded. */
  hasTerrain: boolean;
  /** True once the orthophoto drape is on the ground. */
  hasDrape: boolean;
  /**
   * Whether every terrain raster is uploaded the same way up.
   *
   * The terrain shader samples the heightmap, the land cover, the shell and the drape through one
   * helper that flips V, because all four are stored row 0 = north. That is only correct if they
   * all agree on `flipY` — and `THREE.DataTexture` defaults it to false while `THREE.Texture`
   * defaults it to true, so the drape silently disagreed and was drawn mirrored north-south. It
   * did not look like a texture bug: the photograph was sharp and the terrain was lit correctly,
   * so it read as the *buildings* being misplaced, and cost a long hunt through the pipeline
   * before the app was suspected. Exposed so that stays a failing test rather than a look.
   */
  rastersShareOrientation: boolean;
  buildingCount: number;
  /**
   * How many distinct roof and wall colours are actually on the buildings, counted off the buffer
   * the shader reads.
   *
   * Every LoD2 site in this app measures its roofs from its own orthophoto and classifies its
   * walls from the cadastre; a site that quietly loses that data still renders, in one flat beige,
   * and looks merely dull rather than broken. The two campus twins shipped exactly like that
   * because the colour pass had never been run for them. Exposed so "the buildings look worse
   * here" is a measurement instead of an impression.
   */
  buildingColours(): { roofColours: number; wallColours: number };
  treeCount: number;
  /**
   * Milliseconds from navigation start to the first frame containing the campus, or null before
   * it has been drawn. Transferred bytes are what the network waits for; this is what the viewer
   * waits for, and the two fail differently.
   */
  firstFrameMs(): number | null;
  /**
   * ESTIMATED GPU texture memory, in bytes.
   *
   * An estimate and not a measurement: WebGL will not tell you what it allocated, and a driver is
   * free to pad, realign or compress. It is computed from the app's own textures — dimensions,
   * format and mipmap flag — which is enough to catch the failure that actually happens, a drape
   * baked at 8192 px. It is not enough to quote as a fact about the GPU.
   */
  textureBytes(): number;
  /** Hectares of mapped water surface. Zero is a fact about the site — Garching has no river. */
  waterHectares: number;

  /**
   * ── The photoreal core (NRW 3D-Mesh) ───────────────────────────────────────────────────────
   *
   * Null where no mesh has been baked. Counts come from what reached the GPU, not the manifest.
   */
  meshCore: { tiles: number; loaded: number; vertices: number; texels: number; bytes: number; ringTiles: number; ringLoaded: number } | null;
  /** Show the photogrammetric mesh (true) or the LoD2 + orthophoto model it replaces (false). */
  setMeshVisible(visible: boolean): void;
  meshVisible(): boolean;

  /**
   * ── The distribution centre ────────────────────────────────────────────────────────────────
   *
   * Null at any site with no operations model, which is every campus AOI. The UI must not offer
   * the control when this is null: a button that opens nothing is the most repeated defect in
   * this engine's history and it has always looked finished.
   */
  dcInterior: DcInteriorLayer | null;
  /**
   * Open the hall along the process chain, and fly the camera to where it can be seen. Closing it
   * flies back to the view from before it opened, unless `restoreView` is false.
   */
  openDc(open: boolean, restoreView?: boolean): void;
  /**
   * Called whenever the hall opens or closes, whoever asked for it.
   *
   * ⚠️ THE PANEL KEEPS ITS OWN OPEN/CLOSED STATE, so a hall opened from the map has to say so or
   * the button label and the scene disagree and the next press looks like it does nothing.
   */
  onDcOpenChanged(handler: (open: boolean) => void): void;
  /** Which focus place, if any, opens the hall when its name is clicked. */
  hallPlace(): string | null;
  dcOpen(): boolean;
  /** How far open, 0..1. Exposed so a test can assert the zones actually moved. */
  dcExplodeProgress(): number;
  /**
   * Move to a moment in the operating day, as a FRACTIONAL quarter-hour (0..96).
   * Fractional so the vans interpolate; the hall rounds to its own 15-minute grid.
   */
  setDcSlot(slot: number): void;
  dcSlot(): number;
  /**
   * The last-mile layer: pharmacy locations (real coordinates; fictional names in Cologne) and the
   * modelled tours that serve them.
   * Null wherever there is no operations model.
   */
  tours: TourLayer | null;
  /** Show the delivery region, and fly out far enough to see all 44 km of it. */
  setToursVisible(visible: boolean): void;
  toursVisible(): boolean;
  /** How many tours are on the road at the current moment. */
  activeTours(): number;
  /** How many vans are standing at a pharmacy right now, unloading. */
  vansAtStop(): number;
  /** 0 by day, 1 in the deep of the night, from the same clock as everything else. */
  nightFactor(): number;
  /**
   * How many shading materials the night reached, and how many it could not.
   *
   * ⚠️ `skipped` MUST BE ZERO. A skipped material is a surface that stays lit through the night,
   * which is exactly the defect that let a black-sky scene render a fully lit city.
   */
  nightCoverage(): { applied: number; skipped: number };
  /** How far the night's reveal currently extends from the site, in metres. */
  revealRadius(): number;
  /**
   * How many pharmacies were matched to a LoD2 building, and how many exist.
   *
   * ⚠️ THE RATIO IS SUPPOSED TO BE SMALL. The mesh covers the 2 km core and the tours reach 22 km,
   * so most pharmacies have no building here. Exposed so a test can assert the matched ones really
   * are lit, and that the number has not quietly become suspiciously large — which would mean the
   * matcher had started snapping pharmacies onto whatever building was nearest.
   */
  pharmacyHighlight(): { matched: number; total: number; litVertices: number };
  /** How many pharmacy names exist, are in frame, and survive the declutter right now. */
  labelStats(): { total: number; inFrame: number; drawn: number };
  /**
   * Turn the pharmacy building highlight on or off.
   *
   * ⚠️ EXISTS SO THE HIGHLIGHT CAN BE CHECKED BY COMPARISON. Testing it by hunting for "blue
   * pixels" needs a colour threshold, and a threshold that works by day reports ZERO at night on a
   * highlight that is plainly visible in the screenshot. Toggling the state and diffing the same
   * pixels from the same camera has no such knob to get wrong.
   */
  highlightPharmacies(on: boolean): void;
  /** The named moments of the operating day, derived from the modelled tours. */
  dayEvents(): DayEvent[];
  /** The moment a van is delivering inside the modelled city, or null. */
  cityDeliverySlot(): number | null;
  /** How many vans are inside the modelled city right now. */
  vansInCity(): number;
  /**
   * Ride along with a delivery. Picks the active van nearest the camera and returns its index,
   * or -1 if nothing is on the road. Pass false to stop.
   */
  followDelivery(on: boolean): number;
  /** Which tour the camera is riding with, or -1. */
  followingDelivery(): number;
  /** Told when the ride ends, including when it ends by itself because the tour finished. */
  onFollowChanged(handler: (following: boolean) => void): void;
  /**
   * Put the camera over a geographic point, looking down at it from `rangeM`.
   *
   * Exists so a test can frame a specific building — a highlight is a claim about ONE building,
   * and checking it from a view that does not contain that building proves nothing.
   */
  lookAt(lat: number, lon: number, rangeM: number): void;
  /** Highlight one zone of the hall, or pass null to clear. */
  selectZone(id: string | null): void;
  selectedZone(): string | null;
  /** Called when the viewer clicks a zone in the open hall — or beside one, which clears it. */
  onZonePicked(handler: (id: string | null) => void): void;

  /** The derived pedestrian flow layer, where the site has a timetable to derive it from. */
  flows: FlowLayer | null;
  setFlowVisible(visible: boolean): void;
  /** Show one 15-minute slot of the teaching week, or the whole week when null. */
  setFlowSlot(slot: number | null): void;
  /**
   * Draw the walk between two rooms on the paths it actually uses, or pass an empty list to clear.
   * Points are `[lon, lat]` in order of travel — the drawn dash runs from the first to the last.
   */
  showWalkRoute(points: [number, number][]): void;
  /** How many points of a walk are drawn right now. Zero means none — verifiable, not implied. */
  walkRoutePoints(): number;
  /** Real indoor rooms, where the site has any. Zero is a fact about the site, not a failure. */
  roomCount: number;
  rooms: RoomLayer | null;
  setRoomsVisible(visible: boolean): void;
  /**
   * Open a building's floors apart, or pass null to close. The camera moves to frame it and the
   * LoD2 shell steps back so the rooms become the subject.
   *
   * Closing also flies the camera back to wherever it was before the building was opened, so
   * dismissing one undoes the whole act rather than leaving the viewer stranded in a close shot.
   * Pass `restoreView: false` when the camera has already been moved deliberately.
   */
  explodeBuilding(code: string | null, restoreView?: boolean): void;
  /** Which building is currently open. */
  explodedBuilding(): string | null;
  /** How far open, 0..1. Exposed so a test can assert the floors actually moved. */
  explodeProgress(): number;
  /**
   * Where the camera is and what it looks at, in scene metres. A test can assert the floors moved
   * and still be looking at the wrong campus — that happened — so the framing needs a witness too.
   */
  cameraDebug(): { pos: [number, number, number]; target: [number, number, number] };
  /** Colour rooms by one hour of the teaching week, or by the whole week when null. */
  setTimeSlot(slot: number | null): void;
  /** Select a room, or none. Moves nothing; the caller decides whether to frame it. */
  selectRoom(index: number | null): void;
  /** Whether the viewer has asked for reduced motion. Read live, so a test can emulate it. */
  reducedMotion(): boolean;
  /** Called when the viewer clicks a room in the exploded view. */
  onRoomPicked(handler: (room: RoomView | null) => void): void;
  /** Called when the viewer clicks a building while nothing is open. */
  onBuildingPicked(handler: (code: string) => void): void;
  /**
   * A map label was clicked that names something this dataset cannot open — a campus outline, or a
   * building with no rooms. The camera has already flown there; the panel says what it is.
   */
  /** Drop the highlight on a named place, when the panel stops describing it. */
  clearPlaceHighlight(): void;
  onPlacePicked(handler: (place: PickedPlace) => void): void;
  /**
   * Called when the SCENE closes an opened building by itself — the camera left, or the viewer
   * clicked beside it. Without this the panel keeps offering rooms for a building that is no
   * longer open.
   */
  onBuildingClosed(handler: (() => void) | null): void;
  setLabelsVisible(visible: boolean): void;
  /** Attach the synthetic condition model to the buildings. Indexed by building. */
  setBuildingCondition(grade: ArrayLike<number>, renovationYear: ArrayLike<number>): void;
  /** Scrub the scenario year — a uniform, so it is free. */
  setBuildingConditionYear(year: number): void;
  /** Cross-fade the condition tint in and out, 0..1. */
  setBuildingConditionMix(mix: number): void;
  setDrapeVisible(visible: boolean): void;
  setVegetationVisible(visible: boolean): void;
  /** Free camera. No terrain collision — it is a camera, not a simulator. */
  /**
   * Force the camera into or out of drone mode. See `flyControls.ts`.
   *
   * Normally nobody calls this: pressing W A S D takes the camera and letting go gives it back a
   * couple of seconds later. It exists for anything that has to take the camera away.
   */
  setDroneMode(on: boolean): void;
  /** Whether the viewer currently has the camera. Flips on its own, so also see `onDroneMode`. */
  droneEngaged(): boolean;
  /** Subscribe to the latch, so the UI can follow a mode it did not switch. Null to unsubscribe. */
  onDroneMode(listener: ((engaged: boolean) => void) | null): void;
  droneTelemetry(): FlyTelemetry | null;
  dispose(): void;
}

export interface Campus3DOptions {
  onProgress?: ProgressReporter;
  labelHost?: HTMLElement;
}

/** How far the app's projection and the pipeline's may differ before it is a defect, in metres. */
const PROJECTION_TOLERANCE_M = 2;

/**
 * Estimate the GPU memory held by every distinct texture reachable from the scene.
 *
 * Deliberately an ESTIMATE. WebGL will not report what it allocated, and the driver may pad,
 * realign or compress; anything claiming to be the true figure would be inventing it. What this
 * does is arithmetic on the app's own textures — dimensions, channel count, bytes per channel and
 * the mipmap flag — which is enough to catch the failure that actually happens here: a drape
 * baked at 8192 px instead of 4096, which quadruples the largest allocation in the app.
 *
 * Textures are deduplicated by uuid because the terrain rasters are shared across materials, and
 * an unrecognised format is assumed to be the most expensive common case rather than quietly
 * under-reported — a budget that flatters itself is worse than no budget.
 */
function estimateTextureBytes(
  scene: THREE.Scene,
  extra: (THREE.Texture | null | undefined)[]
): number {
  const seen = new Set<string>();
  let total = 0;

  const add = (texture: THREE.Texture | null | undefined) => {
    if (!texture || seen.has(texture.uuid)) return;
    seen.add(texture.uuid);
    const image = texture.image as { width?: number; height?: number } | undefined;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (!width || !height) return;

    const channels =
      texture.format === THREE.RedFormat ? 1 : texture.format === THREE.RGFormat ? 2 : 4;
    const bytesPerChannel =
      texture.type === THREE.FloatType ? 4 : texture.type === THREE.HalfFloatType ? 2 : 1;
    // A full mipmap chain adds a third again on top of level 0.
    const mipmaps = texture.generateMipmaps ? 4 / 3 : 1;
    total += width * height * channels * bytesPerChannel * mipmaps;
  };

  for (const texture of extra) add(texture);

  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(entry as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) add(value);
      }
      const uniforms = (entry as THREE.ShaderMaterial).uniforms;
      if (!uniforms) continue;
      for (const uniform of Object.values(uniforms)) {
        if (uniform?.value instanceof THREE.Texture) add(uniform.value);
      }
    }
  });

  return Math.round(total);
}

/**
 * Fraction of the shorter core dimension over which land cover and drape fade at the boundary.
 *
 * 8 % leaves the photograph intact across the great majority of the AOI while still arriving at
 * the shell in the same colour. See the note at the call site for what happens when this is an
 * absolute value instead.
 */
const CORE_FADE_FRACTION = 0.08;

/**
 * How far back the camera sits when asked for one named place, in metres.
 *
 * Deliberately much closer than the opening shot. The opening frame is sized to the AOI because
 * its job is "here is the campus"; clicking a building is a different question, and answering it
 * with the same wide shot makes the click feel broken. At this range a faculty building fills a
 * useful part of the frame and its neighbours are still visible for context.
 */
const PLACE_RANGE_M = 550;

export async function initTwin3D(
  canvas: HTMLCanvasElement,
  aoi: AoiConfig,
  options: Campus3DOptions = {}
): Promise<Twin3DHandle> {
  // The renderer is created before the terrain loads so a WebGL context exists for the whole
  // load, and so a failure to get one surfaces before 13 MB of assets are fetched.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Without this the drawing buffer is cleared after presentation and readPixels always returns
    // zeroes, which makes anything drawn here impossible to assert on from an e2e test.
    preserveDrawingBuffer: true,
  });

  // ── Terrain, if it has been built ────────────────────────────────────────
  let assets: TerrainAssets | null = null;
  try {
    assets = await loadTerrain(aoi.id, '/terrain', options.onProgress);
  } catch (error) {
    if (!(error instanceof TerrainNotBuiltError)) throw error;
    console.info(`terrain not built for '${aoi.id}' — run: npm run data:build`);
  }

  const hasTerrain = assets !== null;
  const terrain = assets?.terrain ?? null;

  /**
   * ONE frame for every layer: the terrain grid's, once it exists.
   *
   * ⚠️ The terrain, the buildings and the baked 3D-Mesh are centred on the generated heightmap
   * (origin snapped to whole metres, width x resolution), while `worldExtent(bbox)` is the exact UTM
   * envelope of the config box. The two sat ~0.3–1 m apart, so anything placed through `toWorld`
   * (pharmacies, tours, vehicles) drifted against the mesh (found 2026-10-17).
   */
  const ext: WorldExtent = terrain
    ? {
        minEasting: terrain.origin.easting,
        maxNorthing: terrain.origin.northing + terrain.height * terrain.resolutionM,
        widthM: terrain.width * terrain.resolutionM,
        depthM: terrain.height * terrain.resolutionM,
      }
    : worldExtent(aoi.bbox);

  // World units are metres, with the terrain centred on the origin. When there is no terrain the
  // AOI bbox stands in for it, which is why both paths agree on scale.
  const widthM = terrain ? terrain.width * terrain.resolutionM : ext.widthM;
  const depthM = terrain ? terrain.height * terrain.resolutionM : ext.depthM;
  const groundM = terrain ? terrain.heightMinM : aoi.elevationRangeM.min;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(SKY_COLOUR, 1);

  const scene = new THREE.Scene();

  const sky: Sky = createSky();
  /** Held so the night can reach the horizon as well as the ground. Null before terrain loads. */
  let shellNightMaterial: THREE.ShaderMaterial | null = null;
  scene.add(sky.mesh);

  // ── Camera ───────────────────────────────────────────────────────────────
  // Near plane at 5 m rather than the Alpine app's 20 m: this camera is expected to come down
  // between buildings, and Phase 3 will take it inside one.
  const camera = new THREE.PerspectiveCamera(42, 1, 5, 80000);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.7;
  controls.rotateSpeed = 0.55;
  controls.minDistance = 40;
  controls.maxDistance = 12000;
  // Stop just short of the horizon so the camera cannot drop below the ground and look up through
  // it, which reads as a rendering fault rather than as a viewpoint.
  controls.maxPolarAngle = Math.PI * 0.48;

  const defaultRangeM = Math.max(widthM, depthM) * 0.75;

  // ── Where the places are ─────────────────────────────────────────────────
  /**
   * Once the terrain exists its metadata is authoritative: the pipeline resolved each place, put
   * it on the grid and sampled the ground under it, so `u`, `v` and `groundM` already encode the
   * answer. Before that, the app projects the config coordinates itself.
   */
  const worldFromMeta = (u: number, v: number, ground: number) =>
    new THREE.Vector3((u - 0.5) * widthM, ground, (v - 0.5) * depthM);

  const worldFor = (place: AoiFocusPlace): THREE.Vector3 => {
    const measured = terrain?.focusPlaces.find((p) => p.id === place.id);
    if (measured) return worldFromMeta(measured.u, measured.v, measured.groundM);
    const p = placeToWorld(place, ext, groundM);
    return new THREE.Vector3(p.x, p.y, p.z);
  };

  /**
   * ⚠️ The app and the pipeline must project identically.
   *
   * `src/geo/utm.ts` is a hand port of `tools/geodata/utm.py`. If the two ever drift, nothing
   * throws — the campus simply renders a few metres from where the survey put it, and every layer
   * built on top inherits the error silently. Comparing them here, against real data, is the
   * cheapest moment to notice.
   */
  if (terrain) {
    let worst = 0;
    let worstId = '';
    for (const place of aoi.focusPlaces) {
      const measured = terrain.focusPlaces.find((p) => p.id === place.id);
      if (!measured) continue;
      const fromMeta = worldFromMeta(measured.u, measured.v, measured.groundM);
      const fromConfig = placeToWorld(place, ext, measured.groundM);
      const drift = Math.hypot(fromMeta.x - fromConfig.x, fromMeta.z - fromConfig.z);
      if (drift > worst) {
        worst = drift;
        worstId = place.id;
      }
    }
    if (worst > PROJECTION_TOLERANCE_M) {
      console.warn(
        `projection drift: '${worstId}' differs by ${worst.toFixed(1)} m between the app and the ` +
          `pipeline — src/geo/utm.ts and tools/geodata/utm.py have diverged`
      );
    } else {
      console.info(`projection agrees with the pipeline to ${worst.toFixed(2)} m`);
    }
  }

  // ── Ground ───────────────────────────────────────────────────────────────
  const disposables: { dispose(): void }[] = [];
  let terrainMesh: THREE.Mesh | null = null;
  let shellMeshRef: THREE.Mesh | null = null;
  let placeholder: THREE.Group | null = null;

  if (assets && terrain) {
    /**
     * How wide the land-cover and drape fade should be at the core boundary.
     *
     * ⚠️ **This must scale with the AOI, and it used not to.** The shader fades both the land
     * cover and the orthophoto out over `transitionBandM` so the core does not meet the coarse
     * shell as a hard change of colour. That value is also the pipeline's seam-measurement ring,
     * where 900 m is a sensible width — but as a *fade* it is a fraction of the core, and the
     * Alpine AOI this came from was 9.4 km wide, so 900 m was about a tenth of it.
     *
     * Garching's core is 2 088 m on its short side. Reusing 900 m there meant the fade reached
     * 43 % of the way in from every edge, the two fades met in the middle, and the drape survived
     * only as a dark lozenge in the centre of the campus with hypsometric green all around it. It
     * looked like a rendering fault and it was really a units-versus-proportion mistake.
     *
     * So the band is capped at a fraction of the smaller core dimension. An absolute metre value
     * copied between AOIs of different sizes cannot be right for both.
     */
    const fadeBandM = Math.min(
      assets.shell?.transitionBandM ?? 0,
      Math.min(widthM, depthM) * CORE_FADE_FRACTION
    );

    const material = createTerrainMaterial({
      ...assets,
      transitionBandM: fadeBandM,
    });

    // Anisotropy is applied inside the loader, before the drape's first upload. Setting it here
    // instead re-flagged `needsUpdate` and forced a second upload from an ImageBitmap the first
    // one had consumed, leaving a mipmap-incomplete texture that sampled black. See `loadDrape`.

    // One vertex per grid cell would be 1.3 million. A 2x decimation keeps the landform honest at
    // 4 m posting — finer than the Alpine app's 16 m, because this AOI covers a sixteenth of the
    // area and the camera gets far closer to the ground.
    const geometry = new THREE.PlaneGeometry(
      widthM,
      depthM,
      Math.floor(terrain.width / 2),
      Math.floor(terrain.height / 2)
    );
    geometry.rotateX(-Math.PI / 2);

    terrainMesh = new THREE.Mesh(geometry, material);
    scene.add(terrainMesh);
    disposables.push(geometry, material);

    // ── The horizon ────────────────────────────────────────────────────────
    // Garching has no dramatic horizon to show, so the shell is not here for spectacle — it is
    // here so the photoreal square does not end in a cliff of nothing.
    const { shell, shellTexture } = assets;
    if (shell && shellTexture) {
      const shellWidthM = shell.width * shell.resolutionM;
      const shellDepthM = shell.height * shell.resolutionM;

      const coreCentreE = terrain.origin.easting + widthM / 2;
      const coreCentreN = terrain.origin.northing + depthM / 2;
      const shellCentreE = shell.origin.easting + shellWidthM / 2;
      const shellCentreN = shell.origin.northing + shellDepthM / 2;

      const shellGeometry = new THREE.PlaneGeometry(
        shellWidthM,
        shellDepthM,
        Math.floor(shell.width / 3),
        Math.floor(shell.height / 3)
      );
      shellGeometry.rotateX(-Math.PI / 2);

      const shellMaterial = createShellMaterial({
        shell,
        shellTexture,
        core: terrain,
        coreTexture: assets.heightTexture,
        // Northing increases north but +Z is south, so the z minimum is the core's NORTH edge —
        // getting this backwards puts the hole in the shell on the wrong side of the map.
        coreRect: [-widthM / 2, -depthM / 2, widthM, depthM],
        // Deliberately the CORE's elevation range: the two tiers must share a colour ramp or the
        // boundary shows up as a change of palette.
        elevationRangeM: { min: terrain.heightMinM, max: terrain.heightMaxM },
      });

      const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
      shellMeshRef = shellMesh;
      shellMesh.position.set(shellCentreE - coreCentreE, 0, -(shellCentreN - coreCentreN));
      shellMesh.frustumCulled = false;
      scene.add(shellMesh);
      shellNightMaterial = shellMaterial;
      disposables.push(shellGeometry, shellMaterial);
      console.info(
        `shell: ${shell.width}x${shell.height} at ${shell.resolutionM} m, ` +
          `seam offset ${shell.seamOffsetM.toFixed(2)} m`
      );
    }
  } else {
    // Scaffolding, and deliberately drab: making it attractive would only make it harder to tell
    // whether the real terrain had loaded.
    placeholder = new THREE.Group();
    const sunDirection = new THREE.Vector3(...SUN_DIRECTION).normalize();
    const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_TINT), 1);
    sun.position.copy(sunDirection).multiplyScalar(4000);
    placeholder.add(sun);
    placeholder.add(
      new THREE.HemisphereLight(
        new THREE.Color(...SUN_TINT),
        new THREE.Color(...SHADOW_TINT),
        AMBIENT
      )
    );

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(widthM, depthM),
      new THREE.MeshLambertMaterial({ color: 0x9aa596 })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = groundM;
    placeholder.add(plane);
    disposables.push(plane.geometry, plane.material as THREE.Material);

    const gridSize = Math.max(widthM, depthM);
    const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 100), 0x6b7280, 0xb8c0b2);
    // GridHelper is always square, but an AOI rarely is. Scaling it onto the plane keeps the grid
    // from overhanging the ground, which otherwise reads as a rendering fault.
    grid.scale.set(widthM / gridSize, 1, depthM / gridSize);
    grid.position.y = groundM + 0.5;
    placeholder.add(grid);
    disposables.push(grid);

    scene.add(placeholder);
  }

  // ── Buildings ────────────────────────────────────────────────────────────
  // On flat ground these carry the scene. The app still runs without them, which keeps a fresh
  // clone usable before the mesh has been built.
  let buildings: BuildingLayer | null = null;
  if (hasTerrain) {
    try {
      buildings = await loadBuildings(aoi.id, '/terrain', options.onProgress);
      scene.add(buildings.mesh);
      console.info(`LoD2: ${buildings.meta.count} buildings`);
    } catch {
      console.info('LoD2 buildings not available — run tools/geodata/build_lod2_mesh.py');
    }
  }

  // ── Vegetation ───────────────────────────────────────────────────────────
  let vegetation: VegetationLayer | null = null;
  if (hasTerrain) {
    try {
      vegetation = await loadVegetation(aoi.id, '/terrain', options.onProgress);
      if (vegetation) {
        scene.add(vegetation.group);
        console.info(`vegetation: ${vegetation.drawn} trees in ${vegetation.chunks} chunks`);
      }
    } catch {
      console.info('vegetation not available: run tools/geodata/build_vegetation_ndom.py');
    }
  }

  // ── Water ────────────────────────────────────────────────
  // Absent at Garching and central to Tübingen, so its absence is not an error either.
  let water: WaterLayer | null = null;
  if (hasTerrain) {
    try {
      water = await loadWater(
        aoi.id,
        '/terrain',
        new THREE.Vector3(...SUN_DIRECTION),
        new THREE.Color(SKY_COLOUR)
      );
      if (water) {
        scene.add(water.mesh);
        const hectares = water.meta.bodies.reduce((sum, b) => sum + b.areaM2, 0) / 1e4;
        console.info(
          `water: ${water.meta.bodyCount} bodies, ${hectares.toFixed(1)} ha, ` +
            `surface ${water.meta.bodies[0]?.levelM.toFixed(2)} m`
        );
      }
    } catch {
      console.info('water not available — run tools/geodata/build_water.py');
    }
  }

  // ── Photoreal core (NRW 3D-Mesh) ─────────────────────────────────────────
  // Loaded after the layers it replaces, so switching it off has something to fall back to.
  let meshCore: MeshCoreLayer | null = null;
  let meshShown = false;
  const applyMeshVisibility = (visible: boolean) => {
    meshShown = Boolean(meshCore) && visible;
    if (meshCore) meshCore.group.visible = meshShown;
    if (terrainMesh) terrainMesh.visible = !meshShown;
    if (buildings) buildings.mesh.visible = !meshShown;
    if (water) water.mesh.visible = !meshShown;
    if (vegetation) vegetation.group.visible = !meshShown;
    // The ring tier covers the whole shell box, so the coarse 30 m shell would only z-fight it.
    if (shellMeshRef && meshCore?.manifest.ring) shellMeshRef.visible = !meshShown;
  };
  if (hasTerrain) {
    try {
      meshCore = await loadMeshCore(aoi.id, '/terrain', renderer);
      scene.add(meshCore.group);
      disposables.push(meshCore);
      applyMeshVisibility(true);
      console.info(
        `mesh: ${meshCore.loaded}/${meshCore.manifest.totals.tiles} tiles, ` +
          `${meshCore.manifest.totals.vertices} vertices, ` +
          `${(meshCore.manifest.totals.texels / 1e6).toFixed(1)} Mtexel`
      );
    } catch (error) {
      if (!(error instanceof MeshNotBuiltError)) throw error;
      console.info('3D-Mesh not baked — run tools/geodata/bake_nrw_mesh.py');
    }
  }

  // ── Rooms ────────────────────────────────────────────────────────
  // Only some sites have any. Their absence is a property of the place — Tübingen has three
  // mapped indoor rooms in total — rather than something to be worked around.
  let rooms: RoomLayer | null = null;
  if (hasTerrain && aoi.rooms) {
    try {
      rooms = await loadRooms(aoi.id, '/terrain');
      if (rooms) {
        scene.add(rooms.group);
        console.info(
          `rooms: ${rooms.distinct.rooms} in ${rooms.meta.buildings} buildings ` +
            `(${rooms.meta.count} polygons), ` +
            `${rooms.meta.withUsage} with a usage type, ` +
            `${rooms.distinct.withOccupancy} with a calendar ` +
            `(${rooms.distinct.neverBooked} never booked)`
        );
      }
    } catch {
      console.info('rooms not available (this AOI models no room interiors)');
    }
  }

  // ── Camera moves ─────────────────────────────────────────────────────────
  let flightFrom: THREE.Vector3 | null = null;
  let flightTo: THREE.Vector3 | null = null;
  let flightTargetFrom: THREE.Vector3 | null = null;
  let flightTargetTo: THREE.Vector3 | null = null;
  let flightStart = 0;
  const FLIGHT_MS = 1400;

  /**
   * Does this viewer want motion kept to a minimum?
   *
   * ⚠️ Queried LIVE on every frame rather than captured at init. Reading it once means flipping the
   * OS setting (or emulating it in a test) does nothing until a reload, which looks exactly like
   * the feature not working. `matchMedia` is cheap; a stale accessibility setting is not.
   *
   * The rule this app follows: journeys ARRIVE instantly rather than being skipped, and loops are
   * HELD rather than hidden. The destination is the information; the travel is decoration.
   */
  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const places = aoi.focusPlaces;

  const frame = (placeId: string, rangeM = defaultRangeM, animate = true) => {
    const place = places.find((p) => p.id === placeId) ?? places[0];
    if (!place) return;
    const target = worldFor(place);
    // Look in from the south-east and above, so the north-west sun keeps lit faces towards the
    // camera and shaded ones reading as depth.
    const position = new THREE.Vector3(
      target.x + rangeM * 0.45,
      target.y + rangeM * 0.8,
      target.z + rangeM * 0.65
    );
    if (!animate) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
      return;
    }
    flightFrom = camera.position.clone();
    flightTo = position;
    flightTargetFrom = controls.target.clone();
    flightTargetTo = target;
    flightStart = performance.now();
  };

  // ── Labels ───────────────────────────────────────────────────────────────
  /**
   * What a focus place is called on the map right now.
   *
   * ⚠️ ONE FUNCTION FOR BOTH THE INITIAL BUILD AND THE RE-TEXT, BECAUSE THE TWO DRIFTED APART AND
   * SHIPPED. They were separate expressions computing the same thing; a later commit reverted the
   * anchor half back to the raw AOI name and left the re-text half branded, so the DEPLOYED map
   * read "Zentrallager" beside a panel reading "<operator> Zentrallager", and pressing the brand
   * switch twice was what finally branded the map. Two copies of one rule is what made that
   * possible; there is now one.
   *
   * The OSM name as it is (German for German buildings): the label layer is built once rather than
   * rebuilt per locale.
   */
  const labelTextFor = (place: AoiFocusPlace): string =>
    placeName(place.id, { en: place.name }).en;

  const anchors: LabelAnchor[] = places.map((place) => ({
    id: place.id,
    text: labelTextFor(place),
    position: worldFor(place),
    kind: place.kind === 'station' ? 'station' : 'place',
  }));
  const labels: LabelLayer = createLabelLayer(anchors);
  options.labelHost?.appendChild(labels.element);

  /*
   * The map has to follow the brand switch too.
   *
   * ⚠️ THE LABELS ARE THE PART THAT WOULD HAVE BEEN MISSED. The header and the place list are
   * React and re-render on their own; these names are DOM nodes written once at scene creation, so
   * switching the operator's names off would have cleared them everywhere EXCEPT the map — leaving
   * the customer's name on the thing the audience is actually looking at. Only the focus places
   * carry brand overrides; pharmacy names are OpenStreetMap data and are left alone.
   */
  const unsubscribeBrand = subscribeBrand(() => {
    labels.retext((anchor) => {
      const place = places.find((p) => p.id === anchor.id);
      if (!place) return anchor.text;
      return labelTextFor(place);
    });
  });

  /**
   * How close a named place has to be to a building's rooms before clicking the name opens it.
   *
   * The focus places are OSM points on the building they name, and the room centroids are the same
   * building's interior, so a genuine match is tens of metres.
   */
  const LABEL_MATCH_M = 90;

  /**
   * Place ids that name a whole SITE rather than a building.
   *
   * ⚠️ PROXIMITY ALONE GETS THIS WRONG, and clicking through every label proved it: "Campus
   * Prüfeninger Straße" and "LMU Klinikum Campus Innenstadt" each sit within 90 m of some building,
   * so a nearest-building rule opened one arbitrary building and presented it as the campus. The
   * config already draws the distinction — `campuses[]` lists the sites by id — so this asks the
   * data rather than guessing from distance.
   */
  const sitePlaceIds = new Set((aoi.campuses ?? []).map((area) => area.id));

  /**
   * The focus place that IS the modelled hall, or null.
   *
   * ⚠️ MATCHED ON THE OSM ID, NOT ON THE NAME OR ON DISTANCE. `site3d.heroBuilding` names the
   * building the interior was modelled from, and exactly one focus place carries that same id, so
   * the config already answers the question and nothing here has to guess. Matching by proximity
   * would work today and pick the wrong one as soon as a second site building is listed within
   * a hundred metres, and matching a display name would stop working as soon as it is translated.
   */
  const hallPlaceId =
    aoi.site3d?.heroBuilding != null
      ? (places.find((p) => p.osm === aoi.site3d?.heroBuilding)?.id ?? null)
      : null;

  /**
   * Clicking a name does the most useful thing that name can do.
   *
   * ⚠️ Until now it did NOTHING, which is the worst of the options: the labels are the most
   * obviously clickable thing on the map. There are three honest outcomes and they depend on the
   * data, not on the label:
   *
   *   * the place IS the modelled hall       → open it, exactly as the panel button does
   *   * the place IS a building with rooms   → open it, exactly as clicking the building does
   *   * a campus, or a building with no rooms → fly to it and say so
   *
   * Guessing a building for the last case would open an empty shell and imply a floor plan that
   * does not exist.
   */
  const buildingNearPlace = (place: AoiFocusPlace): string | null => {
    if (!rooms || sitePlaceIds.has(place.id)) return null;
    const here = worldFor(place);
    let best: string | null = null;
    let bestDistance = LABEL_MATCH_M;
    for (const building of rooms.buildings) {
      const distance = Math.hypot(building.centre.x - here.x, building.centre.z - here.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = building.code;
      }
    }
    return best;
  };

  const selectPlace = (placeId: string) => {
    const place = places.find((p) => p.id === placeId);
    if (!place) return;

    // The hall is the subject of this app; naming it and then only flying past it would be an odd
    // thing for the map to do.
    if (placeId === hallPlaceId && dcInterior) {
      labels.setActive(placeId);
      openHall(true);
      return;
    }

    const code = buildingNearPlace(place);
    if (code) {
      // Same route as clicking the building itself, so the two ways in cannot drift apart.
      labels.setActive(null);
      buildingPickedHandler?.(code);
      return;
    }

    // Not something that can be opened: go and look at it, and let the panel explain.
    frame(placeId, PLACE_RANGE_M);
    labels.setActive(placeId);
    placePickedHandler?.({
      id: place.id,
      name: place.name,
      source: place.source ?? '',
      kind: sitePlaceIds.has(place.id) ? 'site' : 'unmodelled',
    });
  };

  labels.onSelect(selectPlace);

  // ── Opening a building up ────────────────────────────────────────────────
  /**
   * The explode is animated here rather than in the room shader's own clock, because the camera
   * move and the shell fade have to happen on the same curve. A building that opens while the
   * camera is still arriving reads as two unrelated animations.
   */
  let explodedCode: string | null = null;
  let explodeT = 0;
  let explodeTarget = 0;
  const EXPLODE_MS = 1200;

  /**
   * Where the chase camera sits relative to the van it is following, in metres.
   *
   * ⚠️ THESE WERE SET WHILE THE VAN WAS A 240 m BOX, and they are the reason it looked right. At
   * 340 m back the box filled a useful part of the frame; a real 6 m van at the same distance is
   * about twenty pixels — a speck on a dark street. Modelling the vehicle properly is pointless if
   * the camera stays where it was parked for a slab four times the length of the warehouse.
   *
   * Close enough that the van is legibly a van, far enough back that it sits IN the city rather
   * than filling the frame: the point of riding along is watching it work through the streets.
   */
  // ⚠️ A DRONE, NOT A CHASE CAR (Cologne, measured 2026-10-17). The photogrammetric mesh is
  // photoreal from above and blobby at street level everywhere except the two 0.25/0.5 m detail
  // spots; the engine's 48 m / 22 m chase view put the camera among smeared facades. From ~300 m
  // back and 220 m up the same mesh reads as the city it is (150/120 was still blobby at the 1.6 m
  // level). The vehicle itself stays 1:1; its glow is the locator at this range.
  const FOLLOW_BEHIND_M = 300;
  const FOLLOW_ABOVE_M = 220;

  /**
   * Leaving an opened building closes it.
   *
   * Until now the ONLY way out was the collapse button in the sidebar — the wrong place to look
   * when the thing you want to dismiss is in the scene. The sibling repo took the same complaint
   * twice ("closing the exploded view is somewhat complicated", then "still not closing if I click
   * next to the buildings").
   *
   * ⚠️ IT MUST ARM BEFORE IT CAN FIRE. Opening flies the camera IN from far outside the close
   * distance, so a plain "am I far away" test closes every building on the very frame it opens.
   * The viewer has to arrive first (within `explodeArmRange`); only then does leaving
   * `explodeCloseRange` count. The gap between the two is hysteresis, so orbiting the building
   * does not dismiss it.
   */
  let explodeCentre: THREE.Vector3 | null = null;
  let explodeArmRange = 0;
  let explodeCloseRange = 0;
  let explodeArmed = false;

  let roomPickedHandler: ((room: RoomView | null) => void) | null = null;
  let buildingPickedHandler: ((code: string) => void) | null = null;
  /**
   * The scene closing a building on its own has to reach the panel, or the sidebar keeps offering
   * rooms for a building that is no longer open.
   */
  let buildingClosedHandler: (() => void) | null = null;
  /**
   * A named place on the map that is NOT a building this dataset can open.
   *
   * The campus outlines ("OTH Regensburg", "Campus Prüfeninger Straße") and the buildings no
   * timetable puts a lecture in have no rooms to show, and pretending otherwise would open an
   * empty shell. The panel says what the place is instead.
   */
  let placePickedHandler: ((place: PickedPlace) => void) | null = null;

  /** Invisible volumes, one per building, so a closed building can still be clicked. */
  const pickVolumes: THREE.Mesh[] = [];
  if (rooms) {
    const bounds = new Map<string, { box: THREE.Box3 }>();
    for (const view of rooms.rooms) {
      const entry = bounds.get(view.building) ?? { box: new THREE.Box3() };
      if (!bounds.has(view.building)) {
        entry.box.makeEmpty();
        bounds.set(view.building, entry);
      }
      entry.box.expandByPoint(
        new THREE.Vector3(view.centre.x, view.baseM, view.centre.z)
      );
      entry.box.expandByPoint(
        new THREE.Vector3(view.centre.x, view.baseM + view.heightM, view.centre.z)
      );
    }
    for (const [code, { box }] of bounds) {
      // Room centroids only bound the middle of the footprint, so the volume is padded outwards
      // to cover the walls the viewer will actually aim at.
      box.expandByScalar(12);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const volume = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, Math.max(size.y, 12), size.z),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      volume.position.copy(centre);
      volume.userData.building = code;
      volume.visible = false;
      pickVolumes.push(volume);
      scene.add(volume);
      disposables.push(volume.geometry, volume.material as THREE.Material);
    }
  }

  /**
   * Move the camera to look at a world point.
   *
   * `elevation` is the fraction of the offset that is vertical. The default 0.72 is a high,
   * map-like view that suits a campus overview. The exploded view needs the opposite: stacked
   * floors only read as stacked from a LOW angle, because a near-vertical camera projects a 70 m
   * vertical spread onto almost nothing. That is not a hypothesis — the first working explode was
   * mistaken for a broken one because it was framed from 45° and looked flat.
   */
  const flyToPoint = (target: THREE.Vector3, rangeM: number, elevation = 0.72) => {
    const horizontal = Math.sqrt(Math.max(1 - elevation * elevation, 0.05));
    flightFrom = camera.position.clone();
    flightTo = new THREE.Vector3(
      target.x + rangeM * horizontal * 0.6,
      target.y + rangeM * elevation,
      target.z + rangeM * horizontal * 0.8
    );
    flightTargetFrom = controls.target.clone();
    flightTargetTo = target.clone();
    flightStart = performance.now();
  };

  /**
   * Fly back to a camera pose that was recorded earlier.
   *
   * Separate from `flyToPoint` because a saved view is a POSITION AND A TARGET, not a point plus a
   * range: recomputing the position from the target would land somewhere near where the viewer was
   * rather than where they were, and "somewhere near" is exactly what makes a return feel wrong.
   */
  const flyToPose = (pose: { position: THREE.Vector3; target: THREE.Vector3 }) => {
    flightFrom = camera.position.clone();
    flightTo = pose.position.clone();
    flightTargetFrom = controls.target.clone();
    flightTargetTo = pose.target.clone();
    flightStart = performance.now();
  };

  /**
   * Where the camera was before it dived into a building.
   *
   * ⚠️ Clicking beside an open building used to close the floors and LEAVE THE CAMERA INSIDE, so
   * dismissing it stranded the viewer in a close, low shot of nothing in particular with no way
   * back except flying out by hand. Putting a building away should undo the whole act of opening
   * it, camera included.
   */
  let viewBeforeExplode: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  const explodeBuilding = (code: string | null, restoreView = true) => {
    if (!rooms) return;
    if (code === null) {
      explodeTarget = 0;
      explodeCentre = null;
      explodeArmed = false;
      rooms.setSelected(null);

      // ⚠️ `restoreView` is FALSE when the building closed because the viewer flew away from it.
      // Pulling the camera back to the overview then would fight the very movement that dismissed
      // it — they are already somewhere they chose to be.
      if (restoreView && viewBeforeExplode) flyToPose(viewBeforeExplode);
      viewBeforeExplode = null;
      return;
    }
    const building = rooms.buildings.find((b) => b.code === code);
    if (!building) return;

    // ⚠️ Recorded BEFORE the dive, and only on the way in from a closed state. Opening a second
    // building directly from the first must not overwrite the overview with the first building's
    // close-up, or backing out lands on the building you just left instead of the campus.
    if (!explodedCode) {
      viewBeforeExplode = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
    }

    explodedCode = code;
    explodeTarget = 1;
    rooms.setExplode(code, explodeT);
    rooms.setSelected(null);

    // Size the shot to the building rather than to a constant. These wings differ by an order of
    // magnitude — 7 rooms in Galileo against 395 in one MW wing — so one range cannot suit both.
    const own = rooms.rooms.filter((r) => r.building === code);
    let radius = 40;
    let lowest = Infinity;
    let highest = -Infinity;
    for (const room of own) {
      radius = Math.max(
        radius,
        Math.hypot(room.centre.x - building.centre.x, room.centre.z - building.centre.z)
      );
      // ⚠️ WHERE THE FLOOR ENDS UP, not where it starts. The shader lifts each room by its own
      // LEVEL NUMBER times the gap, so a building with levels -1..3 opens 26 m below its ground
      // floor and 78 m above it — and its middle is nowhere near `centre.y + spread * 0.45`,
      // which is the guess this replaces. That guess aimed 19 m too high at TUM's 5506 and left
      // the lowest floor outside the frame.
      const base = room.baseM + room.level * EXPLODE_GAP_M;
      lowest = Math.min(lowest, base);
      highest = Math.max(highest, base + room.heightM);
    }

    // Look at the middle of the OPENED stack, measured rather than assumed.
    const centre = building.centre.clone();
    if (Number.isFinite(lowest) && Number.isFinite(highest)) {
      centre.y = (lowest + highest) / 2;
    }

    /**
     * ⚠️ THE SHOT IS FITTED TO THE OPENED BUILDING AND TO THE WINDOW, not to a constant.
     *
     * The old range was `max(radius * 1.5, spread * 1.6, 190)`, which is a guess with neither the
     * building's own height nor the viewport in it. Measured on TUM's `5506` — 395 rooms over five
     * levels — it framed the shot at 190 m and **7 % of the opened building's room corners landed
     * off screen**: the upper floors flew out of the top of the frame and the wing ran out of the
     * sides. An explode you cannot see all of reads as no explode at all, which is exactly how it
     * was reported.
     *
     * Fitting is arithmetic, not taste: half the vertical extent over `tan(fov/2)`, half the
     * horizontal extent over the same times the aspect ratio, whichever is the tighter axis. The
     * aspect term matters more than it looks — in a TALL window the horizontal axis is the tight
     * one and in a wide window the vertical is, so a formula that ignores it is wrong by the shape
     * of the browser window rather than by a constant.
     */
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    const tanX = tanY * Math.max(camera.aspect, 0.4);
    const halfVertical = Number.isFinite(highest) ? (highest - lowest) / 2 : EXPLODE_GAP_M;
    // The margin is not padding for taste: `radius` reaches room CENTRES, and a room is a polygon
    // around its centre, so the true extent is larger than anything measured above by half a room.
    const range = Math.max(radius / tanX, halfVertical / tanY, 190) * 1.2;
    // Low and close: stacked floors only read as stacked from a shallow angle.
    flyToPoint(centre, range, 0.32);

    // Distances for the leave-to-close behaviour below, derived from the shot that was just
    // framed rather than from a constant, because these buildings differ by an order of magnitude.
    explodeCentre = building.centre.clone();
    explodeArmRange = range * 1.35;
    explodeCloseRange = range * 2.6;
    explodeArmed = false;
  };

  // ── Pointer ──────────────────────────────────────────────────────────────

  /** Put the opened building away AND tell the panel, so the two never disagree. */
  const closeExploded = (restoreView = true) => {
    if (!explodedCode) return;
    explodeBuilding(null, restoreView);
    buildingClosedHandler?.();
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownAt = { x: 0, y: 0, t: 0 };
  const onPointerDown = (event: PointerEvent) => {
    pointerDownAt = { x: event.clientX, y: event.clientY, t: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    // Orbiting is a drag, not a click. Without this every camera move ends in a selection.
    const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
    if (moved > 5 || performance.now() - pointerDownAt.t > 600) return;
    if (!rooms) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (explodedCode && explodeT > 0.2) {
      /**
       * ⚠️ THREE outcomes, not two.
       *
       * This used to select-or-deselect a room and return unconditionally, which meant a click on
       * empty ground cleared the selection and left the building open — the user's actual
       * complaint. It also swallowed clicks on OTHER buildings, so the only way to reach a
       * neighbour was to close this one first.
       *
       * The pick volume test has to stay: without it, clicking the building you are already
       * inside would dismiss it.
       */
      const room = rooms.pick(raycaster);
      if (room) {
        rooms.setSelected(room.index);
        roomPickedHandler?.(room);
        return;
      }

      const elsewhere = raycaster.intersectObjects(pickVolumes, false);
      const otherCode = elsewhere[0]?.object.userData.building as string | undefined;
      if (otherCode && otherCode !== explodedCode) {
        buildingPickedHandler?.(otherCode);
        return;
      }
      if (otherCode === explodedCode) {
        // Inside the building's own footprint but not on a room — a miss, not a dismissal.
        rooms.setSelected(null);
        roomPickedHandler?.(null);
        return;
      }

      // Neither a room nor any building: clicking beside it means "put this away".
      rooms.setSelected(null);
      roomPickedHandler?.(null);
      closeExploded();
      return;
    }

    const hits = raycaster.intersectObjects(pickVolumes, false);
    const code = hits[0]?.object.userData.building as string | undefined;
    if (code) buildingPickedHandler?.(code);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  // ── Drone mode ───────────────────────────────────────────────────────────
  /**
   * Terrain elevation under a world position, in real metres.
   *
   * Reads the same array the shader samples rather than raycasting the mesh: the mesh is a
   * displaced plane whose displacement *is* this array, so a raycast would be a slower way of
   * asking the same question. Nearest-neighbour, matching the shader — interpolating measured
   * data would invent elevations the survey never recorded.
   */
  const heightData = assets ? (assets.heightTexture.image.data as Uint16Array) : null;
  const groundAt = (x: number, z: number): number | null => {
    if (!heightData || !terrain) return groundM;
    const u = x / widthM + 0.5;
    const v = z / depthM + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const col = Math.min(terrain.width - 1, Math.round(u * (terrain.width - 1)));
    const row = Math.min(terrain.height - 1, Math.round(v * (terrain.height - 1)));
    return terrain.heightMinM + heightData[row * terrain.width + col] * terrain.heightScale;
  };

  /**
   * Ground elevation ANYWHERE in the shell, not just inside the 2 km photoreal core.
   *
   * ⚠️ THE CORE IS 2 km ACROSS AND THE DELIVERY REGION IS 44 km ACROSS. `groundAt` above returns
   * null outside the core — correct, because it has no data there — so anything drawn across the
   * region (the tours, the pharmacies they serve) would have had to invent an elevation. A flat
   * constant was the obvious shortcut and would have been wrong by up to ~58 m: the shell spans
   * 80–152 m, so drops in the Odenwald foothills to the east would have been buried and the tours
   * serving them would have run underground.
   *
   * The shell is a MEASURED Copernicus surface at ~90 m posting, already loaded and already on the
   * core's vertical datum (its seam offset was measured, not assumed). Coarse, but measured beats
   * invented, and at 90 m posting it is far finer than the error a constant would introduce.
   */
  const shellData = assets?.shellTexture
    ? (assets.shellTexture.image.data as Uint16Array)
    : null;
  const shellMeta = assets?.shell ?? null;
  const groundAnywhere = (x: number, z: number): number => {
    const core = groundAt(x, z);
    if (core !== null) return core;
    if (!shellData || !shellMeta) return groundM;

    // world -> UTM. `ext` is the CORE rectangle; the shell carries its own origin.
    const easting = x + ext.minEasting + ext.widthM / 2;
    const northing = ext.maxNorthing - ext.depthM / 2 - z;
    const res = shellMeta.resolutionM;
    const topN = shellMeta.origin.northing + shellMeta.height * res;
    const col = Math.round((easting - shellMeta.origin.easting) / res - 0.5);
    const row = Math.round((topN - northing) / res - 0.5);
    if (col < 0 || row < 0 || col >= shellMeta.width || row >= shellMeta.height) return groundM;
    return shellMeta.heightMinM + shellData[row * shellMeta.width + col] * shellMeta.heightScale;
  };

  let droneListener: ((engaged: boolean) => void) | null = null;
  const drone: FlyControls = createFlyControls({
    camera,
    domElement: renderer.domElement,
    controls,
    groundAt,
    // The campus is a few kilometres across with buildings to read at walking pace, so the range
    // has to reach from a corridor to the far side of the site.
    cruiseMinMs: 25,
    cruiseMaxMs: 900,
    cruiseDefaultMs: 180,
    boost: 3,
    // ⚠️ This camera has always had mass and a stabilised gimbal, and losing them in the merge
    // would have been a silent change to how the whole app feels.
    accelerateTauS: 0.28,
    brakeTauS: 0.16,
    lookTauS: 0.07,
    onEngagedChange: (engaged) => {
      // A camera flight in progress owns the camera too, and would fight the keys for it.
      if (engaged) flightFrom = flightTo = flightTargetFrom = flightTargetTo = null;
      droneListener?.(engaged);
    },
  });

  // ── Campus Flow ──────────────────────────────────────────────────────────
  // Loaded here rather than with the other layers because the ribbons have to sit ON the terrain,
  // and `groundAt` is what tells them where that is.
  let flows: FlowLayer | null = null;
  if (hasTerrain) {
    try {
      flows = await loadFlows(aoi.id, '/terrain', groundAt);
      if (flows) {
        scene.add(flows.mesh);
        console.info(
          `flow: ${flows.meta.edgeCount} edges, ${flows.meta.transitions} routed transitions ` +
            `from ${flows.meta.courses} courses`
        );
      }
    } catch {
      console.info('flow not available (this AOI has no pedestrian flow layer)');
    }
  }

  // ── The walk between two rooms ────────────────────────────────────────────────
  // Empty until something asks for a route. It needs the terrain for the same reason the flow layer
  // does: a line drawn at a constant height crosses the Galgenberg embankment in mid-air.
  const walkRoute: WalkRouteLayer = createWalkRouteLayer(ext, groundAt);
  scene.add(walkRoute.group);

  // ── The distribution centre's interior ───────────────────────────────────
  // Loaded here, after `groundAt` exists, for the same reason as the flow ribbons: the hall floor
  // has to sit on the measured ground rather than at an assumed zero, or the whole building is
  // buried or floating depending on where in the AOI it happens to be.
  let dcInterior: DcInteriorLayer | null = null;
  if (hasTerrain) {
    try {
      dcInterior = await loadDcInterior(aoi.id, '/terrain', ext, groundAt);
      if (dcInterior) {
        scene.add(dcInterior.group);
        console.info(
          `dc interior: ${dcInterior.meta.zones.length} zones, ` +
            `${dcInterior.rackCount()} rack positions, ${dcInterior.toteCount()} totes`
        );
      }
    } catch (err) {
      // Absence is legitimate — a site with no operations model is a site that has not been
      // generated yet, not a broken one. But a THROW here means the asset exists and is wrong,
      // and that must not be swallowed the way a missing file is.
      console.warn('dc interior failed to build', err);
    }
  }

  // ── The last mile ─────────────────────────────────────────────────────────────
  // Built from the same operations model as the hall, so the docks and the tours that leave them
  // can never describe different days.
  let tourLayer: TourLayer | null = null;
  /** Pharmacy index → LoD2 building index, for the ones the mesh actually covers. */
  let pharmacyBuildings = new Map<number, number>();
  /** Which tour the camera is riding with, or -1. */
  let followTour = -1;
  let followListener: ((following: boolean) => void) | null = null;
  const followLast = new THREE.Vector3();
  const followHeading = new THREE.Vector3(0, 0, 1);
  if (dcInterior) {
    const hubPlace =
      aoi.focusPlaces.find((p) => p.osm && p.osm === aoi.site3d?.heroBuilding) ??
      aoi.focusPlaces.find((p) => p.kind === 'hero') ??
      aoi.focusPlaces[0];
    tourLayer = createTourLayer(dcInterior.meta, ext, groundAnywhere, hubPlace, aoi.site3d?.shiftPattern);
    if (tourLayer) {
      scene.add(tourLayer.group);
      console.info(
        `tours: ${tourLayer.tourCount()} routes to ${tourLayer.dropCount()} pharmacy locations`
      );

      // ── Pharmacies as BUILDINGS, not as markers ────────────────────────────────────────────
      //
      // ⚠️ THE MARKER WAS HIDING THE THING IT MARKED. A 38 m cone standing on a 12 m building is
      // three times its height and wider than its footprint: from the site camera the pharmacy was
      // a blue triangle with a roof somewhere underneath it. A twin whose whole claim is measured
      // geometry should not cover the geometry to point at it.
      //
      // ⚠️ AND MOST PHARMACIES HAVE NO BUILDING TO LIGHT. The LoD2 mesh covers the 2 km photoreal
      // core; the delivery region reaches 22 km. So this matches what it can and leaves the rest
      // to the map pins, rather than snapping a pharmacy onto whatever building happens to be
      // nearest — which at this scale could be kilometres away and simply wrong.
      const points = tourLayer.pharmacyPoints();      const buildingOf = new Map<number, number>();
      if (buildings) {
        points.forEach((p, i) => {
          // Projected with the same function the tours use to place the drop markers, so a
          // pharmacy's building and its pin cannot end up in different places.
          const w = toWorld(p.lon, p.lat, ext, 0);
          // 30 m: a pharmacy's OSM node sits on or just off its building. Beyond that it is a
          // different building, and a confident wrong highlight is worse than none.
          const b = buildings.findNearest(w.x, w.z, 30);
          if (b >= 0) buildingOf.set(i, b);
        });
        pharmacyBuildings = buildingOf;
        const lit = buildings.setHighlight([...buildingOf.values()].map((b) => [b, 1]));
        console.info(
          `pharmacies: ${buildingOf.size} of ${points.length} matched to a LoD2 building (${lit} lit)`
        );
      }

      tourLayer.onServedChanged((served) => {
        if (!buildings) return;
        const state = new Map<number, number>();
        for (const b of pharmacyBuildings.values()) state.set(b, 1);
        for (const i of served) {
          const b = pharmacyBuildings.get(i);
          if (b !== undefined) state.set(b, 2);
        }
        buildings.setHighlight(state);
      });

      // ── Pharmacy names on the map ──────────────────────────────────────────────────────────
      //
      // ⚠️ ALL 202 ARE ADDED; THE DECLUTTER DECIDES HOW MANY ARE DRAWN. Capping the list to "the
      // nearest few" would fix the count at build time and then be wrong at every zoom afterwards
      // — too many names in the region view, and the same handful when you fly down to one street.
      // The label layer already resolves this the cartographic way: greedy, nearest-first, so the
      // names that survive are the ones nearest the camera and zooming IN reveals more. Handing it
      // everything is what lets it answer "at least the nearby ones, ideally all of them"
      // differently at each zoom rather than once and for ever.
      labels.addAnchors(
        points.map((p) => {
          const w = toWorld(p.lon, p.lat, ext, 0);
          return {
            id: `pharm-${p.id}`,
            text: p.name,
            position: new THREE.Vector3(w.x, groundAnywhere(w.x, w.z) + 120, w.z),
            kind: 'pharmacy' as const,
          };
        })
      );
      // They belong to the delivery region, and appear and disappear with it.
      labels.setKindVisible('pharmacy', tourLayer.visible());

      // ⚠️ AND THEY OBEY THE FOG. The names are DOM and the fog is a shader, so without this they
      // carried on being drawn over ground the night grade had taken to near black — seventeen
      // pharmacy names floating in an empty rectangle over the region at 02:00. Sharing the reveal
      // radius means a name is uncovered by the vans reaching it, exactly like the street it sits
      // on, instead of announcing a place the picture is deliberately not showing yet.
      const hub = tourLayer.bounds.centre;
      labels.setFilter((anchor) => {
        if (anchor.kind !== 'pharmacy') return true;
        const night = nightAt(dayTime);
        if (night < 0.5) return true;
        const reveal = Math.max(tourLayer?.reachRadius() ?? 0, 900);
        const d = Math.hypot(anchor.position.x - hub.x, anchor.position.z - hub.z);
        return d <= reveal + REVEAL_SOFT_M * 0.5;
      });
    }
  }

  frame(places[0]?.id ?? '', defaultRangeM, false);

  // ⚠️ THREE LENSES WANT THE GROUND OUT OF THE WAY, SO EXACTLY ONE PLACE WRITES THE UNIFORM.
  // Left as independent writers they undo each other: opening a building while the flow lens
  // is on resets the ground to full brightness the moment the explode animation finishes. The
  // fork dropped this helper and inlined the explode's half, which is why Garching's flow lens
  // has been drawing ribbons over a full-brightness 20 cm orthophoto ever since.
  // The distribution centre's hall is the third writer and goes through the same door.
  let flowGroundDim = 1;
  let dcGroundDim = 1;
  /** The one clock, as a fractional quarter-hour. Everything time-varying reads from this. */
  let dayTime = OPENING_SLOT;
  const applyGroundDim = () => {
    if (!terrainMesh) return;
    // ⚠️ NO TIME-OF-DAY TERM HERE ANY MORE. There used to be a fourth writer, `dayNightDim`, and
    // because `uDim` reaches ONLY the 2 km photoreal core it darkened the core a second time on
    // top of the shared night grade — drawing the core's boundary as a hard bright-to-dark diamond
    // across the middle of the region view. Night belongs to `nightGrade`, which every tier shares.
    (terrainMesh.material as THREE.ShaderMaterial).uniforms.uDim.value =
      (1 - explodeT * 0.62) * flowGroundDim * dcGroundDim;
  };

  // ── Night ────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ DIMMING THE CORE TERRAIN IS NOT NIGHT, AND THE FIRST ATTEMPT PROVED IT. `uDim` reaches
  // exactly one mesh — the 2 km photoreal core. At the range the delivery region is viewed from,
  // that core is a small diamond in the middle of 24 km of SHELL under a blue SKY, so the scene
  // reported `nightFactor === 1` while rendering broad daylight.
  //
  // ⚠️ AND THE HAZE IS MIXED *AFTER* THE DIM. In `terrainMaterial` the order is `colour *= uDim`
  // and only then `mix(colour, uHazeColour, haze)` — so distance fog re-lights whatever the dim
  // just darkened, and the far half of the picture stays bright however far uDim is pushed.
  //
  // So night is applied where light actually comes from: the sun and shadow tints both surfaces
  // share, the haze colour, and the sky gradient.
  const NIGHT_SKY_ZENITH = new THREE.Color('#040910');
  const NIGHT_SKY_HORIZON = new THREE.Color('#0b1a2b');
  const NIGHT_HAZE = new THREE.Color('#0a1420');
  const baseZenith = (sky.mesh.material as THREE.ShaderMaterial).uniforms.uZenith.value.clone();
  const baseHorizon = (sky.mesh.material as THREE.ShaderMaterial).uniforms.uHorizon.value.clone();
  const baseHaze = new THREE.Color(HAZE_COLOUR);

  let nightMaterialsApplied = 0;
  let nightMaterialsSkipped = 0;

  /**
   * The buildings that stay lit through the night.
   *
   * ⚠️ THE CONFIG'S OWN FOCUS PLACES, NOT A RADIUS AROUND THE WAREHOUSE. These are the first
   * (up to four) measured focus places of the AOI, so the lit area has the shape of the actual site.
   * A single circle centred on the
   * warehouse lit the neighbouring industrial units and the rail sidings just as brightly, which
   * makes "this is the one place working at 04:00" a claim the picture quietly contradicts.
   */
  const litSitePlaces = aoi.focusPlaces.slice(0, 4).map((p) => {
    const w = placeToWorld(p, ext, 0);
    return { x: w.x, z: w.z };
  });

  /**
   * Every material in the scene that shades a surface.
   *
   * ⚠️ COLLECTED, NOT LISTED. A hand-written list is what went stale: it named the terrain and the
   * shell, and the buildings and trees added later were never appended to it. Walking the live
   * scene means a layer cannot be forgotten by omission — and anything returned here that lacks
   * the night uniforms is counted as skipped rather than passed over in silence.
   */
  const shadingMaterials = (): THREE.ShaderMaterial[] => {
    const out: THREE.ShaderMaterial[] = [];
    const add = (m: THREE.Material | THREE.Material[] | undefined | null) => {
      if (!m) return;
      for (const one of Array.isArray(m) ? m : [m]) {
        if (one instanceof THREE.ShaderMaterial && !out.includes(one)) out.push(one);
      }
    };
    add(terrainMesh?.material);
    add(shellNightMaterial);
    add(buildings?.mesh.material);
    vegetation?.group.traverse((o) => add((o as THREE.Mesh).material));
    for (const m of tourLayer?.nightMaterials() ?? []) add(m);
    return out;
  };

  const applyNight = (t: number) => {
    const skyUniforms = (sky.mesh.material as THREE.ShaderMaterial).uniforms;
    skyUniforms.uZenith.value.copy(baseZenith).lerp(NIGHT_SKY_ZENITH, t);
    skyUniforms.uHorizon.value.copy(baseHorizon).lerp(NIGHT_SKY_HORIZON, t);

    // The haze the far tiers wash out into. Graded before `nightGrade` runs, so a daylight haze
    // colour would otherwise be the brightest thing left in a night frame.
    for (const material of [terrainMesh?.material, shellNightMaterial]) {
      const uniforms = (material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (uniforms?.uHazeColour) uniforms.uHazeColour.value.copy(baseHaze).lerp(NIGHT_HAZE, t);
    }

    // ⚠️ DARKNESS HAS ONE WRITER, AND IT IS NOT THIS FUNCTION ANY MORE. This used to scale the sun
    // and shadow tints per material, and the list it walked held exactly two of the four surfaces
    // that shade — so the terrain and the shell went dark while 5 538 LoD2 buildings and 4 397
    // trees kept their daylight colour under a black sky. Every night check still passed, because
    // all of them asked the CLOCK rather than the picture.
    //
    // Now every shading material carries the same `nightGrade`, and the state goes to all of them
    // through one call that REPORTS anything it could not reach.
    const centre = tourLayer?.bounds.centre ?? new THREE.Vector3();
    // The site is always visible, however little of the region the vans have uncovered yet.
    const reveal = Math.max(tourLayer?.reachRadius() ?? 0, 900);
    const result = applyNightState(shadingMaterials(), {
      night: t,
      centre,
      litPlaces: litSitePlaces,
      reveal,
    });
    nightMaterialsApplied = result.applied;
    nightMaterialsSkipped = result.skipped;
  };

  // Apply once at build time. Every layer is loaded and awaited by this point, so this is the one
  // moment at which reaching all of them is guaranteed; leaving the first application to the first
  // clock write would render one frame of daylight at 00:00.
  applyNight(nightAt(dayTime));

  // How far the distribution centre's hall is open, and where it is heading. Kept beside the
  // campus explode's own pair rather than inside the interior layer, because the render loop is
  // what owns time in this scene and a second animation clock would drift against the first.
  let dcExplodeT = 0;
  let dcExplodeTarget = 0;
  let zoneListener: ((id: string | null) => void) | null = null;
  let dcOpenListener: ((open: boolean) => void) | null = null;

  /**
   * Open or close the hall.
   *
   * ⚠️ ONE IMPLEMENTATION, AND IT TELLS REACT. There are now two ways in — the panel button and
   * clicking the building's name on the map — and the panel keeps its own `hallOpen` state to
   * decide whether its button says "Open" or "Close". Opening the hall from the map without
   * telling React leaves that state saying "closed" over an open hall, so the next press computes
   * `!false` and asks for open again: the button appears dead. That is the same two-clocks defect
   * this scene has already been bitten by with the day slider, so the listener is not optional.
   */
  /**
   * Where the camera was before the hall opened: closing the logistics centre returns the camera to
   * that position, as the campus twins do with `viewBeforeExplode`. Recorded only on the way in from CLOSED, so opening it again from the map
   * label while it is open does not overwrite the overview with the hall close-up.
   */
  let viewBeforeHall: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  const openHall = (open: boolean, restoreView = true): void => {
    if (!dcInterior) return;
    if (open) {
      if (dcExplodeTarget === 0) viewBeforeHall = { position: camera.position.clone(), target: controls.target.clone() };
      dcInterior.setVisible(true);
      dcExplodeTarget = 1;
      // Go and look at it. The hall is 115 m of a 2 km site; from the establishing shot the
      // whole interior is a few pixels wide, and an explode nobody can see reads as a dead
      // button. Framed from a low angle because the zones separate HORIZONTALLY — from
      // overhead a process chain pulling apart along its own axis barely changes the picture.
      const b = dcInterior.bounds;
      flyToPoint(b.centre, Math.max(b.radiusM * 1.55, 165), 0.22);
    } else {
      // ⚠️ `restoreView` is FALSE when the hall closes because the viewer is being taken somewhere
      // else (the tours overview): pulling the camera back would fight that flight.
      if (dcExplodeTarget > 0 && restoreView && viewBeforeHall) flyToPose(viewBeforeHall);
      viewBeforeHall = null;
      dcExplodeTarget = 0;
    }
    dcOpenListener?.(open);
  };

  /**
   * Clicking a zone while the hall is open selects it.
   *
   * ⚠️ A SEPARATE LISTENER FROM THE CAMPUS PICK PATH, ON PURPOSE. That path is a three-way branch
   * about rooms and building pick volumes, none of which exist at this site — there is no
   * `rooms.json` here, so it can never fire. Threading a fourth case through it would couple two
   * unrelated interaction models; this one only listens while the hall is actually open.
   *
   * ⚠️ Gated on the pointer not having been DRAGGED. Without that, orbiting the camera ends on a
   * pointerup over a zone and silently changes the selection — the user experiences it as the
   * panel jumping about on its own while they are just looking around.
   */
  let dcPointerDown: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    dcPointerDown = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointerup', (event) => {
    const start = dcPointerDown;
    dcPointerDown = null;
    if (!dcInterior || dcExplodeTarget === 0 || !start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const zoneId = dcInterior.zoneAtPointer(ndc, camera);
    // A click that hits no zone CLEARS the selection rather than being ignored. "Click beside it
    // to dismiss" is the exit this engine had to retrofit for exploded buildings after a user hit
    // exactly that wall; building it in from the start is cheaper than adding it later.
    dcInterior.setSelectedZone(zoneId);
    zoneListener?.(zoneId);
  });

  // ── Render loop ──────────────────────────────────────────────────────────
  let running = true;
  let lastFrame = performance.now();
  let firstFrameMs: number | null = null;

  const resize = () => {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const tick = () => {
    if (!running) return;
    requestAnimationFrame(tick);

    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    /**
     * Leaving the building closes it.
     *
     * ⚠️ Runs BEFORE the explode animation block below, and only while `explodeTarget > 0`, so a
     * close already under way cannot re-trigger itself on the next frame.
     *
     * The two-stage arm is the whole trick: opening flies the camera in from far outside
     * `explodeCloseRange`, so a plain distance test would close the building on the frame it
     * opened. Arriving arms it; only then does going away again count. Confirmed by removing the
     * arm stage: the building then never opens at all, and both dismissal tests fail on the very
     * first wait.
     */
    if (explodeCentre && explodeTarget > 0) {
      const distance = camera.position.distanceTo(explodeCentre);
      if (!explodeArmed && distance <= explodeArmRange) explodeArmed = true;
      // Flew away under their own steam: close the floors, and LEAVE THE CAMERA ALONE.
      else if (explodeArmed && distance > explodeCloseRange) closeExploded(false);
    }

    // ⚠️ VERIFIED WITH A BROWSER RENDER HARNESS (not shipped with this template), WHICH IS NOT WHAT
    // THIS COMMENT USED TO SAY. It
    // claimed "Confirmed by disabling it: exactly the three reduced-motion cases fail and the two
    // mirror controls keep passing" — and no test touching reduced motion existed anywhere in the
    // repo. The handle's `reducedMotion()` was even documented "so a test can emulate it", an
    // affordance built for a check nobody wrote. A false claim of verification is the worst kind,
    // because it tells the next reader to stop looking.
    //
    // What is true now: the gate emulates `prefers-reduced-motion` and asserts the camera is at its
    // destination on the first frame, that it STILL arrives there, and — as the control that stops
    // the whole thing passing vacuously — that with motion allowed it is measurably mid-flight.
    // Setting this line to `false` fails exactly one check, "reduced motion drops the journey";
    // the destination check correctly keeps passing, because that breaks the animation, not the
    // arrival. Measured, not asserted.
    const reduced = prefersReducedMotion();

    if (flightFrom && flightTo && flightTargetFrom && flightTargetTo) {
      // Arrive at once when motion is unwelcome: the camera still ENDS where it was sent, so
      // nothing becomes unreachable — only the journey is dropped.
      const k = reduced ? 1 : Math.min((now - flightStart) / FLIGHT_MS, 1);
      // Smoothstep: no jerk at either end, which is what makes it read as a camera move rather
      // than an animation.
      const e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(flightFrom, flightTo, e);
      controls.target.lerpVectors(flightTargetFrom, flightTargetTo, e);
      if (k >= 1) flightFrom = flightTo = flightTargetFrom = flightTargetTo = null;
    }

    if (drone.engaged) drone.update(dt);
    else controls.update();

    // The ripple is wall-clock, not frame-count, so it runs at the same speed on any machine.
    // ⚠️ Under reduced motion both are HELD on a fixed frame, not hidden: a ripple and a dash that
    // loop forever are precisely the vestibular trigger the setting exists for, but the water and
    // the routes still have to be visible or the lens stops answering its question.
    const loopTime = reduced ? 0 : now / 1000;
    water?.update(loopTime, camera.position);
    flows?.update(loopTime);
    walkRoute.update(loopTime);

    // The hall's own animation. ⚠️ Under reduced motion `loopTime` is pinned at 0, so the conveyor
    // and the A-frame HOLD on a frame instead of vanishing — the machinery is the subject of the
    // view, and hiding it would answer the setting by deleting the content.
    dcInterior?.update(loopTime);

    // ── Riding along with a van ────────────────────────────────────────────────────────────────
    //
    // ⚠️ DRIVEN FROM THE RENDER LOOP, NOT FROM THE CLOCK. The van moves whenever time moves, and
    // time moves from a rAF loop in the panel; a camera updated only when the slot changes would
    // lag a quarter-hour behind the vehicle it is supposed to be following. Here it reads the
    // van's CURRENT matrix every frame, so the two cannot come apart.
    if (followTour >= 0 && tourLayer) {
      const at = tourLayer.vanPosition(followTour);
      if (at) {
        // Behind and above, in the direction the van has been travelling. Lerped rather than
        // snapped, or every corner is a whip-pan.
        const heading = at.clone().sub(followLast);
        if (heading.lengthSq() > 1e-4) followHeading.lerp(heading.normalize(), 0.05).normalize();
        followLast.copy(at);
        const wanted = at
          .clone()
          .addScaledVector(followHeading, -FOLLOW_BEHIND_M)
          .add(new THREE.Vector3(0, FOLLOW_ABOVE_M, 0));
        camera.position.lerp(wanted, 0.06);
        controls.target.lerp(at, 0.12);
        controls.update();

        // The headlamp pool sits AHEAD of the van, where a dipped beam actually falls, not under
        // it. Updated here rather than on the clock because the van moves every frame.
        const beam = at.clone().addScaledVector(followHeading, 40);
        setHeadlamp(shadingMaterials(), { x: beam.x, z: beam.z, gain: 1 });
      } else if (tourLayer.tourActive(followTour)) {
        // In a tunnel (Rheinufertunnel …): hold the camera and keep following until it resurfaces.
      } else {
        // The tour finished while we were watching it. Stop rather than stare at empty ground.
        followTour = -1;
        setHeadlamp(shadingMaterials(), null);
        followListener?.(false);
      }
    }

    // The hall opens along the process chain on the same eased curve the campus explode uses.
    if (dcInterior && dcExplodeT !== dcExplodeTarget) {
      const step = reduced ? 1 : (dt * 1000) / EXPLODE_MS;
      dcExplodeT =
        dcExplodeTarget > dcExplodeT
          ? Math.min(dcExplodeT + step, dcExplodeTarget)
          : Math.max(dcExplodeT - step, dcExplodeTarget);
      const eased = dcExplodeTarget > 0 ? 1 - (1 - dcExplodeT) ** 3 : dcExplodeT ** 2;
      dcInterior.setExplode(eased);
      // Same argument as every other lens in this app: a 20 cm orthophoto out-competes anything
      // drawn on top of it, and the vegetation is there to make the site look real rather than to
      // be looked at while the hall is open.
      dcGroundDim = 1 - 0.62 * eased;
      applyGroundDim();
      vegetation?.setVisible(dcExplodeT < 0.35);
      if (dcExplodeT === 0 && dcExplodeTarget === 0) {
        dcInterior.setVisible(false);
        dcInterior.setSelectedZone(null);
        vegetation?.setVisible(true);
        dcGroundDim = 1;
        applyGroundDim();
      }
    }

    // The floors rise and the shell steps back on one curve, so it reads as a single act.
    if (rooms && explodeT !== explodeTarget) {
      const step = reduced ? 1 : (dt * 1000) / EXPLODE_MS;
      explodeT =
        explodeTarget > explodeT
          ? Math.min(explodeT + step, explodeTarget)
          : Math.max(explodeT - step, explodeTarget);
      // Ease-out on the way open, ease-in on the way closed: opening should settle gently, and
      // closing should feel like the building pulling itself back together.
      const eased = explodeTarget > 0 ? 1 - (1 - explodeT) ** 3 : explodeT ** 2;
      rooms.setExplode(explodedCode, eased);
      // The shell has to be gone well before the floors are fully apart, or the top storeys rise
      // through a roof that is still solid.
      buildings?.setOpacity(1 - Math.min(explodeT * 1.6, 1));
      // The ground recedes and the trees go with it. Both are there to make the campus look real;
      // once a building is open they are competing with the thing being measured, and a 20 cm
      // orthophoto wins that competition every time.
      applyGroundDim();
      vegetation?.setVisible(explodeT < 0.35);
      if (explodeT === 0 && explodeTarget === 0) {
        explodedCode = null;
        rooms.setExplode(null, 0);
        buildings?.setOpacity(1);
        vegetation?.setVisible(true);
        applyGroundDim();
      }
    }

    sky.update(camera);
    labels.update(camera, canvas);
    renderer.render(scene, camera);
    // The first frame that actually contains the campus. Everything above this line is awaited
    // before the loop starts, so there is no empty-canvas frame to mistake for a fast one.
    // performance.now() is measured from navigation start, which is what a viewer experiences.
    if (firstFrameMs === null) firstFrameMs = performance.now();
  };
  requestAnimationFrame(tick);

  const handle: Twin3DHandle = {
    hasTerrain,
    hasDrape: Boolean(assets?.drapeTexture),
    rastersShareOrientation: (() => {
      const rasters = [
        assets?.heightTexture,
        assets?.landuseTexture,
        assets?.shellTexture,
        assets?.drapeTexture,
      ].filter((texture): texture is THREE.Texture => Boolean(texture));
      return rasters.every((texture) => texture.flipY === rasters[0]?.flipY);
    })(),
    buildingCount: buildings?.meta.count ?? 0,
    buildingColours: () => buildings?.colourSpread() ?? { roofColours: 0, wallColours: 0 },
    treeCount: vegetation?.drawn ?? 0,
    firstFrameMs() {
      return firstFrameMs;
    },
    textureBytes() {
      return estimateTextureBytes(scene, [
        assets?.heightTexture,
        assets?.landuseTexture,
        assets?.shellTexture,
        assets?.drapeTexture,
      ]);
    },
    waterHectares: water ? water.meta.bodies.reduce((sum, b) => sum + b.areaM2, 0) / 1e4 : 0,
    meshCore: meshCore
      ? {
          tiles: meshCore.manifest.totals.tiles,
          loaded: meshCore.loaded,
          vertices: meshCore.manifest.totals.vertices,
          texels: meshCore.manifest.totals.texels,
          bytes: meshCore.manifest.totals.bytes,
          ringTiles: meshCore.manifest.ring?.totals.tiles ?? 0,
          ringLoaded: meshCore.ringLoaded,
        }
      : null,
    setMeshVisible(visible: boolean) {
      applyMeshVisibility(visible);
    },
    meshVisible() {
      return meshShown;
    },

    // ── the distribution centre ──────────────────────────────────────────────────────────────
    dcInterior,
    openDc(open, restoreView = true) {
      openHall(open, restoreView);
    },
    onDcOpenChanged(handler) {
      dcOpenListener = handler;
    },
    hallPlace() {
      return hallPlaceId;
    },
    dcOpen() {
      return dcExplodeTarget > 0;
    },
    dcExplodeProgress() {
      return dcExplodeT;
    },
    setDcSlot(slot) {
      // ⚠️ ONE CLOCK DRIVES EVERYTHING. The machinery in the hall, the vans on the road and how
      // dark it is are three views of the same moment. Letting any of them keep its own time would
      // let the picture contradict itself — vans rolling out of a hall that is idle.
      //
      // The clock is FRACTIONAL. The hall's zone activity is a quarter-hour quantity so it rounds,
      // but the vans are interpolated: driving is continuous, and the 15-minute grid is the
      // resolution of the DATA, not of the picture.
      dcInterior?.setSlot(Math.round(slot));
      tourLayer?.setTime(slot);
      const night = nightAt(slot);
      applyGroundDim();
      applyNight(night);
      dayTime = ((slot % 96) + 96) % 96;
    },
    dcSlot() {
      return dayTime;
    },

    tours: tourLayer,
    setToursVisible(visible) {
      if (!tourLayer) return;
      tourLayer.setVisible(visible);
      labels.setKindVisible('pharmacy', visible);
      if (visible) {
        // The region is 44 km across and the hall is 115 m long. Without moving the camera the
        // whole last mile is drawn somewhere off screen behind the viewer.
        flyToPoint(tourLayer.bounds.centre, Math.max(tourLayer.bounds.radiusM * 2.3, 9000), 0.62);
      }
    },
    toursVisible() {
      return tourLayer?.visible() ?? false;
    },
    activeTours() {
      return tourLayer?.activeTours() ?? 0;
    },
    vansAtStop() {
      return tourLayer?.vansAtStop() ?? 0;
    },
    nightFactor() {
      return nightAt(dayTime);
    },
    nightCoverage() {
      return { applied: nightMaterialsApplied, skipped: nightMaterialsSkipped };
    },
    revealRadius() {
      return Math.max(tourLayer?.reachRadius() ?? 0, 900);
    },
    pharmacyHighlight() {
      const attribute = buildings?.mesh.geometry.getAttribute('aHighlight');
      let litVertices = 0;
      if (attribute) {
        const values = attribute.array as Float32Array;
        for (let i = 0; i < values.length; i += 1) if (values[i] > 0.5) litVertices += 1;
      }
      return {
        matched: pharmacyBuildings.size,
        total: tourLayer?.dropCount() ?? 0,
        litVertices,
      };
    },
    labelStats() {
      return labels.stats('pharmacy');
    },
    selectZone(id) {
      dcInterior?.setSelectedZone(id);
      zoneListener?.(id);
    },
    selectedZone() {
      return dcInterior?.selectedZone() ?? null;
    },
    onZonePicked(handler) {
      zoneListener = handler;
    },

    flows,
    setFlowVisible(visible) {
      flows?.setVisible(visible);
      // Same argument as the explode: the ribbons are a quantity drawn over a photograph, and at
      // full brightness the photograph wins. Dimming the ground is what makes the flow readable
      // without having to shout with colour.
      flowGroundDim = visible ? 0.45 : 1;
      applyGroundDim();
      // Then go to where the walking is. The routed network covers about 500 m of a 2.5 km site,
      // so from the default framing the whole lens is a thread a few pixels wide with a lot of
      // farmland around it. The camera is left alone on close, because by then the visitor has
      // usually moved it themselves and yanking it back would undo their work.
      if (visible && flows) {
        flyToPoint(flows.bounds.centre, Math.max(flows.bounds.radiusM * 1.9, 380), 0.74);
      }
    },
    setFlowSlot(slot) {
      flows?.setSlot(slot);
    },
    showWalkRoute(points) {
      if (points.length < 2) {
        walkRoute.clear();
        return;
      }
      walkRoute.show(points);

      // ⚠️ AND GO AND LOOK AT IT. Drawing a 185 m line while the camera sits three kilometres up
      // renders it into a single invisible pixel — the route was correct, present in the scene, and
      // completely useless. The whole reason to draw the walk is that a planner can check it, and
      // they cannot check what is off screen.
      const bounds = walkRoute.bounds();
      if (bounds) {
        // Enough range to hold the whole walk with room around it, and never so close that a short
        // hop between neighbouring buildings puts the camera inside a wall.
        const range = Math.max(bounds.spanM * 1.6, 180);

        // ⚠️ AIM HIGH, BECAUSE THE WEEK GRID COVERS THE BOTTOM OF THE SCREEN. Framing the route at
        // the centre of the canvas puts it behind the drawer that was just used to select it — the
        // camera arrives, the line is drawn, and half of it is under a table. The aim point is
        // pulled back towards the camera, which lifts the route into the visible upper band.
        const lift = range * 0.3;
        const aim = new THREE.Vector3(
          bounds.centre.x + lift * 0.6,
          bounds.centre.y,
          bounds.centre.z + lift * 0.8
        );
        flyToPoint(aim, range, 0.62);
      }
    },
    walkRoutePoints() {
      return walkRoute.drawn();
    },
    roomCount: rooms?.distinct.rooms ?? 0,
    rooms,
    setRoomsVisible(visible) {
      rooms?.setVisible(visible);
    },
    explodeBuilding,
    explodedBuilding() {
      return explodeTarget > 0 ? explodedCode : null;
    },
    reducedMotion() {
      return prefersReducedMotion();
    },
    explodeProgress() {
      return explodeT;
    },
    cameraDebug() {
      return {
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    },
    lookAt(lat, lon, rangeM) {
      const w = toWorld(lon, lat, ext, 0);
      const groundM = groundAnywhere(w.x, w.z);
      controls.target.set(w.x, groundM, w.z);
      // Offset to the south-west and up, matching the scene's own sun direction so the view is
      // lit rather than backlit.
      camera.position.set(w.x - rangeM * 0.5, groundM + rangeM * 0.8, w.z + rangeM * 0.5);
      controls.update();
    },
    highlightPharmacies(on) {
      if (!buildings) return;
      buildings.setHighlight(on ? [...pharmacyBuildings.values()].map((b) => [b, 1]) : []);
    },
    dayEvents() {
      return tourLayer?.dayEvents() ?? [];
    },
    cityDeliverySlot() {
      return tourLayer?.cityDeliverySlot() ?? null;
    },
    vansInCity() {
      return tourLayer?.activeInCore() ?? 0;
    },
    followDelivery(on) {
      if (!on || !tourLayer) {
        followTour = -1;
        // Put the night back the way it was, or the road stays lit after the van has gone.
        setHeadlamp(shadingMaterials(), null);
        followListener?.(false);
        return -1;
      }
      // The one nearest the camera, so pressing the button follows the van you were already
      // looking at rather than an arbitrary one 20 km away.
      const index = tourLayer.nearestActiveTour(camera.position.x, camera.position.z);
      followTour = index;
      if (index >= 0) {
        const at = tourLayer.vanPosition(index);
        if (at) followLast.copy(at);
      }
      followListener?.(index >= 0);
      return index;
    },
    followingDelivery() {
      return followTour;
    },
    onFollowChanged(handler) {
      followListener = handler;
    },
    setTimeSlot(slot) {
      rooms?.setTimeSlot(slot);
    },
    selectRoom(index) {
      rooms?.setSelected(index);
    },
    onRoomPicked(handler) {
      roomPickedHandler = handler;
    },
    onBuildingPicked(handler) {
      buildingPickedHandler = handler;
    },
    onPlacePicked(handler) {
      placePickedHandler = handler;
    },
    clearPlaceHighlight() {
      labels.setActive(null);
    },
    onBuildingClosed(handler) {
      buildingClosedHandler = handler;
    },
    focusPlace(placeId) {
      frame(placeId, PLACE_RANGE_M);
    },
    activatePlace(placeId) {
      // ⚠️ THE SAME ROUTE AS CLICKING THE NAME ON THE MAP, and deliberately NOT the same as
      // `focusPlace`. Routing both through here opened the hall on every page load, because the
      // establishing shot flies to the warehouse by calling `focusPlace` — so the app arrived with
      // its main building already exploded, which is both a spoiled opening shot and a thing that
      // looks like a bug. Looking at a place and acting on it are different verbs.
      selectPlace(placeId);
    },
    setLabelsVisible(visible) {
      labels.setVisible(visible);
    },
    setBuildingCondition(grade, renovationYear) {
      buildings?.setCondition(grade, renovationYear);
    },
    setBuildingConditionYear(year) {
      buildings?.setConditionYear(year);
    },
    setBuildingConditionMix(mix) {
      buildings?.setConditionMix(mix);
    },
    setDrapeVisible(visible) {
      if (terrainMesh) {
        (terrainMesh.material as THREE.ShaderMaterial).uniforms.uShowDrape.value = visible ? 1 : 0;
      }
    },
    setVegetationVisible(visible) {
      vegetation?.setVisible(visible);
    },
    setDroneMode(on) {
      // Everything this used to do — disabling OrbitControls, and on the way back out deriving an
      // orbit centre the orbit camera will accept — now lives in `flyControls.ts`, because it has
      // to happen on a keypress as well as on a call and there must be exactly one copy of it.
      drone.setEngaged(on);
    },
    droneEngaged() {
      return drone.engaged;
    },
    onDroneMode(listener) {
      droneListener = listener;
    },
    droneTelemetry() {
      return drone.engaged ? drone.telemetry() : null;
    },
    dispose() {
      running = false;
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      drone.dispose();
      unsubscribeBrand();
      labels.dispose();
      controls.dispose();
      sky.dispose();
      buildings?.dispose();
      vegetation?.dispose();
      water?.dispose();
      flows?.dispose();
      walkRoute.dispose();
      rooms?.dispose();
      if (placeholder) scene.remove(placeholder);
      for (const item of disposables) item.dispose();
      renderer.dispose();
    },
  };

  /**
   * A testing seam.
   *
   * The exploded view is animated on the GPU from uniforms, so nothing about whether the floors
   * actually moved is visible to the DOM. Exposing the handle lets an end-to-end test ask the
   * scene directly — and it is how the first version of the explode was found not to be moving
   * at all, when the screenshot merely looked ambiguous.
   */
  (window as unknown as { __twin?: Twin3DHandle }).__twin = handle;

  return handle;
}
