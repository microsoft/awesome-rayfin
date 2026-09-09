import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AoiConfig, AoiFocusPlace } from '@/config/aoi';
import { placeToWorld, worldExtent, type WorldExtent } from '@/geo/world';

import { loadBuildings, type BuildingLayer } from './buildings';
import { createFlyControls, type FlyControls, type FlyTelemetry } from './flyControls';
import { createLabelLayer, type LabelAnchor, type LabelLayer } from './labelLayer';
import { EXPLODE_GAP_M, loadRooms, type RoomLayer, type RoomView } from './rooms';
import { createShellMaterial } from './shellMaterial';
import { createSky, type Sky } from './sky';
import {
  AMBIENT,
  createTerrainMaterial,
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
import { createWalkRouteLayer, type WalkRouteLayer } from './walkRoute';
import { loadShuttle, type ShuttleLayer } from './shuttle';

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
   * `campus` names a whole site; `unmodelled` is a real building this dataset holds no rooms for.
   * They are different facts and the panel says different things about them — collapsing them into
   * "nothing here" would make a deliberate scope decision look like missing data.
   */
  kind: 'campus' | 'unmodelled';
}

export interface Campus3DHandle {
  focusPlace(placeId: string): void;
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
  /**
   * The person walking the drawn route: position, how far along, and how long the whole walk
   * takes at the dataset's own walking speed. Null when no route is shown.
   */
  walker(): { x: number; z: number; progress: number; seconds: number } | null;
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
  /**
   * The played week, as a FRACTIONAL slot (0 = Monday, first teaching hour).
   *
   * ⚠️ Separate from `setTimeSlot` on purpose. Rooms are booked by the hour and round this; the
   * shuttle between the campuses is continuous and does not. Feeding whole slots to something
   * that drives 3.5 km across town makes it jump the whole way on the hour, once, and stand still
   * the rest of the time.
   */
  setWeekTime(time: number | null): void;
  /** Where the shuttle is, or null when it is not running. For tests and the follow camera. */
  shuttlePosition(): { x: number; z: number } | null;
  /** The measured road journey between the campuses, or null on a single-campus AOI. */
  shuttleLeg(): { from: string; to: string; distanceM: number; driveSeconds: number } | null;
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

export async function initCampus3D(
  canvas: HTMLCanvasElement,
  aoi: AoiConfig,
  options: Campus3DOptions = {}
): Promise<Campus3DHandle> {
  const ext: WorldExtent = worldExtent(aoi.bbox);

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
    console.info(`terrain not built for '${aoi.id}' — run: npm run data:build -- --aoi ${aoi.id}`);
  }

  const hasTerrain = assets !== null;
  const terrain = assets?.terrain ?? null;

  // World units are metres, with the terrain centred on the origin. When there is no terrain the
  // AOI bbox stands in for it, which is why both paths agree on scale.
  const widthM = terrain ? terrain.width * terrain.resolutionM : ext.widthM;
  const depthM = terrain ? terrain.height * terrain.resolutionM : ext.depthM;
  const groundM = terrain ? terrain.heightMinM : aoi.elevationRangeM.min;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(SKY_COLOUR, 1);

  const scene = new THREE.Scene();

  const sky: Sky = createSky();
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
      shellMesh.position.set(shellCentreE - coreCentreE, 0, -(shellCentreN - coreCentreN));
      shellMesh.frustumCulled = false;
      scene.add(shellMesh);
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
      console.info('vegetation not available — run tools/geodata/build_vegetation.py');
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
      console.info('rooms not available — run tools/geodata/build_rooms.py');
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
  const anchors: LabelAnchor[] = places.map((place) => ({
    id: place.id,
    text: place.name,
    position: worldFor(place),
    kind: place.kind === 'station' ? 'station' : 'place',
  }));
  const labels: LabelLayer = createLabelLayer(anchors);
  options.labelHost?.appendChild(labels.element);

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
  const campusPlaceIds = new Set((aoi.campuses ?? []).map((campus) => campus.id));

