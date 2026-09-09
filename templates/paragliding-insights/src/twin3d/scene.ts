import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { loadBuildings, type BuildingLayer } from './buildings';
import { loadVegetation, type VegetationLayer } from './vegetation';

import { liftForDistance, sampleFlight, type Viewpoint } from './cameraFlight';
import { createCablewayLayer, type CablewayData, type CablewayLayer } from './cablewayLayer';
import { createFlyControls, type FlyControls, type FlyTelemetry } from './flyControls';
import { createLabelLayer, type LabelAnchor, type LabelLayer } from './labelLayer';
import { createLiveLayer, type LiveLayer } from './liveLayer';
import { createWebcamLayer, type WebcamLayer, type WebcamMarker } from './webcamLayer';
import { wgs84ToUtm32 } from '@/flight/utm';
import { createShellMaterial, addShellCore } from './shellMaterial';
import { createSky, type Sky } from './sky';
import { createTour, type TourController } from './tour';
import { createTrackLayer, type TrackLayer } from './trackLayer';
import { createTerrainMaterial, SKY_COLOUR } from './terrainMaterial';
import {
  loadTerrain,
  type ProgressReporter,
  type TerrainAssets,
  type TerrainFocusPlace,
} from './terrainLoader';
import { WORLD, inWorld } from '@/config/world';
import { AOIS } from '@/config/aoi';
import type { FlightTrack, WorldOrigin } from '@/flight/track';
import type { LiveAircraft } from '@/live/ogn';

export interface Twin3DHandle {
  /** Fly the camera to one of the AOI's focus places. */
  focusPlace(placeId: string): void;
  /**
   * Fly to another site in the same world — PLAN §8.
   *
   * Resolves false when that site's core could not be loaded, so the caller can report it rather
   * than leaving a dropdown that silently does nothing.
   */
  flyToSite(siteId: string): Promise<boolean>;
  /** Which sites currently have their core in the scene. */
  loadedSites(): string[];
  /** The focus places of one site, or an empty list if its core has not loaded yet. */
  placesForSite(siteId: string): TerrainFocusPlace[];
  /** Show or hide the instanced trees — also the cheapest thing to turn off. */
  setVegetationVisible(visible: boolean): void;
  setLanduseVisible(visible: boolean): void;
  /** Show or hide the orthophoto drape. */
  setDrapeVisible(visible: boolean): void;
  /** True once the orthophoto has been generated and loaded. */
  hasDrape: boolean;
  /** Show or hide the Nebelhornbahn. */
  setCablewayVisible(visible: boolean): void;
  /** True once the cableway layer has been generated and loaded. */
  hasCableway: boolean;
  /** Draw a flight, or pass null to clear the current one. */
  setFlight(track: FlightTrack | null): void;
  /** Move the replay head, in seconds from the first fix. */
  setFlightTime(seconds: number): void;
  /** Keep the camera pointed at the glider as it flies. */
  setFollowGlider(follow: boolean): void;
  /** Draw live traffic from the OGN relay — PLAN §3, Mode C. */
  setLiveTraffic(aircraft: LiveAircraft[]): void;
  setLiveVisible(visible: boolean): void;
  /**
   * Keep the camera on one live aircraft, or pass null to release it.
   *
   * Separate from `setFollowGlider` because the two follow different things — a replayed track
   * whose whole future is known, and a live aircraft that may simply stop reporting mid-turn.
   */
  setFollowLive(id: string | null): void;
  /** Called with the aircraft under a click, or null when the click hit nothing. */
  onLiveSelect(listener: ((id: string | null) => void) | null): void;
  /** Called with the webcam under a click. Webcams win ties against aircraft. */
  onWebcamSelect(listener: ((camera: WebcamMarker | null) => void) | null): void;
  setWebcamsVisible(visible: boolean): void;
  /** Fly to a webcam's position, looking the way it looks. */
  focusWebcam(id: string): void;
  /** True when this world has any webcam at all, so the toggle can hide itself. */
  hasWebcams: boolean;
  /**
   * Force the camera into or out of drone mode — the free camera. See `flyControls.ts`.
   *
   * Normally nobody calls this: pressing W A S D takes the camera and letting go gives it back a
   * couple of seconds later. It exists for the button, for the voice assistant, and for anything
   * that has to take the camera away — a tour, or following a glider.
   *
   * Drone mode still has no terrain collision and no wing physics — PLAN decision 19. It is a
   * camera, not a simulator. What it does have is inertia, a throttle and an altimeter.
   */
  setDroneMode(on: boolean): void;
  /** Whether the viewer currently has the camera. Flips on its own, so also see `onDroneMode`. */
  droneEngaged(): boolean;
  /** Subscribe to the latch, so the UI can follow a mode it did not switch. Null to unsubscribe. */
  onDroneMode(listener: ((engaged: boolean) => void) | null): void;
  /** Drone-mode instruments, or null when it is not flying. Safe to poll. */
  droneTelemetry(): FlyTelemetry | null;
  setLabelsVisible(visible: boolean): void;
  /**
   * Run the guided tour. Interruptible at any moment — touching the controls stops it.
   *
   * `onCaption` is called with an i18n key at each stop and with null when the tour ends, so the
   * caller can render the caption without the scene knowing anything about the interface.
   */
  startTour(onCaption: (key: string | null, index: number, total: number) => void): void;
  stopTour(): void;
  /**
   * Where the world origin sits in UTM32, so a flight can be projected into the same metres the
   * terrain uses without the caller having to know how the scene is laid out.
   */
  worldOrigin: WorldOrigin;
  assets: TerrainAssets;
  buildings: BuildingLayer | null;
  dispose(): void;
}

