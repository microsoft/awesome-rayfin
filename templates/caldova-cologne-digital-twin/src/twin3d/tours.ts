import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';
import { buildDayEvents, firstCoreStopSlot, type DayEvent, type TourTiming } from './dayEvents';
import { NIGHT_GLSL, nightUniforms } from './nightLighting';
import { createTruckGeometry, createVanGeometry, VAN_PART_GLSL } from './vanModel';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_TINT } from './terrainMaterial';
import type { OperationsMeta } from './dcInterior';

/**
 * The last mile: the tours that leave the docks and the pharmacies they serve.
 *
 * ⚠️ WHAT IS REAL HERE AND WHAT IS NOT. Every drop point is a REAL pharmacy, at its real
 * coordinate, from OpenStreetMap, sampled within the delivery radius. The ground beneath them is
 * measured. The TOURS are a model: which pharmacies a wholesaler serves is not public, and the
 * routes follow the real road network but are not an optimisation. Nothing in the UI may claim
 * that a named pharmacy is a customer of any real wholesaler, and nothing may call these routes
 * optimised — a real tour is built from time windows, cage capacity and road speed, none of which
 * this has.
 *
 * ⚠️ THE REGION IS 22x THE PHOTOREAL CORE. The core is 2 km across; the drops reach 22 km out.
 * Everything here is therefore positioned against `groundAnywhere`, which falls back to the
 * measured Copernicus shell rather than to a flat constant — see the note on it in `scene.ts`.
 */

export interface Tour {
  tourId: string;
  wave: number;
  waveTime: string;
  departSlot: number;
  returnSlot: number;
  drops: number;
  lines: number;
  distanceKm: number;
  kmPerDrop: number;
  onTimeDrops: number;
  vehicleId: string;
  vehicleType: 'diesel' | 'electric';
  gCo2: number;
  withinEvRange: boolean;
  pharmacyIds: string[];
  /**
   * The line the van drives, as [lat, lon].
   *
   * ⚠️ WITH A ROAD GRAPH THIS IS ROAD GEOMETRY, NOT A LIST OF CUSTOMERS. It used to be exactly the
   * stops, so every point was a delivery and the van drove between them in straight lines — across
   * the Rhine, through the rail yards, over farmland. Now most points are junctions and bends, and
   * `stopIndices` says which of them are deliveries. Anything that treats a path point as a
   * customer will silently invent hundreds of them.
   */
  path: number[][];
  /**
   * 7.5 t truck or Sprinter-size van (the heaviest third of the tours by order lines get the truck).
   * Absent in builds before the Cologne twin, which means van.
   */
  vehicleClass?: 'truck' | 'van';
  /** Indices into `path` where a delivery happens. Absent in pre-routing builds. */
  stopIndices?: number[];
  /** Whether this tour was routed on the real network or fell back to straight lines. */
  routed?: boolean;
}

export interface TourLayer {
  group: THREE.Group;
  /**
   * Move the whole layer to a moment in the operating day.
   *
   * ⚠️ FRACTIONAL, NOT AN INTEGER SLOT. The first version took a whole quarter-hour, so the vans
   * only moved when the slot changed — they teleported between positions in fifteen-minute jumps
   * and it read as a broken animation rather than as a coarse one. Driving is continuous; the
   * quarter-hour grid is the DATA's resolution, not the picture's.
   */
  setTime(fractionalSlot: number): void;
  /** How many tours are on the road at the current moment — a witness, not a guess. */
  activeTours(): number;
  /** How many vans are standing at a pharmacy right now, unloading. */
  vansAtStop(): number;
  /**
   * How far the furthest van on the road is from the warehouse, in metres.
   *
   * Drives the night reveal. Measured from the VEHICLES rather than from a timer, so the fog can
   * never retreat past a van that has not got there yet — the picture cannot contradict itself.
   */
  reachRadius(): number;
  /**
   * The layer's own shading materials, so the shared night state can reach them.
   * Returned rather than applied internally: darkness has one writer, in `nightLighting`.
   */
  nightMaterials(): THREE.ShaderMaterial[];
  /**
   * Called whenever the set of pharmacies currently being delivered to changes.
   * Indices are into the pharmacy list, in `meta.pharmacies` order.
   */
  onServedChanged(handler: (served: number[]) => void): void;
  /** Every pharmacy in the model, in the order the indices above refer to. */
  pharmacyPoints(): { id: string; name: string; lat: number; lon: number }[];
  /**
   * Recolour the fleet for a what-if scenario: these tour ids run electric, the rest diesel.
   *
   * ⚠️ THE MAP HAS TO AGREE WITH THE ARITHMETIC. The panel can compute a saving for "the twelve
   * shortest tours" perfectly well without the picture changing at all, and then the viewer is
   * looking at a map of a different scenario from the one the numbers describe. Passing null puts
   * every tour back to the vehicle type the operating model actually assigned it.
   */
  setElectrified(tourIds: Set<string> | null): void;
  /** The tours as the what-if lens needs them: id, distance, current type, range fit. */
  fleet(): { tourId: string; distanceKm: number; vehicleType: 'diesel' | 'electric'; withinEvRange: boolean }[];
  /**
   * The named moments of the operating day.
   *
   * Derived from the SAME timelines the vans are animated along, so a marker saying "first
   * delivery" cannot point at a minute where no van is standing anywhere.
   */
  dayEvents(): DayEvent[];
  /**
   * When a van is first standing at a pharmacy inside the photoreal core, or null if none is.
   * The one moment where riding along has a modelled city around it.
   */
  cityDeliverySlot(): number | null;
  /** How many vans are inside the photoreal core right now — where a ride-along has a city in it. */
  activeInCore(): number;
  /** Where a van is right now, or null if that tour is not out OR is in a tunnel. */
  vanPosition(index: number): THREE.Vector3 | null;
  /** Whether a tour is on the road right now (true also while it is in a tunnel). */
  tourActive(index: number): boolean;
  /** The tour closest to a world point that is currently on the road, or -1. */
  nearestActiveTour(x: number, z: number): number;
  /** How many pharmacy drop points are drawn (real coordinates, fictional names in Cologne). */
  dropCount(): number;
  /** How many tour paths were built. */
  tourCount(): number;
  setVisible(visible: boolean): void;
  visible(): boolean;
  /** 0 by day, 1 in the deep of the night. Drives the scene's own dimming. */
  nightFactor(): number;
  bounds: { centre: THREE.Vector3; radiusM: number };
  dispose(): void;
}