  /**
   * Clicking a name does the most useful thing that name can do.
   *
   * ⚠️ Until now it did NOTHING, which is the worst of the options: the labels are the most
   * obviously clickable thing on the map. There are two honest outcomes and they depend on the
   * data, not on the label:
   *
   *   * the place IS a building with rooms  → open it, exactly as clicking the building does
   *   * the place is a campus, or a building this dataset has no rooms for → fly to it and say so
   *
   * Guessing a building for the second case would open an empty shell and imply a floor plan that
   * does not exist.
   */
  const buildingNearPlace = (place: AoiFocusPlace): string | null => {
    if (!rooms || campusPlaceIds.has(place.id)) return null;
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
      kind: campusPlaceIds.has(place.id) ? 'campus' : 'unmodelled',
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
      console.info('flow not available — run tools/geodata/build_flows.py');
    }
  }

  // ── The walk between two rooms ────────────────────────────────────────────────
  // Empty until something asks for a route. It needs the terrain for the same reason the flow layer
  // does: a line drawn at a constant height crosses the Galgenberg embankment in mid-air.
  const walkRoute: WalkRouteLayer = createWalkRouteLayer(ext, groundAt);
  scene.add(walkRoute.group);

  // ── The shuttle between the campuses ──────────────────────────────────────────
  // Absent on a single-campus AOI, which is why a missing file is not an error: Garching and
  // Tübingen have nowhere to drive to, and a console error on every load of them would be noise
  // about a thing that is working correctly.
  let shuttle: ShuttleLayer | null = null;
  try {
    shuttle = await loadShuttle(aoi.id, '/terrain', ext, groundAt);
    if (shuttle) {
      scene.add(shuttle.group);
      shuttle.setVisible(false);
      const leg = shuttle.legs()[0];
      console.info(
        `shuttle: ${leg.from} to ${leg.to}, ${(leg.distanceM / 1000).toFixed(2)} km by road, ` +
          `${(leg.driveSeconds / 60).toFixed(1)} min at free flow`
      );
    }
  } catch (err) {
    console.info('shuttle not available — run tools/geodata/build_drive_route.py', err);
  }

  frame(places[0]?.id ?? '', defaultRangeM, false);

  // ⚠️ TWO LENSES WANT THE GROUND OUT OF THE WAY, SO EXACTLY ONE PLACE WRITES THE UNIFORM.
  // Left as two independent writers they undo each other: opening a building while the flow lens
  // is on resets the ground to full brightness the moment the explode animation finishes. The
  // fork dropped this helper and inlined the explode's half, which is why Garching's flow lens
  // has been drawing ribbons over a full-brightness 20 cm orthophoto ever since.
  let flowGroundDim = 1;
  const applyGroundDim = () => {
    if (!terrainMesh) return;
    (terrainMesh.material as THREE.ShaderMaterial).uniforms.uDim.value =
      (1 - explodeT * 0.62) * flowGroundDim;
  };

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

    // Confirmed by disabling it: exactly the three reduced-motion cases fail and the two mirror
    // controls keep passing, so the tests discriminate rather than merely agree.
    const reduced = prefersReducedMotion();

    // ⚠️ The shuttle only moves while it is on screen, and it stands still under reduced motion.
    // A vehicle circling a campus nobody is looking at is wasted work, and one that keeps driving
    // for a viewer who asked for stillness ignores the request the whole camera path honours.
    if (shuttle?.visible() && !reduced) shuttle.tick(dt);

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

  const handle: Campus3DHandle = {
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
    walker() {
      return walkRoute.walker();
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
    setTimeSlot(slot) {
      rooms?.setTimeSlot(slot);
    },
    selectRoom(index) {
      rooms?.setSelected(index);
    },
    /**
     * The played week. Only the shuttle listens: the rooms are driven by `setTimeSlot`, which the
     * caller derives from this by rounding.
     *
     * ⚠️ The vehicle is SHOWN by playing and hidden by stopping, rather than by a switch of its
     * own. A bus parked in the road while the week is paused reads as a bus that has broken down,
     * and it is the only thing on the campus that would be frozen mid-motion.
     */
    setWeekTime(time) {
      shuttle?.setVisible(time !== null);
    },
    shuttlePosition() {
      return shuttle?.position() ?? null;
    },
    shuttleLeg() {
      const leg = shuttle?.legs()[0];
      return leg
        ? { from: leg.from, to: leg.to, distanceM: leg.distanceM, driveSeconds: leg.driveSeconds }
        : null;
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
      labels.dispose();
      controls.dispose();
      sky.dispose();
      buildings?.dispose();
      vegetation?.dispose();
      water?.dispose();
      flows?.dispose();
      walkRoute.dispose();
      shuttle?.dispose();
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
  (window as unknown as { __campus?: Campus3DHandle }).__campus = handle;

  return handle;
}