/**
 * Build the terrain scene.
 *
 * One terrain covers the whole AOI, so the launch sites, the landing field and the valley are
 * viewpoints on a single mountain rather than separate maps. Camera work stays restrained — an
 * oblique view of the massif, and an eased flight when the viewer picks another place so the
 * ground stays continuous underneath. That is orientation, not spectacle (PLAN §2.3, no
 * gamification).
 *
 * This module knows nothing about flying. It draws the ground and moves the camera; tracks,
 * live gliders and airspace are layers added on top of the handle it returns.
 */
export async function initTwin3D(
  canvas: HTMLCanvasElement,
  aoiId: string,
  onProgress?: ProgressReporter,
  labelHost?: HTMLElement
): Promise<Twin3DHandle> {
  // The shell comes from the WORLD when this site belongs to one, so every site shares a single
  // continuous horizon and the ground between them exists — PLAN §8. A site outside any world
  // falls back to its own shell, which is the pre-phase-8 behaviour rather than a failure.
  const assets = await loadTerrain(
    aoiId,
    '/terrain',
    onProgress,
    inWorld(aoiId) ? WORLD.id : aoiId
  );
  const { terrain } = assets;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // Without this the drawing buffer is cleared after presentation and readPixels always returns
    // zeroes, which makes anything drawn here impossible to assert on from an e2e test.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // The same colour the haze fades to, so the far edge of the shell dissolves rather than ending.
  renderer.setClearColor(SKY_COLOUR, 1);

  const scene = new THREE.Scene();

  // The sky, first — a backdrop rather than geometry. Without it the most dramatic terrain in
  // Germany sits in a flat void and reads as a diagram of a mountain.
  const sky: Sky = createSky();
  scene.add(sky.mesh);

  // World units are metres, with the terrain centred on the origin.
  const widthM = terrain.width * terrain.resolutionM;
  const depthM = terrain.height * terrain.resolutionM;

  // ⚠️ **True scale, always.** The vertical-exaggeration lever was removed as unnecessary: this AOI
  // has roughly 1 400 m of real relief and the second site is Alpine too, so the only thing the
  // lever could do was make an honest mountain look like a video game. Any factor above 1 is a
  // claim about the landform that the survey does not make.

  const camera = new THREE.PerspectiveCamera(42, 1, 20, 80000);

  // Navigation: left-drag orbits, wheel zooms, right-drag pans. Damping at 0.08 is what gives it
  // the slow, deliberate feel rather than a twitchy game camera.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.7;
  controls.rotateSpeed = 0.55;
  controls.minDistance = 250;
  controls.maxDistance = 26000;
  // Stop just short of the horizon so the camera cannot drop below the terrain and look up
  // through it, which reads as a rendering fault rather than as a viewpoint.
  controls.maxPolarAngle = Math.PI * 0.48;

  /**
   * Default viewing distance, derived from the AOI rather than fixed.
   *
   * A hard-coded range is a hidden claim about how big the area is: 3.4 km framed one particular
   * valley and would sit inside the mountain in a larger AOI. Taking it from the terrain extent
   * keeps the opening shot sensible whichever AOI is loaded (§14 Q2).
   */
  const defaultRangeM = Math.max(widthM, depthM) * 0.42;

  /**
   * Everything the camera can be pointed at.
   *
   * Settlements and stations plus the launch sites and landing zones — the tour needs to fly to a
   * launch, and a viewer clicking a label expects the same. Kept as one list so a caller never has
   * to know which config block a place came from.
   */
  const allPlaces = [...terrain.focusPlaces, ...(terrain.flyingSites ?? [])];

  /**
   * Every site's places, with the offset that puts them in this scene's world metres — PLAN §8.
   *
   * ⚠️ **A place id is only meaningful together with the site it belongs to.** Once the world holds
   * more than one core, `(u - 0.5) * widthM` is no longer the whole answer: it gives a position
   * inside *some* core, and using the near core's size and origin for a place 24 km away puts the
   * camera in an empty field. Each frame carries its own offset and extent for exactly that reason.
   */
  interface SiteFrame {
    places: TerrainFocusPlace[];
    offsetX: number;
    offsetZ: number;
    widthM: number;
    depthM: number;
  }
  const siteFrames = new Map<string, SiteFrame>([
    [aoiId, { places: allPlaces, offsetX: 0, offsetZ: 0, widthM, depthM }],
  ]);

  const findPlace = (placeId: string): { place: TerrainFocusPlace; frame: SiteFrame } | null => {
    for (const frame of siteFrames.values()) {
      const place = frame.places.find((p) => p.id === placeId);
      if (place) return { place, frame };
    }
    const fallback = siteFrames.get(aoiId);
    const first = fallback?.places[0];
    return first && fallback ? { place: first, frame: fallback } : null;
  };

  /**
   * Where the camera sits to frame one place.
   *
   * Positions come from the terrain metadata, which is generated from the AOI config, so no
   * coordinate is hard-coded here.
   */
  const viewpointFor = (placeId: string, rangeM = defaultRangeM): Viewpoint | null => {
    const found = findPlace(placeId);
    if (!found) return null;
    const { place, frame } = found;
    const target = new THREE.Vector3(
      frame.offsetX + (place.u - 0.5) * frame.widthM,
      place.groundM,
      frame.offsetZ + (place.v - 0.5) * frame.depthM
    );
    // Look in from the south-east and above. The hillshade sun is north-west, so this keeps the
    // lit faces turned towards the camera and the shaded ones reading as depth.
    const position = new THREE.Vector3(
      target.x + rangeM * 0.45,
      target.y + rangeM * 0.95,
      target.z + rangeM * 0.65
    );
    return { position, target };
  };

  /** Jump straight to a place, with no transition. Used for the opening shot. */
  const frame = (placeId: string, rangeM = defaultRangeM) => {
    const view = viewpointFor(placeId, rangeM);
    if (!view) return;
    camera.position.copy(view.position);
    // The controls own the orbit centre, so moving the camera without moving the target would let
    // the next drag snap the view back to wherever the target still was.
    controls.target.copy(view.target);
    controls.update();
  };

  // ── Flying between places ────────────────────────────────────────────────
  // Every focus place sits on one terrain, so cutting between them throws away the one thing that
  // makes them legible: they are points on the same mountain, a few kilometres apart. An instant
  // jump reads as a different map. Flying keeps the landform continuous under the camera, and the
  // lift in the middle of the arc shows the ground that connects the two.
  let flight: {
    from: Viewpoint;
    to: Viewpoint;
    liftM: number;
    startedAt: number;
    durationMs: number;
  } | null = null;

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const flyToView = (to: Viewpoint, durationMs = 1500) => {
    // Respect the OS setting, and do not animate a move that is not really a move.
    const distanceM = controls.target.distanceTo(to.target);
    if (prefersReducedMotion || distanceM < 50) {
      flight = null;
      camera.position.copy(to.position);
      controls.target.copy(to.target);
      controls.update();
      return;
    }

    flight = {
      from: { position: camera.position.clone(), target: controls.target.clone() },
      to,
      liftM: liftForDistance(distanceM),
      startedAt: performance.now(),
      // Long enough to read as travel over ground, short enough not to make the button feel slow.
      durationMs,
    };
  };

  const flyTo = (placeId: string, rangeM = defaultRangeM) => {
    const to = viewpointFor(placeId, rangeM);
    if (!to) return;
    flyToView(to);
  };

  // Grabbing the controls cancels the flight rather than fighting it for the camera.
  const cancelFlight = () => {
    flight = null;
    // — and it ends the tour, for the same reason. A guided tour that wrestles the camera back off
    // the viewer is a cutscene, and a cutscene in a data app says the data does not matter.
    tour?.stop();
  };
  controls.addEventListener('start', cancelFlight);

  const advanceFlight = () => {
    if (!flight) return;
    const k = Math.min(1, (performance.now() - flight.startedAt) / flight.durationMs);
    const at = sampleFlight(flight.from, flight.to, flight.liftM, k);
    camera.position.copy(at.position);
    controls.target.copy(at.target);
    if (k >= 1) flight = null;
  };

  const material = createTerrainMaterial({
    ...assets,
    // Land cover fades out over this ring so the core arrives at its boundary in the same plain
    // elevation colour the shell starts from.
    transitionBandM: assets.shell?.transitionBandM ?? 0,
  });

  // Anisotropic filtering, which matters more here than anywhere else in the scene: the drape is a
  // ground plane almost always viewed at a grazing angle, and without it the middle distance turns
  // to mush exactly where the eye is looking for the treeline.
  if (assets.drapeTexture) {
    assets.drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    assets.drapeTexture.needsUpdate = true;
  }

  // One vertex per render-grid cell is millions of vertices — far too many. A 4x decimation keeps
  // the landform honest at 16 m posting while staying inside the §9.4 budget.
  const segmentsX = Math.floor(terrain.width / 4);
  const segmentsY = Math.floor(terrain.height / 4);
  const geometry = new THREE.PlaneGeometry(widthM, depthM, segmentsX, segmentsY);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // ── The horizon ──────────────────────────────────────────────────────────
  // Without this the terrain is a 9 km block floating in a void, which reads as a model of the
  // Allgäu rather than as the Allgäu. The shell continues the ground for another 30 km at a
  // thirtieth of the detail, and costs about a fortieth of the vertices.
  const { shell, shellTexture } = assets;
  let shellMesh: THREE.Mesh | null = null;
  let shellMaterial: THREE.ShaderMaterial | null = null;

  if (shell && shellTexture) {
    const shellWidthM = shell.width * shell.resolutionM;
    const shellDepthM = shell.height * shell.resolutionM;

    // Both grids are in UTM32 metres, so placing one against the other is subtraction. The world
    // origin is the centre of the CORE, which is what every camera position is relative to.
    const coreCentreE = terrain.origin.easting + widthM / 2;
    const coreCentreN = terrain.origin.northing + depthM / 2;
    const shellCentreE = shell.origin.easting + shellWidthM / 2;
    const shellCentreN = shell.origin.northing + shellDepthM / 2;

    const shellSegmentsX = Math.floor(shell.width / 3);
    const shellSegmentsY = Math.floor(shell.height / 3);
    const shellGeometry = new THREE.PlaneGeometry(
      shellWidthM,
      shellDepthM,
      shellSegmentsX,
      shellSegmentsY
    );
    shellGeometry.rotateX(-Math.PI / 2);

    shellMaterial = createShellMaterial({
      shell,
      shellTexture,
      core: terrain,
      coreTexture: assets.heightTexture,
      // The core rectangle in world metres. Northing increases north but +Z is south, so the z
      // minimum corresponds to the core's NORTH edge — getting this backwards puts the hole in the
      // shell on the wrong side of the map.
      coreRect: [-widthM / 2, -depthM / 2, widthM, depthM],
      // Deliberately the CORE's elevation range, not the shell's. The two must share a colour ramp
      // or the boundary shows up as a change of palette.
      elevationRangeM: { min: terrain.heightMinM, max: terrain.heightMaxM },
    });

    shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
    shellMesh.position.set(shellCentreE - coreCentreE, 0, -(shellCentreN - coreCentreN));
    // The shell is much larger than the camera's usual frustum test expects, and it is never worth
    // culling: it is the backdrop.
    shellMesh.frustumCulled = false;
    scene.add(shellMesh);
    console.info(
      `shell: ${shell.width}x${shell.height} at ${shell.resolutionM} m, ` +
        `seam offset ${shell.seamOffsetM.toFixed(2)} m`
    );
  } else {
    console.info('terrain shell not available — run tools/geodata/build_shell.py');
  }

  /**
   * The other sites in this world — PLAN §8.
   *
   * ⚠️ **Loaded after the scene is already running, not before it.** Both sites' assets ship, but a
   * session only needs the one you are looking at to draw the first frame; fetching the far core up
   * front would roughly double time-to-first-paint for a mountain 24 km away that is initially a
   * few pixels tall. So the near site renders, and the far one arrives behind it.
   *
   * Until it arrives the shell simply covers that ground, which is truthful rather than merely
   * tolerable: with no core loaded there, the shell IS the terrain. When it lands, the shell learns
   * about it (`addShellCore`) and stops drawing inside its rectangle.
   */
  const farCores = new Map<string, THREE.Group>();

  /**
   * The far sites' toggleable layers, and the toggle state to apply to them.
   *
   * ⚠️ **A layer switch has to mean the same thing everywhere in the world.** The near site's
   * layers are held in closures created before any far site exists, so without this the trees
   * button hid Oberstdorf's trees and left the Tegelberg's standing — the second site behaving
   * differently from the first, which is the exact failure this phase keeps producing.
   *
   * The state is remembered rather than read back off the layers because a far site can arrive
   * *after* a toggle: loading the Tegelberg with the trees already switched off must not turn them
   * back on.
   */
  const farLayers = new Map<
    string,
    {
      vegetation: VegetationLayer | null;
      cableway: CablewayLayer | null;
      material: THREE.ShaderMaterial;
    }
  >();
  const layerState = { trees: true, landuse: true, drape: true, cableway: true };
  /** Where the camera should sit to look at each far site, in this scene's world metres. */
  const siteViewpoints = new Map<string, Viewpoint>();

  async function loadFarCore(siteId: string): Promise<void> {
    if (siteId === aoiId || farCores.has(siteId) || !(siteId in AOIS)) return;

    const other = await loadTerrain(siteId, '/terrain', undefined, null);
    const o = other.terrain;
    const oWidthM = o.width * o.resolutionM;
    const oDepthM = o.height * o.resolutionM;

    if (other.drapeTexture) {
      other.drapeTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      other.drapeTexture.needsUpdate = true;
    }

    const otherMaterial = createTerrainMaterial({
      ...other,
      transitionBandM: shell?.transitionBandM ?? 0,
    });
    const otherGeometry = new THREE.PlaneGeometry(
      oWidthM,
      oDepthM,
      Math.floor(o.width / 4),
      Math.floor(o.height / 4)
    );
    otherGeometry.rotateX(-Math.PI / 2);
    const otherMesh = new THREE.Mesh(otherGeometry, otherMaterial);
    otherMesh.frustumCulled = false;

    // Everything is UTM32 metres, so a second core is placed against the first by subtraction.
    // This is the whole reason the world is tractable: no reprojection, no new origin.
    const coreCentreE = terrain.origin.easting + widthM / 2;
    const coreCentreN = terrain.origin.northing + depthM / 2;
    const otherCentreE = o.origin.easting + oWidthM / 2;
    const otherCentreN = o.origin.northing + oDepthM / 2;
    const offsetX = otherCentreE - coreCentreE;
    const offsetZ = -(otherCentreN - coreCentreN);

    /**
     * ⚠️ **A site is more than its terrain.**
     *
     * The first cut of this loaded the far core's heightmap and nothing else, so flying to the
     * Tegelberg arrived at a bare mountain: no buildings, no trees, no cable car, no names — while
     * Oberstdorf, being the near site, still had all four. It looked like the second site had been
     * stripped, and in effect it had.
     *
     * Every layer is authored relative to its OWN core centre with absolute elevations, so one
     * group at the offset carries all of them and nothing needs re-projecting. That is the same
     * property that made placing the core itself a subtraction.
     */
    const group = new THREE.Group();
    group.position.set(offsetX, 0, offsetZ);
    group.add(otherMesh);
    scene.add(group);
    farCores.set(siteId, group);

    if (shellMaterial) {
      addShellCore(shellMaterial, o, other.heightTexture, [
        offsetX - oWidthM / 2,
        offsetZ - oDepthM / 2,
        oWidthM,
        oDepthM,
      ]);
    }

    // A viewpoint over the far site, framed the same way the near one is: in from the south-east
    // and above, so the hillshade keeps lit faces towards the camera. The ground height comes from
    // that site's own places rather than being guessed — a camera target floating 800 m above the
    // valley floor is how a "flight" ends up looking like a jump.
    const farPlaces = [...o.focusPlaces, ...(o.flyingSites ?? [])];
    siteFrames.set(siteId, {
      places: farPlaces,
      offsetX,
      offsetZ,
      widthM: oWidthM,
      depthM: oDepthM,
    });

    const anchor = farPlaces[0];
    const groundM = anchor?.groundM ?? o.heightMinM;
    const targetX = anchor ? offsetX + (anchor.u - 0.5) * oWidthM : offsetX;
    const targetZ = anchor ? offsetZ + (anchor.v - 0.5) * oDepthM : offsetZ;
    const rangeM = Math.max(oWidthM, oDepthM) * 0.42;
    siteViewpoints.set(siteId, {
      target: new THREE.Vector3(targetX, groundM, targetZ),
      position: new THREE.Vector3(
        targetX + rangeM * 0.45,
        groundM + rangeM * 0.95,
        targetZ + rangeM * 0.65
      ),
    });

    console.info(
      `world: ${siteId} core ${o.width}x${o.height} at ` +
        `${(offsetX / 1000).toFixed(1)} km E, ${(-offsetZ / 1000).toFixed(1)} km N`
    );

    // The rest of the site. Each of these is optional in exactly the way it is for the near site —
    // a fresh clone runs without them — so each failure is reported and skipped rather than taking
    // the whole far site down with it.
    const far = { buildings: 0, trees: 0, cableways: 0 };
    let farVegetationLayer: VegetationLayer | null = null;
    let farCablewayLayer: CablewayLayer | null = null;

    try {
      const farBuildings = await loadBuildings(siteId, '/terrain');
      group.add(farBuildings.mesh);
      far.buildings = farBuildings.meta.count;
    } catch {
      // no LoD2 for this site
    }

    try {
      const farVegetation = await loadVegetation(siteId, '/terrain');
      if (farVegetation) {
        group.add(farVegetation.group);
        farVegetationLayer = farVegetation;
        far.trees = farVegetation.drawn;
      }
    } catch {
      // no canopy model for this site
    }

    try {
      const response = await fetch(`/terrain/${siteId}/cableway.json`);
      if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
        const data = (await response.json()) as CablewayData;
        const farCableway = createCablewayLayer(data);
        group.add(farCableway.group);
        farCablewayLayer = farCableway;
        far.cableways = data.lines.length;
      }
    } catch {
      // no cableway for this site
    }

    // Adopt whatever the layer switches currently say. A site that arrives after the viewer has
    // turned the trees off must arrive with them off.
    farLayers.set(siteId, {
      vegetation: farVegetationLayer,
      cableway: farCablewayLayer,
      material: otherMaterial,
    });
    farVegetationLayer?.setVisible(layerState.trees);
    farCablewayLayer?.setVisible(layerState.cableway);
    otherMaterial.uniforms.uShowLanduse.value = layerState.landuse ? 1 : 0;
    otherMaterial.uniforms.uShowDrape.value = layerState.drape ? 1 : 0;

    // Names, in world metres — the label layer lives outside the scene graph, so the group's
    // transform does not reach it and the offset has to be applied here.
    labels?.addAnchors(
      farPlaces.map((place) => ({
        id: `${siteId}:${place.id}`,
        text: place.name,
        kind: ('kind' in place && place.kind === 'landing'
          ? 'landing'
          : 'kind' in place
            ? 'launch'
            : 'place') as LabelAnchor['kind'],
        position: new THREE.Vector3(
          offsetX + (place.u - 0.5) * oWidthM,
          place.groundM,
          offsetZ + (place.v - 0.5) * oDepthM
        ),
      }))
    );

    console.info(
      `world: ${siteId} layers — ${far.buildings} buildings, ${far.trees} trees, ` +
        `${far.cableways} cableway lines, ${farPlaces.length} labels`
    );

    // ⚠️ Set only once the LAYERS are in, not when the core is. The bug this guards against was a
    // far site whose terrain had loaded perfectly and whose buildings, trees, cable car and names
    // had not — a site that was present and bare. An attribute that flipped on the heightmap would
    // have gone green for exactly that state. Owned by the scene, like `data-ready`, so it means
    // "this site is fully dressed" rather than "a promise resolved".
    renderer.domElement.dataset.worldSites = [aoiId, ...farCores.keys()].sort().join(',');
  }

  // Real LoD2 geometry, if it has been generated. The app still works without it, which keeps a
  // fresh clone runnable before the building mesh has been built.
  let buildings: BuildingLayer | null = null;
  try {
    buildings = await loadBuildings(aoiId, '/terrain', onProgress);
    scene.add(buildings.mesh);
    console.info(`LoD2: ${buildings.meta.count} buildings`);
  } catch {
    console.info('LoD2 buildings not available — run tools/geodata/build_lod2_mesh.py');
  }

  // Real trees, from the surface model minus the terrain model. Optional in the same way as the
  // buildings: a fresh clone runs without them, it just has bare hillsides.
  let vegetation: VegetationLayer | null = null;
  try {
    vegetation = await loadVegetation(aoiId, '/terrain', onProgress);
    if (vegetation) {
      scene.add(vegetation.group);
      console.info(`vegetation: ${vegetation.drawn} trees in ${vegetation.chunks} culling chunks`);
    }
  } catch {
    console.info('vegetation not available — run tools/geodata/build_vegetation.py');
  }

  // The Nebelhornbahn. Optional in the same way as the buildings and the trees.
  let cableway: CablewayLayer | null = null;
  try {
    const response = await fetch(`/terrain/${aoiId}/cableway.json`);
    if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
      const data = (await response.json()) as CablewayData;
      cableway = createCablewayLayer(data);
      scene.add(cableway.group);
      console.info(`cableway: ${data.lines.length} lines, ${data.stations.length} structures`);
    }
  } catch {
    console.info('cableway not available — run tools/geodata/build_cableway.py');
  }

  frame(terrain.focusPlaces[0]?.id ?? '');

  // ── Labels ─────────────────────────────────────────────────────────────────
  // A photoreal mountain with nothing named on it is a picture. The names are what let somebody
  // who knows the area confirm it is right, and somebody who does not orient themselves at all.
  const anchors: LabelAnchor[] = terrain.focusPlaces.map((place) => ({
    id: place.id,
    text: place.name,
    kind: 'place' as const,
    position: new THREE.Vector3(
      (place.u - 0.5) * widthM,
      place.groundM,
      (place.v - 0.5) * depthM
    ),
  }));

  for (const site of terrain.flyingSites ?? []) {
    anchors.push({
      id: site.id,
      text: site.name,
      kind: site.kind === 'landing' ? 'landing' : 'launch',
      position: new THREE.Vector3(
        (site.u - 0.5) * widthM,
        site.groundM,
        (site.v - 0.5) * depthM
      ),
    });
  }

  let labels: LabelLayer | null = null;
  if (labelHost) {
    labels = createLabelLayer(anchors);
    labelHost.appendChild(labels.element);
  }

  // ── Drone mode ──────────────────────────────────────────────────────────
  /**
   * Terrain elevation under a world position, in **real** metres.
   *
   * The heightmap is already in memory as the texture the shader samples, so this reads the same
   * array rather than raycasting the mesh — a raycast against 285 k vertices every frame to answer
   * "how high am I" would be absurd, and the mesh is a displaced plane whose displacement *is*
   * this array.
   *
   * Nearest-neighbour, matching the shader: the grid is measured data, and interpolating it would
   * invent elevations the survey never recorded (`terrainLoader.ts` makes the same point about
   * texture filtering).
   */
  const heightData = assets.heightTexture.image.data as Uint16Array;
  const groundAt = (x: number, z: number): number | null => {
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
    // The AOI is 30 km across with 1 400 m of relief, and the world joins two of them, so the top
    // of the range has to cross a valley in seconds while the bottom eases along a ridge line.
    cruiseMinMs: 25,
    cruiseMaxMs: 900,
    cruiseDefaultMs: 180,
    boost: 3,
    // ⚠️ This camera has always had mass and a stabilised gimbal, and losing them in the merge
    // would have been a silent change to how the whole app feels. Braking is quicker than
    // accelerating on purpose: coasting is what makes the camera feel like it weighs something,
    // but coasting *past* what you were trying to look at is just a fight.
    accelerateTauS: 0.28,
    brakeTauS: 0.16,
    lookTauS: 0.07,
    onEngagedChange: (engaged) => {
      // Anything else that drives the camera has to let go, or it fights the keys for it. The
      // viewer touching the camera outranks whatever the app was doing with it — which is the same
      // rule `cancelFlight` applies to a drag.
      if (engaged) {
        flight = null;
        followGlider = false;
        followLiveId = null;
        tour?.stop();
      }
      droneListener?.(engaged);
    },
  });

  // ── Guided tour ────────────────────────────────────────────────────────
  // Declared here but constructed on demand, because it needs a caption callback that only the
  // caller can supply.
  let tour: TourController | null = null;

  // ── The flight ──────────────────────────────────────────────────────────────
  const worldOrigin: WorldOrigin = {
    centreEasting: terrain.origin.easting + widthM / 2,
    centreNorthing: terrain.origin.northing + depthM / 2,
  };

  let trackLayer: TrackLayer | null = null;
  let headTime = 0;
  let followGlider = false;

  const clearTrack = () => {
    if (!trackLayer) return;
    scene.remove(trackLayer.group);
    trackLayer.dispose();
    trackLayer = null;
  };

  // ── Live traffic ────────────────────────────────────────────────────────────
  // Created up front and left empty rather than on first data: the relay is optional and often
  // absent, and an empty instanced mesh costs nothing to keep in the scene.
  const live: LiveLayer = createLiveLayer(worldOrigin);
  live.setVisible(false);
  scene.add(live.group);
  let followLiveId: string | null = null;

  /**
   * Webcams, for every site in the world at once — PLAN §5.9.
   *
   * Gathered from the AOI configs rather than from the scene's own site, because a world holds
   * several sites and a camera 24 km away is still a camera. Positions are absolute and projected
   * here, so this needs no per-site group and cannot be forgotten for the far core the way the
   * buildings and the trees were.
   */
  const webcamMarkers: WebcamMarker[] = (inWorld(aoiId) ? WORLD.sites : [aoiId])
    .filter((siteId) => siteId in AOIS)
    .flatMap((siteId) =>
      (AOIS[siteId].webcams ?? []).map((camera) => ({ ...camera, site: siteId }))
    );
  const webcams: WebcamLayer = createWebcamLayer(worldOrigin, webcamMarkers);
  scene.add(webcams.group);
  if (webcamMarkers.length) {
    console.info(
      `webcams: ${webcamMarkers.length} — ${webcamMarkers.map((c) => c.id).join(', ')}`
    );
  }

  /**
   * Click an aircraft to select it.
   *
   * ⚠️ On `click`, and only when the pointer did not move — not on `pointerdown`. The same canvas
   * is a camera control: dragging to orbit ends over whatever happens to be under the cursor, and
   * picking on press would open an aircraft every time the viewer turned the map. The 4-pixel
   * slop is for the hand that moves slightly while clicking.
   */
  let liveSelectListener: ((id: string | null) => void) | null = null;
  let webcamSelectListener: ((camera: WebcamMarker | null) => void) | null = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressX = 0;
  let pressY = 0;

  const onCanvasPointerDown = (event: PointerEvent) => {
    pressX = event.clientX;
    pressY = event.clientY;
  };

  const onCanvasClick = (event: MouseEvent) => {
    if (!liveSelectListener && !webcamSelectListener) return;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 4) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    // Webcams first: they are fixed, few, and always where the viewer left them, whereas an
    // aircraft under the cursor a moment ago may not be. A click that hits a camera is unambiguous.
    const hitCamera = webcams.pick(raycaster);
    if (hitCamera) {
      webcamSelectListener?.(hitCamera);
      return;
    }
    liveSelectListener?.(live.pick(raycaster));
  };

  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  canvas.addEventListener('click', onCanvasClick);

  const resize = () => {
    const width = canvas.clientWidth || 1280;
    const height = canvas.clientHeight || 720;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let animationHandle = 0;
  let lastFrameMs = performance.now();
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    const now = performance.now();
    // Clamped, because a backgrounded tab resumes with a delta of several seconds and the camera
    // would leave the AOI in a single frame.
    const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
    lastFrameMs = now;

    if (drone.engaged) {
      drone.update(dt);
    } else {
      advanceFlight();

      // Following overrides the orbit centre but not the orbit itself, so the viewer can still
      // turn around the glider while it moves. Taking the camera away entirely would be a cutscene.
      if (followGlider && trackLayer) {
        const glider = trackLayer.positionAt(headTime);
        const shift = glider.clone().sub(controls.target);
        controls.target.copy(glider);
        camera.position.add(shift);
      }

      // The same treatment for a live aircraft — except that it can vanish, because OGN coverage
      // is line-of-sight and a paraglider low in a side valley simply stops being heard. When that
      // happens the camera stays where it was rather than snapping to the origin.
      if (followLiveId) {
        const target = live.positionOf(followLiveId);
        if (target) {
          const shift = target.clone().sub(controls.target);
          controls.target.copy(target);
          camera.position.add(shift);
        }
      }
      controls.update();
    }

    live.update(camera);
    webcams.update(camera);

    // Haze is a function of how far the ground is from the eye, so both materials need to be told
    // where the eye is.
    material.uniforms.uCameraWorld.value.copy(camera.position);
    shellMaterial?.uniforms.uCameraWorld.value.copy(camera.position);
    sky.update(camera);
    renderer.render(scene, camera);
    labels?.update(camera, canvas);

    // Where the camera is, for the e2e specs. Published from here rather than asserted on pixels
    // because the terrain and water shaders animate: two consecutive frames are never identical,
    // so a screenshot can show that something changed but never that nothing did — which is
    // exactly what the hand-back has to prove.
    canvas.dataset.cam =
      `${camera.position.x.toFixed(2)},` +
      `${camera.position.y.toFixed(2)},` +
      `${camera.position.z.toFixed(2)}`;
  };
  tick();

  // Marker the e2e tests can assert on once the first frame has actually been drawn. Owned here
  // rather than in React, so it means "a frame exists" rather than "a state flag was set".
  renderer.domElement.dataset.ready = 'true';
  renderer.domElement.dataset.worldSites = aoiId;

  // Only now, with a frame on screen, fetch the rest of the world. Deliberately after `ready` and
  // deliberately not awaited: the near site is what the viewer is looking at, and the far core is
  // 24 km away and a few pixels tall until they ask to go there.
  if (inWorld(aoiId)) {
    for (const siteId of WORLD.sites) {
      if (siteId !== aoiId) void loadFarCore(siteId).catch(() => undefined);
    }
  }

  return {
    assets,
    buildings,
    worldOrigin,
    hasCableway: cableway !== null,
    hasDrape: assets.drapeTexture !== null,
    focusPlace(placeId: string) {
      flyTo(placeId);
    },
    setFlight(track: FlightTrack | null) {
      clearTrack();
      if (!track) return;
      trackLayer = createTrackLayer(track);
      headTime = track.durationS;
      trackLayer.setHeadTime(headTime);
      scene.add(trackLayer.group);
    },
    setFlightTime(seconds: number) {
      headTime = seconds;
      trackLayer?.setHeadTime(seconds);
    },
    setFollowGlider(follow: boolean) {
      followGlider = follow;
      // Grabbing the controls must not fight the follow camera, so a manual orbit while following
      // adjusts the view around the glider rather than being cancelled.
      if (follow && trackLayer) {
        const glider = trackLayer.positionAt(headTime);
        const shift = glider.clone().sub(controls.target);
        controls.target.copy(glider);
        camera.position.add(shift);
        controls.update();
      }
    },
    setLiveTraffic(aircraft) {
      live.setAircraft(aircraft);
    },
    setLiveVisible(visible: boolean) {
      live.setVisible(visible);
      if (!visible) followLiveId = null;
    },
    setFollowLive(id: string | null) {
      followLiveId = id;
      if (!id) return;
      const target = live.positionOf(id);
      if (!target) return;
      const shift = target.clone().sub(controls.target);
      controls.target.copy(target);
      camera.position.add(shift);
      controls.update();
    },
    onLiveSelect(listener) {
      liveSelectListener = listener;
    },
    onWebcamSelect(listener) {
      webcamSelectListener = listener;
    },
    setWebcamsVisible(visible: boolean) {
      webcams.setVisible(visible);
    },
    /**
     * Put the eye where the camera is, looking where it looks — PLAN §5.9.
     *
     * The comparison this feature exists for only works from the right spot: the viewer opens the
     * photograph and the model is already showing the same scene, so what this button owes the
     * viewer is the VIEW, not the marker.
     *
     * ⚠️ Standing behind the marker was the obvious reading of "camera position" and it was wrong
     * twice over, both caught by flying there rather than by reading the code. At 90 m back the
     * post filled the frame; at 45 m back the field-of-view wedge — 27 m of flat amber lying in
     * exactly the direction we want to look — spread across half the panorama. The wedge is a
     * label for someone looking at the camera from outside; from inside the camera's own viewpoint
     * it is only in the way. So the eye goes slightly IN FRONT of the marker, where the whole
     * marker falls behind the near plane and the view opens clean. The viewer has just clicked the
     * marker and the card names it, so nothing is lost by not seeing it again.
     */
    focusWebcam(id: string) {
      const marker = webcamMarkers.find((camera) => camera.id === id);
      if (!marker) return;
      const { easting, northing } = wgs84ToUtm32(marker.lon, marker.lat);
      const at = new THREE.Vector3(
        easting - worldOrigin.centreEasting,
        marker.eleM,
        -(northing - worldOrigin.centreNorthing)
      );
      const heading = THREE.MathUtils.degToRad(marker.bearingDeg);
      // North is -Z, east is +X.
      const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
      flyToView(
        {
          // 40 m clears the wedge, which reaches 3.4 × the marker's ~8 m floor scale.
          position: at.clone().addScaledVector(forward, 40).setY(marker.eleM + 6),
          target: at.clone().addScaledVector(forward, 2000).setY(marker.eleM - 150),
        },
        2200
      );
    },
    hasWebcams: webcamMarkers.length > 0,
    setVegetationVisible(visible: boolean) {
      layerState.trees = visible;
      vegetation?.setVisible(visible);
      for (const layer of farLayers.values()) layer.vegetation?.setVisible(visible);
    },
    /**
     * Fly to another site in the world — PLAN §8.
     *
     * Returns false when the site is not loaded yet, so the caller can say so instead of appearing
     * to do nothing. The camera does not move until there is somewhere to move to; a flight that
     * lands on ground still being fetched is worse than a moment's wait.
     */
    async flyToSite(siteId: string): Promise<boolean> {
      if (siteId === aoiId) {
        flyTo(allPlaces[0]?.id ?? '');
        return true;
      }
      if (!siteViewpoints.has(siteId)) await loadFarCore(siteId).catch(() => undefined);
      const view = siteViewpoints.get(siteId);
      if (!view) return false;
      // Slower than a within-site hop: this crosses 24 km of the shell, and the whole point is
      // that the ground between the two sites is continuous and visibly there.
      flyToView(view, 4200);
      return true;
    },
    /** Which sites currently have their core loaded — the near one always does. */
    loadedSites(): string[] {
      return [aoiId, ...farCores.keys()];
    },
    placesForSite(siteId: string) {
      return siteFrames.get(siteId)?.places ?? [];
    },
    setLanduseVisible(visible: boolean) {
      layerState.landuse = visible;
      material.uniforms.uShowLanduse.value = visible ? 1 : 0;
      for (const layer of farLayers.values()) {
        layer.material.uniforms.uShowLanduse.value = visible ? 1 : 0;
      }
    },
    setDrapeVisible(visible: boolean) {
      layerState.drape = visible;
      material.uniforms.uShowDrape.value = visible ? 1 : 0;
      for (const layer of farLayers.values()) {
        layer.material.uniforms.uShowDrape.value = visible ? 1 : 0;
      }
    },
    setCablewayVisible(visible: boolean) {
      layerState.cableway = visible;
      cableway?.setVisible(visible);
      for (const layer of farLayers.values()) layer.cableway?.setVisible(visible);
    },
    setDroneMode(on: boolean) {
      // Everything this used to do — disabling OrbitControls, adopting the current orientation,
      // deriving an orbit centre on the way back out — now lives in `flyControls.ts`, because it
      // has to happen on a keypress as well as on a click and there must be exactly one copy of it.
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
    setLabelsVisible(visible: boolean) {
      labels?.setVisible(visible);
    },
    startTour(onCaption) {
      tour?.stop();
      // Free flight and the tour cannot both own the camera. The tour wins, because starting it is
      // an explicit request to be driven — and handing back here goes through the latch, so the
      // orbit centre is derived properly rather than left wherever the flight ended.
      drone.setEngaged(false);
      followGlider = false;
      tour = createTour({
        places: allPlaces,
        flyTo: (placeId, rangeM) => flyTo(placeId, rangeM),
        onCaption,
        onEnd: () => {
          tour = null;
        },
      });
      tour.start();
    },
    stopTour() {
      tour?.stop();
      tour = null;
    },
    dispose() {
      cancelAnimationFrame(animationHandle);
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      canvas.removeEventListener('click', onCanvasClick);
      controls.removeEventListener('start', cancelFlight);
      controls.dispose();
      window.removeEventListener('resize', resize);
      clearTrack();
      tour?.stop();
      vegetation?.dispose();
      cableway?.dispose();
      live.dispose();
      webcams.dispose();
      sky.dispose();
      drone.dispose();
      droneListener = null;
      labels?.dispose();

      // The far sites. Each holds a heightmap, a drape, up to 230 000 tree instances and a
      // building mesh — by far the largest thing in the scene after the near site, and none of it
      // is reachable from the near-site variables above.
      for (const layer of farLayers.values()) {
        layer.vegetation?.dispose();
        layer.cableway?.dispose();
        layer.material.dispose();
      }
      for (const group of farCores.values()) {
        group.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
            object.geometry.dispose();
          }
        });
        scene.remove(group);
      }
      farLayers.clear();
      farCores.clear();

      shellMesh?.geometry.dispose();
      shellMaterial?.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