/** Slots per day, matching the generator's 15-minute grid. */
const SLOTS = 96;

/**
 * The moment the app opens on: 09:00.
 *
 * ⚠️ DELIBERATE, AND IT USED TO BE ACCIDENTAL. The clock defaulted to slot 0 — midnight — which
 * was harmless only because the night did not reach the picture: the panel said 00:00 and NIGHT
 * while the scene rendered broad daylight. With the night actually rendering, inheriting slot 0
 * opens the app on a near-black frame and hides the 5 538 measured buildings and the 20 cm
 * orthophoto that are the reason the site is worth looking at.
 *
 * Opening in daylight and letting the viewer play or scrub INTO the night keeps both: the site is
 * legible on arrival, and the night is something the demo arrives at rather than starts inside.
 */
export const OPENING_SLOT = 36;

/**
 * How far above the baked road height a vehicle stands.
 *
 * ⚠️ 0.35 m, MEASURED, NOT 6 m. The engine floated paths and vans 6 m up to clear terrain
 * z-fighting, which at 1:1 scale is a van hovering at first-floor height. Heights now come from the
 * path itself (DGM1, bridge decks interpolated, tunnels below ground — build_road_graph.py), and
 * the photogrammetric road surface sits +0.27..+0.41 m above DGM1 (verify_mesh_registration.py).
 */
const VEHICLE_LIFT_M = 0.35;
/** The route ribbon sits just above the vehicle's wheels so it never flickers in the asphalt. */
const RIBBON_LIFT_M = 0.6;
/** Markers (pharmacy pins) are UI, not objects: they keep a lift of their own above the ground. */
const MARKER_LIFT_M = 6;

/**
 * How much of a tour is spent standing at pharmacies rather than driving between them.
 *
 * ⚠️ A MODEL, and a high one on purpose. In urban delivery the vehicle is stationary for a large
 * share of the round — park, sign, unload the cage, get back in. It is set high enough that the
 * STOPPING is visible at a glance, because "where do they have to stop" is the question this layer
 * is answering; a physically tuned 12 % would be almost invisible at regional zoom.
 */
const DWELL_SHARE = 0.4;

const COLOUR_DIESEL = new THREE.Color('#c9762f');
const COLOUR_ELECTRIC = new THREE.Color('#12b886');

/** Van body colours. Diesel is deliberately duller than its path so the vehicle reads as a vehicle. */
const VAN_DIESEL = new THREE.Color('#f0e3d2');

/**
 * Radius around the site within which the ground is photoreal. Cologne: the whole delivery ring is
 * NRW 3D-Mesh (fine core + 4.9 m ring), so every vehicle on a tour is inside it.
 */
const CORE_RADIUS_M = 6500;
/** Radius of the fine (0.25–1.6 m) mesh core around the site — street level reads real here. */
const FINE_CORE_RADIUS_M = 1500;

/** A pharmacy waiting for its delivery, and one with a van standing at it. */
const DROP_IDLE = new THREE.Color('#8fd3ff');
const DROP_LIT = new THREE.Color('#ffd166');
const DROP_IDLE_SCALE = new THREE.Vector3(1, 1, 1);
const DROP_LIT_SCALE = new THREE.Vector3(2.1, 2.6, 2.1);

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/**
 * Where a tour is in its round, as a fraction, at a fractional quarter-hour.
 *
 * ⚠️ THE DAY WRAPS. The evening wave departs at 16:45 and returns after midnight, so `returnSlot`
 * can be numerically SMALLER than `departSlot`. Treating that as "already finished" would make the
 * late wave never appear, and the bug would look like missing data rather than modular arithmetic.
 */
export function tourProgress(slot: number, departSlot: number, returnSlot: number): number | null {
  const span = (returnSlot - departSlot + SLOTS) % SLOTS;
  if (span === 0) return null;
  const since = ((slot - departSlot) % SLOTS + SLOTS) % SLOTS;
  if (since > span) return null;
  return since / span;
}

/**
 * A tour's timeline: alternating drive legs and stops.
 *
 * Built once per route so that positioning a van at a moment is a lookup rather than a rebuild.
 * Units are arbitrary and only ever compared with each other — a drive leg costs its length, a
 * stop costs a share of the whole round.
 */
export interface RouteEvent {
  kind: 'drive' | 'dwell';
  /** Index into the route's point list. For a drive, the leg starts here. */
  index: number;
  duration: number;
  /** Cumulative duration at the START of this event. */
  start: number;
}

export function buildTimeline(
  legLengths: number[],
  dwellShare: number,
  stopAt?: Iterable<number>
): {
  events: RouteEvent[];
  total: number;
} {
  const driving = legLengths.reduce((sum, l) => sum + l, 0);
  // ⚠️ WHICH POINTS ARE CUSTOMERS IS NOW TOLD, NOT ASSUMED. This used to put a stop at the end of
  // every leg except the last, which was right only while a path point WAS a delivery. On a routed
  // path most points are junctions, and that rule would have the van pausing at every bend in the
  // road — around 1 400 stops on a 17-drop round.
  const stops = stopAt
    ? new Set([...stopAt].filter((i) => i >= 1 && i <= legLengths.length))
    : new Set(Array.from({ length: Math.max(legLengths.length - 1, 0) }, (_, i) => i + 1));
  const stopCount = stops.size;
  // Total dwell is a share of the WHOLE round, so a long tour and a short one both look like
  // delivery rounds rather than the short one looking like a single errand.
  const dwellEach = stopCount > 0 && dwellShare > 0 && dwellShare < 1
    ? (driving * dwellShare) / ((1 - dwellShare) * stopCount)
    : 0;

  const events: RouteEvent[] = [];
  let cursor = 0;
  legLengths.forEach((length, i) => {
    events.push({ kind: 'drive', index: i, duration: Math.max(length, 1e-6), start: cursor });
    cursor += Math.max(length, 1e-6);
    if (dwellEach > 0 && stops.has(i + 1)) {
      events.push({ kind: 'dwell', index: i + 1, duration: dwellEach, start: cursor });
      cursor += dwellEach;
    }
  });
  return { events, total: cursor };
}

/**
 * How dark it is, 0..1, from the quarter-hour of the day.
 *
 * A model of a German night rather than an almanac: full dark before 05:00 and after 21:00, with
 * an hour of twilight either side. The demo opens at 03:40 because that is when this business is
 * busiest, and the scene has to look like it.
 */
export function nightAt(slot: number): number {
  const hour = (slot * 15) / 60;
  if (hour >= 5.5 && hour <= 20.5) return 0;
  if (hour > 20.5) return Math.min(1, (hour - 20.5) / 1.5);
  if (hour < 4.5) return 1;
  return Math.max(0, 1 - (hour - 4.5) / 1.0);
}

/** "21:00" as a fractional quarter-hour, or null when nothing was declared. */
export function clockToSlot(clock: string | undefined | null): number | null {
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60 + minutes) / 15;
}

export function createTourLayer(
  meta: OperationsMeta,
  ext: WorldExtent,
  groundAnywhere: (x: number, z: number) => number,
  hub: { lat: number; lon: number },
  /**
   * The declared shift pattern, straight from the AOI config.
   *
   * ⚠️ PASSED IN, NOT GUESSED. `operations.json` does not carry the shift pattern — it has zones,
   * slots, tours and pharmacies and nothing about the roster — so deriving "night picking starts
   * at 21:00" inside this file would have meant hard-coding a number the config already owns, and
   * the two would drift the first time anyone edited the config.
   */
  shift?: { nightPickStart?: string } | null
): TourLayer | null {
  const tours = (meta.tours ?? []) as unknown as Tour[];
  if (!tours.length) return null;

  const group = new THREE.Group();
  group.name = 'dc-tours';
  group.visible = false;

  // Same sun the ground is shaded by — see the note in dcInterior.ts. This scene has no lights of
  // its own once real terrain is loaded.
  const sunDirection = new THREE.Vector3(...SUN_DIRECTION).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_TINT), 1.1);
  sun.position.copy(sunDirection).multiplyScalar(3000);
  group.add(sun);
  group.add(
    new THREE.HemisphereLight(new THREE.Color(...SUN_TINT), new THREE.Color(...SHADOW_TINT), AMBIENT)
  );

  /** A road point at its baked height (the path's third value), or on the terrain if absent. */
  const world = (lat: number, lon: number, height?: number): THREE.Vector3 => {
    const p = toWorld(lon, lat, ext, 0);
    const y = height !== undefined && Number.isFinite(height) ? height : groundAnywhere(p.x, p.z);
    return new THREE.Vector3(p.x, y + VEHICLE_LIFT_M, p.z);
  };
  const marker = (lat: number, lon: number): THREE.Vector3 => {
    const p = toWorld(lon, lat, ext, 0);
    return new THREE.Vector3(p.x, groundAnywhere(p.x, p.z) + MARKER_LIFT_M, p.z);
  };

  /** The site itself (the Confex): the centre of the fades and of the reach radius. */
  const hubPoint = marker(hub.lat, hub.lon);

  // ── the drop points ───────────────────────────────────────────────────────────────────────────
  // Real pharmacies. Emissive so they read against a dark region at night without needing a light.
  const pharmacies = meta.pharmacies ?? [];
  const dropGeometry = new THREE.ConeGeometry(38, 90, 5);
  // Flat and unlit rather than a standard material: these are markers, and at region range a
  // shaded cone is indistinguishable from a flat one anyway. Graded by the night like everything
  // else, so a pharmacy the wave has not reached stays under the fog with the street it is on.
  const dropMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uPinScale: { value: 0.00022 }, ...nightUniforms() },
    vertexShader: /* glsl */ `
      uniform float uPinScale;
      out vec3 vColour;
      out vec3 vWorld;
      void main() {
        vColour = instanceColor;

        // ⚠️ SIZED ON SCREEN, NOT IN METRES. At a fixed 38 m radius these cones were legible from
        // 22 km and absurd from 200 m — a pin three times the height of the 12 m building it was
        // pointing at, hiding the roof entirely. Scaling with range to the camera keeps a pin
        // roughly the same size in the PICTURE at every distance.
        //
        // ⚠️ AND THE CONSTANT MATTERS. The first attempt used 0.055, which saturates the upper
        // clamp for anything past 30 m — so every pin sat at maximum size and the fix made the
        // problem worse, not better. The factor is a screen fraction: a pin of about 8 px on a
        // 900 px viewport at 50 degrees is 0.0083 of the range, over a 38 m geometry radius.
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float range = distance(anchor.xyz, cameraPosition);
        float scale = clamp(range * uPinScale, 0.08, 3.0);
        vec4 world = modelMatrix * instanceMatrix * vec4(position * scale, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vColour;
      in vec3 vWorld;
      out vec4 fragColor;

      ${NIGHT_GLSL}

      void main() {
        fragColor = vec4(nightGrade(vColour, vWorld), 1.0);
      }
    `,
  });
  const drops = new THREE.InstancedMesh(dropGeometry, dropMaterial, Math.max(pharmacies.length, 1));
  drops.name = 'tour-drops';
  /** Where each pharmacy marker sits, kept so it can be re-scaled when a van is standing there. */
  const dropPositions: THREE.Vector3[] = [];
  /**
   * Pharmacy id → marker index, so a tour's stop can find the marker it belongs to.
   *
   * ⚠️ BY ID, NOT BY COORDINATE. The previous version keyed on rounded lat/lon, which worked only
   * while a tour's path point WAS the pharmacy's own coordinate. Once tours are routed, a stop
   * sits on the nearest road node instead — tens of metres away — and every coordinate lookup
   * returns nothing, so no marker lights up and no building turns amber. Nothing errors.
   */
  const dropById = new Map<string, number>();
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    pharmacies.forEach((p, i) => {
      const w = marker(p.lat, p.lon);
      const at = new THREE.Vector3(w.x, w.y + 45, w.z);
      dropPositions.push(at);
      if (p.id) dropById.set(p.id, i);
      m.compose(at, q, DROP_IDLE_SCALE);
      drops.setMatrixAt(i, m);
      drops.setColorAt(i, DROP_IDLE);
    });
    drops.instanceMatrix.needsUpdate = true;
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
  }
  group.add(drops);

  // ── the tour paths ────────────────────────────────────────────────────────────────────────────
  //
  // One merged ribbon for all tours, coloured per vertex by vehicle type. Merged because 31
  // separate meshes is 31 draw calls for something that never changes; coloured by vehicle rather
  // than by wave because diesel-versus-electric is the question the sustainability lens asks, and
  // the picture should already be answering it.
  const positions: number[] = [];
  const offsets: number[] = [];
  const colours: number[] = [];
  interface Route {
    points: THREE.Vector3[];
    /** True where the point is underground (a tunnel interior): the vehicle is not drawn there. */
    hidden: boolean[];
    /** Marker index for each point, or -1 for the warehouse at either end. */
    dropIndex: number[];
    events: RouteEvent[];
    total: number;
    tour: Tour;
    /** First vertex of this route in the merged ribbon, so one tour can be recoloured. */
    vertexStart: number;
    vertexCount: number;
  }
  const routes: Route[] = [];

  for (const tour of tours) {
    // ⚠️ THE ROUND STARTS AND ENDS ON THE ROAD, NOT IN THE BUILDING. The engine prepended the site
    // centroid, so every van drove the last 70 m through the Confex wall. The first and last path
    // points ARE the hub's road node; they are repeated (a zero-length leg) so `stopIndices + 1`
    // still lines up with `points`.
    const roadPoints = tour.path.map(([lat, lon, h]) => world(lat, lon, h));
    const first = roadPoints[0] ?? hubPoint.clone();
    const last = roadPoints[roadPoints.length - 1] ?? hubPoint.clone();
    const points = [first.clone(), ...roadPoints, last.clone()];
    const hidden = [false, ...tour.path.map((q) => q.length > 3 && q[3] === 1), false];
    // ⚠️ STOPS ARE NAMED BY THE DATA, AND LINKED BY ID RATHER THAN BY COORDINATE. Matching a stop
    // to its pharmacy by rounded lat/lon worked only while a path point WAS the pharmacy. A routed
    // stop sits on the nearest ROAD NODE, tens of metres away, so coordinate matching silently
    // returns nothing and no marker ever lights up.
    //
    // The +1 is the warehouse prepended above: `stopIndices` indexes `path`, `points` has the
    // hub in front of it.
    const declared = tour.stopIndices;
    const stopPointIndices = declared
      ? declared.map((i) => i + 1)
      : tour.path.map((_p, i) => i + 1);
    const dropIndex = new Array<number>(points.length).fill(-1);
    stopPointIndices.forEach((pointIndex, order) => {
      const id = tour.pharmacyIds?.[order];
      const marker = id !== undefined ? dropById.get(id) : undefined;
      if (pointIndex >= 0 && pointIndex < dropIndex.length) {
        dropIndex[pointIndex] = marker ?? -1;
      }
    });
    const legLengths: number[] = [];
    for (let i = 1; i < points.length; i += 1) legLengths.push(points[i].distanceTo(points[i - 1]));
    const { events, total } = buildTimeline(legLengths, DWELL_SHARE, stopPointIndices);
    // ⚠️ WHERE THIS ROUTE'S VERTICES START, RECORDED WHILE IT IS BEING BUILT. The what-if lens
    // recolours individual tours, and the ribbon is ONE merged mesh — without knowing which slice
    // of the colour buffer belongs to which tour, recolouring means either rebuilding the whole
    // mesh on every slider step or repainting the wrong route.
    const route: Route = {
      points,
      hidden,
      dropIndex,
      events,
      total,
      tour,
      vertexStart: colours.length / 3,
      vertexCount: 0,
    };
    routes.push(route);

    const colour = tour.vehicleType === 'electric' ? COLOUR_ELECTRIC : COLOUR_DIESEL;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      if (len < 1) continue;
      dir.divideScalar(len);
      // Side vector in the ground plane. A path drawn on the terrain has no meaningful roll.
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      // ⚠️ THE RIBBON'S WIDTH IS DECIDED IN THE SHADER, NOT BAKED IN HERE.
      //
      // It used to be a fixed 26 m, chosen so a route was legible from 22 km. That was fine while
      // routes were straight lines drawn over open country. Now they follow actual streets — and a
      // 26 m band laid over a 6 m residential street covers the street, the pavement and half the
      // houses either side, which is absurd exactly where the app now invites you to ride along.
      //
      // Each vertex therefore stores the CENTRELINE point plus the unit directions it must be
      // pushed along; the width in metres is computed per frame from the range to the camera.
      // ⚠️ The tangent term is what closes the wedge-shaped gap at every bend — consecutive quads
      // have to OVERLAP, and since the overlap must scale with the width, it cannot be baked
      // either. This engine has shipped a route that read as a row of tiles once already.
      const push = (
        point: THREE.Vector3,
        sideSign: number,
        tangentSign: number
      ): void => {
        positions.push(point.x, point.y + RIBBON_LIFT_M - VEHICLE_LIFT_M, point.z);
        offsets.push(side.x * sideSign, side.z * sideSign, dir.x * tangentSign, dir.z * tangentSign);
        colours.push(colour.r, colour.g, colour.b);
      };

      push(a, 1, -1);
      push(a, -1, -1);
      push(b, 1, 1);
      push(a, -1, -1);
      push(b, -1, 1);
      push(b, 1, 1);
    }
    route.vertexCount = colours.length / 3 - route.vertexStart;
  }

  const pathGeometry = new THREE.BufferGeometry();
  pathGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // x/y are the sideways unit direction, z/w the along-track one. Both in the ground plane.
  pathGeometry.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 4));
  // ⚠️ `aColour`, not the built-in `color`. Three.js only declares the `color` attribute for a
  // ShaderMaterial when it decides the material wants vertex colours; naming the attribute makes
  // the contract explicit instead of depending on that internal.
  pathGeometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colours, 3));
  //
  // ⚠️ THE ROUTES OBEY THE NIGHT TOO. Left as a plain unlit material, all thirty-one routes were
  // drawn at full brightness at 02:00 — a complete map of the region's night, on screen before a
  // single van had left the yard. The fog is meant to be pulled back BY the tours; a network that
  // is already fully visible gives the ending away and contradicts the sleeping city behind it.
  const pathMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uOpacity: { value: 0.55 },
      // Half-width as a fraction of range, then clamped. About 3 px on a 900 px viewport, so a
      // route stays a line at 22 km without becoming a carpet at 200 m.
      uWidthScale: { value: 0.003 },
      uWidthClamp: { value: new THREE.Vector2(1.6, 70) },
      ...nightUniforms(),
    },
    vertexShader: /* glsl */ `
      in vec3 aColour;
      in vec4 aOffset;
      uniform float uWidthScale;
      uniform vec2 uWidthClamp;
      out vec3 vColour;
      out vec3 vWorld;
      void main() {
        vColour = aColour;
        vec4 centre = modelMatrix * vec4(position, 1.0);
        float range = distance(centre.xyz, cameraPosition);
        // ⚠️ NOT NAMED "half" — that is a RESERVED WORD in GLSL ES, and using it fails the shader
        // at link time with "VALIDATE_STATUS false" and no line number. The route silently stopped
        // being drawn at all.
        float halfWidth = clamp(range * uWidthScale, uWidthClamp.x, uWidthClamp.y);
        vec3 world = centre.xyz
          + vec3(aOffset.x, 0.0, aOffset.y) * halfWidth
          + vec3(aOffset.z, 0.0, aOffset.w) * halfWidth;
        vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uOpacity;
      in vec3 vColour;
      in vec3 vWorld;
      out vec4 fragColor;

      ${NIGHT_GLSL}

      void main() {
        vec3 colour = nightGrade(vColour, vWorld);
        // Fade the ribbon out with the fog as well as darkening it, so an unreached route does
        // not sit as a dark smear over the ground it has not been driven on yet.
        float d = distance(vWorld.xz, uSpotCentre);
        float reached = 1.0 - smoothstep(uReveal, uReveal + uRevealSoft, d);
        float visible = clamp(max(reached, 1.0 - uNight), 0.0, 1.0);

        // ⚠️ AND FADE THEM OUT AT THE WAREHOUSE. All thirty-one routes begin at the same point, so
        // within a couple of hundred metres of it thirty-one 26 m ribbons overlap into a solid
        // beige disc roughly 500 m across, sitting on top of the site the app exists to show. The
        // routes carry no information there anyway — every one of them is in the same place.
        // uSpotCentre is the hub, which is why it is reused here.
        float hubFade = smoothstep(70.0, 280.0, d);

        fragColor = vec4(colour, uOpacity * mix(0.12, 1.0, visible) * hubFade);
      }
    `,
  });
  const pathMesh = new THREE.Mesh(pathGeometry, pathMaterial);
  pathMesh.name = 'tour-paths';
  group.add(pathMesh);

  // ── the vans ──────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ SIZED BY RANGE, BECAUSE ONE SIZE CANNOT WORK. A real 6 m van at a 22 km framing is a third
  // of a pixel — invisible, which is a worse falsehood than drawing it big. But a fixed 240 m van
  // is TWICE THE LENGTH OF THE WAREHOUSE, and riding along beside one showed exactly that: a beige
  // slab filling the screen. So the van is near life-size when the camera is close enough to judge
  // it, and grows with distance to stay visible when it is not. Position and timing are always to
  // the model; only the size is a drawing decision.
  const vanGeometry = createVanGeometry();
  const vanMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION).normalize() },
      // ⚠️ SCALE IS A MULTIPLE OF LIFE SIZE NOW, NOT AN ABSOLUTE LENGTH. The geometry is a real
      // 6 m van, so 1.0 means 6 m and 40.0 means the 240 m needed to stay visible from 22 km. The
      // old numbers were fractions of a 240 m box, which meant the "life-size" floor was a
      // magic 0.05 that nothing could check.
      // ⚠️ STRICT 1:1. The engine grew vans up to 40x with camera range
      // so they stayed visible from 22 km; a vehicle is an object and is never exaggerated here.
      // Findability is the glow's job, which is a marker and may scale.
      uVanScale: { value: 0.0 },
      uVanScaleRange: { value: new THREE.Vector2(1.0, 1.0) },
      ...nightUniforms(),
    },
    vertexShader: /* glsl */ `
      uniform float uVanScale;
      uniform vec2 uVanScaleRange;
      in float aPart;
      out vec3 vColour;
      out vec3 vWorld;
      out vec3 vNormalW;
      out float vPart;
      void main() {
        vColour = instanceColor;
        vPart = aPart;
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float range = distance(anchor.xyz, cameraPosition);
        float scale = clamp(range * uVanScale, uVanScaleRange.x, uVanScaleRange.y);
        vec4 world = modelMatrix * instanceMatrix * vec4(position * scale, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uSunDirection;
      in vec3 vColour;
      in vec3 vWorld;
      in vec3 vNormalW;
      in float vPart;
      out vec4 fragColor;

      ${NIGHT_GLSL}
      ${VAN_PART_GLSL}

      void main() {
        float emissive;
        vec3 base = vanPartColour(vPart, vColour, emissive);
        float lambert = clamp(dot(normalize(vNormalW), uSunDirection), 0.0, 1.0);
        vec3 colour = base * (0.55 + 0.45 * lambert);
        colour = nightGrade(colour, vWorld);
        // A van at work at 03:00 keeps its lights on: without this the fleet disappears into the
        // moonlight floor exactly when the story is about the night shift. The lamps carry most of
        // it, which is also what makes the direction of travel readable in the dark.
        colour += base * (0.22 + 0.9 * emissive) * uNight;
        fragColor = vec4(colour, 1.0);
      }
    `,
  });
  const vans = new THREE.InstancedMesh(vanGeometry, vanMaterial, Math.max(routes.length, 1));
  // Named so the render gate can find them and read their matrices back out of the live scene.
  vans.name = 'tour-vans';
  // The 7.5 t trucks: same material, same yaw convention, their own geometry. Every route has a
  // slot in BOTH meshes; the one that does not drive this tour is parked off-world.
  const trucks = new THREE.InstancedMesh(createTruckGeometry(), vanMaterial, Math.max(routes.length, 1));
  trucks.name = 'tour-trucks';
  const isTruck = routes.map((route) => route.tour.vehicleClass === 'truck');
  routes.forEach((route, i) => {
    const c = route.tour.vehicleType === 'electric' ? COLOUR_ELECTRIC : VAN_DIESEL;
    vans.setColorAt(i, c);
    trucks.setColorAt(i, c);
  });
  if (vans.instanceColor) vans.instanceColor.needsUpdate = true;
  if (trucks.instanceColor) trucks.instanceColor.needsUpdate = true;
  group.add(vans);
  group.add(trucks);

  /*
   * ── the glow under each van ───────────────────────────────────────────────────────────────────
   *
   * ⚠️ THE VANS ARE CORRECT AND LIT AND NOBODY CAN FIND THEM. A 6 m vehicle over a 60 km ring is
   * close to nothing, so the one thing the eye should follow is the one thing it does not. This is
   * a locator, not decoration.
   *
   * ⚠️ ITS SIZE IS DERIVED FROM THE VAN'S OWN SCALE, NOT CHOSEN. Both read the same
   * `clamp(range * uVanScale, 1, 40)`, so the halo cannot drift out of proportion with the vehicle
   * it marks at any camera distance. A separately tuned constant is how the pharmacy pins ended up
   * saturating their clamp and looking wrong at exactly the range that mattered.
   *
   * ⚠️ IT INHERITS THE TOUR COLOUR RATHER THAN INTRODUCING ONE. Green already means electrified on
   * this map and is the only colour on it carrying meaning; a fixed blue under every vehicle would
   * compete with the CO₂ lens for the viewer's attention and win, because it moves.
   *
   * ⚠️ AND IT FADES OUT CLOSE UP AND AT THE HUB. Close up the van is right there and a halo is just
   * a smear over the site. At the hub all thirty-one routes begin in the same place — the ribbons
   * already learned this, piling into a solid beige disc ~500 m across over the warehouse the whole
   * app exists to show. Thirty-one overlapping glows would do it again, brighter.
   */
  const glowGeometry = new THREE.CircleGeometry(1, 28);
  glowGeometry.rotateX(-Math.PI / 2); // lie flat on the ground
  /*
   * ⚠️ ShaderMaterial, NOT RawShaderMaterial — the first attempt used Raw and the program failed to
   * link with `VALIDATE_STATUS false` and no line number. Raw injects NOTHING: no `modelMatrix`,
   * no `viewMatrix`, no `cameraPosition`, and critically no `instanceMatrix` or `instanceColor`,
   * all of which this shader reads. The van material beside it is a ShaderMaterial for exactly
   * that reason, and a marker that cannot see `instanceMatrix` has nowhere to be.
   */
  const glowMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true,
    // Additive so it reads as light rather than paint, and never darkens the ground it sits on.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // ⚠️ NO DEPTH TEST. At region range the halo is hundreds of metres across on terrain that is not
    // flat, so a depth-tested disc gets sliced by every rise it crosses. It is a locator; it is
    // allowed to be seen. The close-range fade is what stops that being wrong up close.
    depthTest: false,
    uniforms: {
      uVanScale: { value: 0.002 },
      uVanScaleRange: { value: new THREE.Vector2(1.0, 40.0) },
      /**
       * Halo radius as a multiple of the van's own scale factor, in metres.
       *
       * ⚠️ MEASURED, NOT PICKED. At 9.0 the radius came out at 1.5× the van's own drawn length — a
       * halo the same visual size as the thing it is meant to make findable, which changed 0.06 %
       * of the frame and read as a smudge beside the vehicle. The van draws `vanScale * 6` metres
       * long, so this is expressed against that: 18 gives a radius of 3× the van's length, which is
       * a pool of light around it rather than a second object next to it.
       */
      uGlowMetres: { value: 18.0 },
      /** Camera ranges over which the halo fades in. Below the first, the van speaks for itself. */
      uRegionFade: { value: new THREE.Vector2(400.0, 1600.0) },
      ...nightUniforms(),
    },
    vertexShader: /* glsl */ `
      uniform float uVanScale;
      uniform vec2 uVanScaleRange;
      uniform float uGlowMetres;
      uniform vec2 uRegionFade;
      out vec3 vColour;
      out vec3 vWorld;
      out vec2 vLocal;
      out float vFade;
      void main() {
        vColour = instanceColor;
        vLocal = position.xz;
        vec4 anchor = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float range = distance(anchor.xyz, cameraPosition);
        float vanScale = clamp(range * uVanScale, uVanScaleRange.x, uVanScaleRange.y);
        vFade = smoothstep(uRegionFade.x, uRegionFade.y, range);
        float radius = vanScale * uGlowMetres;
        vec3 local = vec3(position.x * radius, 0.0, position.z * radius);
        vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vColour;
      in vec3 vWorld;
      in vec2 vLocal;
      in float vFade;
      out vec4 fragColor;

      ${NIGHT_GLSL}

      void main() {
        // Soft radial falloff — a ring edge would read as a UI target, which this is not.
        // The exponent is gentle on purpose: at 2.2 almost all of the disc was near-transparent and
        // only the very centre carried any weight, which is a small bright dot with a large
        // invisible skirt rather than a pool of light.
        float r = clamp(length(vLocal), 0.0, 1.0);
        float halo = pow(1.0 - r, 1.6);

        // The same reveal the ribbons obey. A marker drawn over ground the wave has not reached
        // would give away where a van is before its own headlights get there, and would hang over
        // black exactly the way the pharmacy names once did.
        float d = distance(vWorld.xz, uSpotCentre);
        float reached = 1.0 - smoothstep(uReveal, uReveal + uRevealSoft, d);
        float visible = clamp(max(reached, 1.0 - uNight), 0.0, 1.0);

        // All thirty-one tours start here; without this they stack into one bright blob.
        float hubFade = smoothstep(70.0, 320.0, d);

        // Brighter at night, because that is when the fleet is the story and the ground is dark.
        float strength = mix(0.55, 0.85, uNight);
        fragColor = vec4(vColour, halo * strength * vFade * visible * hubFade);
      }
    `,
  });
  const vanGlow = new THREE.InstancedMesh(glowGeometry, glowMaterial, Math.max(routes.length, 1));
  vanGlow.name = 'tour-van-glow';
  // Drawn before the vans so the vehicle stays the crisp thing on top of its own halo.
  vanGlow.renderOrder = -1;
  vanGlow.frustumCulled = false;
  routes.forEach((route, i) => {
    vanGlow.setColorAt(i, route.tour.vehicleType === 'electric' ? COLOUR_ELECTRIC : VAN_DIESEL);
  });
  if (vanGlow.instanceColor) vanGlow.instanceColor.needsUpdate = true;
  group.add(vanGlow);

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  let slot = 0;
  let active = 0;
  let atStop = 0;
  let reach = 0;
  const OFFSCREEN = new THREE.Vector3(0, -100_000, 0);
  /** Markers lit because a van is standing there. Kept so only the changes get rewritten. */
  let litDrops = new Set<number>();
  let servedListener: ((served: number[]) => void) | null = null;

  const setDropState = (index: number, lit: boolean): void => {
    if (index < 0 || index >= dropPositions.length) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    m.compose(dropPositions[index], q, lit ? DROP_LIT_SCALE : DROP_IDLE_SCALE);
    drops.setMatrixAt(index, m);
    drops.setColorAt(index, lit ? DROP_LIT : DROP_IDLE);
  };

  const apply = (): void => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    active = 0;
    atStop = 0;
    reach = 0;
    const nowLit = new Set<number>();

    routes.forEach((route, index) => {
      const p = tourProgress(slot, route.tour.departSlot, route.tour.returnSlot);
      if (p === null) {
        // Parked far below the world rather than scaled to zero: a zero-scale instance still
        // occupies its matrix slot and can catch a stray raycast.
        m.compose(OFFSCREEN, q, one);
        vans.setMatrixAt(index, m);
        trucks.setMatrixAt(index, m);
        vanGlow.setMatrixAt(index, m);
        return;
      }
      active += 1;

      // Walk the alternating drive/dwell timeline to the current moment.
      const target = Math.min(p, 1) * route.total;
      let e = 0;
      while (
        e < route.events.length - 1 &&
        route.events[e].start + route.events[e].duration < target
      ) {
        e += 1;
      }
      const event = route.events[e];
      const local = Math.min(1, Math.max(0, (target - event.start) / event.duration));

      let pos: THREE.Vector3;
      const dir = new THREE.Vector3();
      let underground = false;
      if (event.kind === 'dwell') {
        // Standing at a pharmacy. Hold position and light the marker — this is the answer to
        // "where do they have to stop", shown rather than asserted.
        atStop += 1;
        const stopIndex = route.dropIndex[event.index];
        if (stopIndex >= 0) nowLit.add(stopIndex);
        pos = route.points[event.index].clone();
        dir.subVectors(pos, route.points[Math.max(event.index - 1, 0)]);
      } else {
        const from = route.points[event.index];
        const to = route.points[event.index + 1];
        pos = new THREE.Vector3().lerpVectors(from, to, local);
        dir.subVectors(to, from);
        underground = route.hidden[event.index] || route.hidden[event.index + 1];
      }

      if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
      dir.normalize();
      q.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
      if (underground) {
        // In a tunnel (Rheinufertunnel, Markmannsgasse …): on the road, but not visible.
        m.compose(OFFSCREEN, q, one);
        vans.setMatrixAt(index, m);
        trucks.setMatrixAt(index, m);
        vanGlow.setMatrixAt(index, m);
        reach = Math.max(reach, Math.hypot(pos.x - hubPoint.x, pos.z - hubPoint.z));
        return;
      }
      m.compose(pos, q, one);
      const parked = new THREE.Matrix4().compose(OFFSCREEN, q, one);
      (isTruck[index] ? trucks : vans).setMatrixAt(index, m);
      (isTruck[index] ? vans : trucks).setMatrixAt(index, parked);
      // The SAME matrix, deliberately: the halo is a disc, so the van's yaw is irrelevant to it,
      // and sharing the transform is what guarantees the marker can never drift off the thing it
      // marks. Its size comes from the shader, from the van's own scale factor.
      vanGlow.setMatrixAt(index, m);
      reach = Math.max(reach, Math.hypot(pos.x - hubPoint.x, pos.z - hubPoint.z));
    });
    vans.instanceMatrix.needsUpdate = true;
    trucks.instanceMatrix.needsUpdate = true;
    vanGlow.instanceMatrix.needsUpdate = true;

    let dropsChanged = false;
    for (const i of litDrops) {
      if (!nowLit.has(i)) {
        setDropState(i, false);
        dropsChanged = true;
      }
    }
    for (const i of nowLit) {
      if (!litDrops.has(i)) {
        setDropState(i, true);
        dropsChanged = true;
      }
    }
    if (dropsChanged) {
      drops.instanceMatrix.needsUpdate = true;
      if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    }
    litDrops = nowLit;
    if (dropsChanged) servedListener?.([...nowLit]);
  };
  apply();

  // Framing: the whole delivery region, not the hall.
  let maxRadius = 0;
  for (const route of routes) {
    for (const point of route.points) {
      maxRadius = Math.max(maxRadius, Math.hypot(point.x - hubPoint.x, point.z - hubPoint.z));
    }
  }

  // ── the named moments of the day ──────────────────────────────────────────────────────────────
  //
  // Built from the routes' OWN timelines rather than from the tour metadata, so "the first
  // delivery" is the first moment a van in this scene is actually standing at a pharmacy. Deriving
  // it from departure times instead would produce a plausible number that the picture disagrees
  // with, which is the failure mode this whole app keeps guarding against.
  const timings: TourTiming[] = routes.map((route) => {
    const dwells = route.events.filter((e) => e.kind === 'dwell');
    const span = (e: RouteEvent): [number, number] => [
      e.start / route.total,
      (e.start + e.duration) / route.total,
    ];
    return {
      departSlot: route.tour.departSlot,
      returnSlot: route.tour.returnSlot,
      dwellSpans: dwells.map(span),
      // Stops inside the photoreal core, measured from the geometry the scene actually draws.
      coreDwellSpans: dwells
        .filter((e) => {
          const at = route.points[e.index];
          return Math.hypot(at.x - hubPoint.x, at.z - hubPoint.z) <= CORE_RADIUS_M;
        })
        .map(span),
    };
  });
  const events = buildDayEvents(timings, {
    plannedWaves: [...new Set(routes.map((r) => r.tour.departSlot))].sort((a, b) => a - b),
    nightPickSlot: clockToSlot(shift?.nightPickStart),
  });
  const cityStopSlot = firstCoreStopSlot(timings);

  return {
    group,
    setTime(next) {
      // Kept fractional. Rounding here is exactly what made the vans teleport.
      const wrapped = ((next % SLOTS) + SLOTS) % SLOTS;
      if (wrapped === slot) return;
      slot = wrapped;
      apply();
    },
    activeTours: () => active,
    vansAtStop: () => atStop,
    reachRadius: () => reach,
    // ⚠️ EVERY MATERIAL THAT READS A NIGHT UNIFORM MUST BE IN THIS LIST. `applyNightState` pushes
    // uNight/uReveal/uSpotCentre into exactly these and nothing else, so a material left out keeps
    // its defaults for ever — silently. That is how a lit city once sat under a black sky, and it
    // is why the van halo, which fades on both uNight and uReveal, is here.
    nightMaterials: () => [pathMaterial, dropMaterial, vanMaterial, glowMaterial],
    onServedChanged(handler) {
      servedListener = handler;
      handler([...litDrops]);
    },
    pharmacyPoints: () =>
      pharmacies.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon })),
    fleet: () =>
      routes.map((r) => ({
        tourId: r.tour.tourId,
        distanceKm: r.tour.distanceKm,
        vehicleType: r.tour.vehicleType,
        withinEvRange: r.tour.withinEvRange,
      })),
    setElectrified(tourIds) {
      const colourAttribute = pathGeometry.getAttribute('aColour') as THREE.BufferAttribute;
      const buffer = colourAttribute.array as Float32Array;
      routes.forEach((route, index) => {
        // Null means "show what the operating model says", not "show nothing electric".
        const electric =
          tourIds === null ? route.tour.vehicleType === 'electric' : tourIds.has(route.tour.tourId);
        const ribbon = electric ? COLOUR_ELECTRIC : COLOUR_DIESEL;
        const end = route.vertexStart + route.vertexCount;
        for (let v = route.vertexStart; v < end; v += 1) {
          buffer[v * 3] = ribbon.r;
          buffer[v * 3 + 1] = ribbon.g;
          buffer[v * 3 + 2] = ribbon.b;
        }
        vans.setColorAt(index, electric ? COLOUR_ELECTRIC : VAN_DIESEL);
        // The halo follows the vehicle's colour rather than carrying one of its own, so the CO₂
        // lens keeps sole ownership of what green means on this map.
        vanGlow.setColorAt(index, electric ? COLOUR_ELECTRIC : VAN_DIESEL);
      });
      colourAttribute.needsUpdate = true;
      if (vans.instanceColor) vans.instanceColor.needsUpdate = true;
      if (vanGlow.instanceColor) vanGlow.instanceColor.needsUpdate = true;
    },
    dayEvents: () => events,
    cityDeliverySlot: () => cityStopSlot,
    activeInCore() {
      let n = 0;
      routes.forEach((route, index) => {
        if (tourProgress(slot, route.tour.departSlot, route.tour.returnSlot) === null) return;
        // From the mesh that drives this tour; a parked or tunnel slot is not "in the city".
        const m = (isTruck[index] ? trucks : vans).instanceMatrix.array;
        if (m[index * 16 + 13] < -1000) return;
        const d = Math.hypot(m[index * 16 + 12] - hubPoint.x, m[index * 16 + 14] - hubPoint.z);
        if (d <= CORE_RADIUS_M) n += 1;
      });
      return n;
    },
    tourActive(index) {
      const route = routes[index];
      return Boolean(route) && tourProgress(slot, route.tour.departSlot, route.tour.returnSlot) !== null;
    },
    vanPosition(index) {
      const route = routes[index];
      if (!route) return null;
      if (tourProgress(slot, route.tour.departSlot, route.tour.returnSlot) === null) return null;
      // ⚠️ FROM THE MESH THAT DRIVES THIS TOUR. Reading the van mesh for a truck tour returned the
      // parking slot below the world, and the ride-along camera flew there (measured 2026-10-17).
      const m = (isTruck[index] ? trucks : vans).instanceMatrix.array;
      const at = new THREE.Vector3(m[index * 16 + 12], m[index * 16 + 13], m[index * 16 + 14]);
      return at.y < -1000 ? null : at; // in a tunnel: no position to show
    },
    nearestActiveTour(x, z) {
      // ⚠️ PREFERS A VAN INSIDE THE MODELLED CORE. Riding with whichever van happened to be
      // closest sent the camera 20 km out, onto featureless shell terrain with no buildings and
      // no orthophoto — which reads as a broken render rather than as the edge of the modelled
      // area. The nearby ride is the one worth offering, and it is what was asked for.
      let best = -1;
      let bestScore = Infinity;
      routes.forEach((route, index) => {
        if (tourProgress(slot, route.tour.departSlot, route.tour.returnSlot) === null) return;
        const m = (isTruck[index] ? trucks : vans).instanceMatrix.array;
        const vx = m[index * 16 + 12];
        const vz = m[index * 16 + 14];
        if (m[index * 16 + 13] < -1000) return; // parked or in a tunnel
        const fromHub = Math.hypot(vx - hubPoint.x, vz - hubPoint.z);
        // Inside the core, pick the one nearest the camera. Outside it, the penalty dominates, so
        // a van in the modelled city always wins over a closer one on blank ground.
        // Cologne: prefer a vehicle in the FINE mesh core (~1.6 km), where street level looks real;
        // the coarse ring is the fallback, and outside the ring the old penalty still applies.
        const score =
          fromHub <= FINE_CORE_RADIUS_M
            ? Math.hypot(vx - x, vz - z)
            : fromHub <= CORE_RADIUS_M
              ? 1e5 + Math.hypot(vx - x, vz - z)
              : 1e6 + fromHub;
        if (score < bestScore) {
          bestScore = score;
          best = index;
        }
      });
      return best;
    },
    dropCount: () => pharmacies.length,
    tourCount: () => routes.length,
    setVisible(visible) {
      group.visible = visible;
    },
    visible: () => group.visible,
    nightFactor: () => nightAt(slot),
    bounds: {
      centre: new THREE.Vector3(hubPoint.x, hubPoint.y, hubPoint.z),
      radiusM: maxRadius,
    },
    dispose() {
      disposeTree(group);
      group.removeFromParent();
    },
  };
}
