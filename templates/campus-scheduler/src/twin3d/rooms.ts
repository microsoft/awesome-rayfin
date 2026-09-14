import * as THREE from 'three';

/**
 * Rooms, as real geometry, and the exploded view built on them.
 *
 * Every polygon here was traced by a person mapping the inside of a building in OpenStreetMap, and
 * every usage type and booking attached to it comes from TUMonline. Nothing in this layer is
 * generated to fill a gap: a building without indoor mapping simply has no rooms, and the app says
 * so rather than drawing plausible boxes.
 *
 * Each room is drawn as an open prism — floor plate plus walls, no ceiling — because the exploded
 * view is looked at from above and a closed box would hide the thing being measured. Everything
 * that changes at interactive rates (which floor is lifted, how far, what colour each room is) is
 * done on the GPU from two small uniforms and one data texture, so scrubbing through a week does
 * not rebuild any geometry.
 */

export interface RoomRecord {
  code: string;
  building: string;
  level: number;
  usage: string | null;
  name: string | null;
  areaM2: number;
  /** ⚠️ Synthetic — floor area divided by a planning density. Badge it wherever it is shown. */
  seats: number | null;
  baseM: number;
  heightM: number;
  vertexOffset: number;
  vertexCount: number;
  /** Row in `occupancy.bin`, or null where the room publishes no calendar. */
  occupancy: number | null;
  /** The courses actually timetabled here, most frequent first. Real TUMonline titles. */
  courses: { title: string; count: number }[] | null;
}

export interface RoomsMeta {
  aoi: string;
  count: number;
  buildings: number;
  withUsage: number;
  withOccupancy: number;
  quantisation: { xzScaleM: number; yScaleM: number };
  occupancyGrid: {
    days: number;
    firstHour: number;
    hours: number;
    slots: number;
    meaning: string;
    semester: string;
  };
  provenance: Record<string, string>;
  coverage: { building: string; expected: number; built: number }[];
  /**
   * How much of the building stock exists in the model at all, per campus.
   *
   * ⚠️ A CAMPUS CAN BE MODELLED TO A THIRD OF ITS HEIGHT AND LOOK MERELY QUIET. OTH publishes a
   * floor plan for the ground floor of Prüfening's six buildings and nothing above it, and this
   * project refuses to invent a grid on the storey above an architect's drawing — so 12 of that
   * campus's 18 levels hold no rooms, it carries 15 of 936 sessions, and until this field existed
   * the app said nothing at all about why. Optional because a build made before it must still load.
   */
  levelCoverage?: {
    levels: number;
    modelled: number;
    partialBuildings: number;
    byCampus: Record<string, { levels: number; modelled: number; partialBuildings: number }>;
    /** Only the buildings modelled below their own height — the exceptions, not every building. */
    byBuilding?: Record<string, { levels: number; modelled: number }>;
  };
  rooms: RoomRecord[];
}

/** A room with the derived facts the UI needs, computed once at load. */
export interface RoomView extends RoomRecord {
  index: number;
  /** Scene-space centre of the room's footprint, at its own floor. */
  centre: THREE.Vector3;
  /** Share of the teaching week the room is booked, 0..1, or null without a calendar. */
  utilisation: number | null;
  /** True for circulation, plant and sanitary space — most of the floor and none of the story. */
  service: boolean;
  /** True for rooms the occupancy lens is actually about. */
  teaching: boolean;
}

export interface BuildingView {
  code: string;
  roomCount: number;
  levels: number[];
  /** Scene-space centre of the whole building's footprint. */
  centre: THREE.Vector3;
  /** Rooms with a calendar. */
  bookedRooms: number;
  /** Mean utilisation over the teaching rooms that have a calendar, or null. */
  utilisation: number | null;
}

export interface RoomLayer {
  group: THREE.Group;
  meta: RoomsMeta;
  rooms: RoomView[];
  buildings: BuildingView[];
  /**
   * Counts of distinct room CODES, which is what a room is.
   *
   * `meta.count` and `meta.withOccupancy` count POLYGONS, and the two are not the same number:
   * OpenStreetMap draws 5532.Z1.003 twice on the same level, so the campus has 3 922 polygons and
   * 3 921 rooms. Both figures are legitimate — the renderer needs every polygon — but only this
   * one belongs in the UI, and only this one matches the semantic model, whose Room table cannot
   * hold a code twice.
   */
  distinct: { rooms: number; withOccupancy: number; neverBooked: number };
  /** Occupied-week counts per room, `slots` long, or null if the room has no calendar. */
  occupancyFor(room: RoomRecord): Uint8Array | null;
  /**
   * Open one building's floors apart. `t` is 0 (closed) to 1 (fully open); pass null as the
   * building to close everything.
   */
  setExplode(buildingCode: string | null, t: number): void;
  /** Colour by a specific hour of the teaching week, or by the whole week when null. */
  setTimeSlot(slot: number | null): void;
  /** Highlight one room, or none. */
  setSelected(index: number | null): void;
  /** Which room is under this pointer position, or null. */
  pick(raycaster: THREE.Raycaster): RoomView | null;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Ear clipping, because room outlines are not convex.
 *
 * A triangle fan is the cheap way to fill a polygon and it is wrong here: L-shaped and U-shaped
 * rooms are ordinary in these buildings, and a fan across one spills a wedge of floor outside the
 * wall. Ear clipping is a few dozen lines and handles any simple polygon, which is what these are.
 */
function triangulate(points: number[]): number[] {
  const count = points.length / 2;
  if (count < 3) return [];

  const indices = Array.from({ length: count }, (_, i) => i);
  // Work anticlockwise so the "is this ear convex" test has a consistent sign.
  if (signedArea(points, indices) < 0) indices.reverse();

  const triangles: number[] = [];
  let guard = 0;
  while (indices.length > 3 && guard++ < count * count) {
    let clipped = false;
    for (let i = 0; i < indices.length; i += 1) {
      const prev = indices[(i - 1 + indices.length) % indices.length];
      const curr = indices[i];
      const next = indices[(i + 1) % indices.length];

      if (cross(points, prev, curr, next) <= 0) continue; // reflex, not an ear

      let contains = false;
      for (const other of indices) {
        if (other === prev || other === curr || other === next) continue;
        if (pointInTriangle(points, other, prev, curr, next)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      triangles.push(prev, curr, next);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    // A self-intersecting outline has no ear to clip. Rather than spin, fall back to a fan for
    // that one room: a slightly wrong plate is better than a hung load.
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices[0], indices[1], indices[2]);
  else if (indices.length > 3) {
    for (let i = 1; i < indices.length - 1; i += 1) {
      triangles.push(indices[0], indices[i], indices[i + 1]);
    }
  }
  return triangles;
}

function signedArea(points: number[], indices: number[]): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const a = indices[i] * 2;
    const b = indices[(i + 1) % indices.length] * 2;
    total += points[a] * points[b + 1] - points[b] * points[a + 1];
  }
  return total / 2;
}

function cross(points: number[], a: number, b: number, c: number): number {
  const ax = points[a * 2];
  const ay = points[a * 2 + 1];
  const bx = points[b * 2];
  const by = points[b * 2 + 1];
  const cx = points[c * 2];
  const cy = points[c * 2 + 1];
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointInTriangle(points: number[], p: number, a: number, b: number, c: number): boolean {
  const d1 = cross(points, a, b, p);
  const d2 = cross(points, b, c, p);
  const d3 = cross(points, c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Polygon area in square metres, from a flat `[x, z, x, z, ...]` outline.
 *
 * The same shoelace `build_rooms.py` runs on the projected polygon, so a room's area is the same
 * number in the browser as in the pipeline.
 */
function polygonAreaM2(points: number[]): number {
  const count = points.length / 2;
  if (count < 3) return 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const a = i * 2;
    const b = ((i + 1) % count) * 2;
    total += points[a] * points[b + 1] - points[b] * points[a + 1];
  }
  return Math.abs(total) / 2;
}

/** Geometry helpers, exposed for unit tests rather than for callers. */
export const __testing = { triangulate, polygonAreaM2 };

/**
 * What a room is for, in the only three categories the exploded view needs to distinguish.
 *
 * `teaching` is the subject of the occupancy lens. `service` is circulation, plant and sanitary
 * space: it is most of the floor area and all of the clutter, so it is drawn muted — which is what
 * lets a lecture theatre be findable at a glance rather than lost among four hundred cupboards.
 */
const TEACHING = /hörsaal|seminarraum|unterrichtsraum|übungsraum|zeichensaal|praktikumsraum|studentenarbeitsraum|lesesaal/i;
const SERVICE =
  /flur|gang|treppe|aufzug|schacht|wc|dusche|sanitär|putz|lager|installation|leittechnik|heizung|lüftung|klima|strom|technik|müll|abstell|windfang|vorraum|schleuse|garage|stellplatz/i;

const USAGE_COLOURS: { match: RegExp; colour: number }[] = [
  { match: /hörsaal/i, colour: 0xd94f3d },
  { match: /seminarraum|unterrichtsraum|übungsraum|zeichensaal/i, colour: 0xe8a33d },
  { match: /praktikum|studentenarbeitsraum|lesesaal|bibliothek/i, colour: 0x4a9d5f },
  { match: /büro|sekretariat|besprechung|konferenz/i, colour: 0x5b7fa6 },
  { match: /labor|versuchshalle|werkstatt/i, colour: 0x8f6bb0 },
];
const NEUTRAL = 0x9aa0a6;

function colourFor(usage: string | null): number {
  if (!usage) return NEUTRAL;
  for (const entry of USAGE_COLOURS) {
    if (entry.match.test(usage)) return entry.colour;
  }
  return NEUTRAL;
}

/**
 * Metres each storey rises per unit of explode.
 *
 * Tuned by looking, not chosen. These wings have a large plan relative to their height, so at the
 * building's own storey pitch (~3.5 m) the floors overlap almost completely in projection and the
 * exploded view reads as one thick slab. 26 m is roughly seven times the real pitch: far past
 * literal, and the point is legibility rather than a section drawing.
 */
export const EXPLODE_GAP_M = 26;

const vertexShader = /* glsl */ `
in float aLevel;
in float aBuilding;
in float aRoom;
in vec3 aColour;

uniform float uExplodeBuilding;   // building index being opened, or -1
uniform float uExplodeT;          // 0 closed .. 1 fully open
uniform float uGapM;
uniform float uSelected;          // room index highlighted, or -1

out vec3 vColour;
out float vRoom;
out float vSelected;
out float vOtherBuilding;
out vec3 vWorld;

void main() {
  // Only the chosen building opens. Comparing floats by proximity rather than equality because
  // these arrive as interpolated attributes.
  float chosen = step(0.0, uExplodeBuilding) * (1.0 - step(0.5, abs(aBuilding - uExplodeBuilding)));

  vec3 p = position;
  p.y += aLevel * uGapM * uExplodeT * chosen;

  vColour = aColour;
  vRoom = aRoom;
  vSelected = 1.0 - step(0.5, abs(aRoom - uSelected));
  // While one building is open, every other building's rooms are hidden rather than dimmed: at
  // campus scale the other 3 500 rooms are noise, and fading them still leaves a fog of colour.
  vOtherBuilding = step(0.0, uExplodeBuilding) * (1.0 - chosen);
  vWorld = p;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

in vec3 vColour;
in float vRoom;
in float vSelected;
in float vOtherBuilding;
in vec3 vWorld;

uniform sampler2D uRoomData;  // r = value 0..1, g = has data, b = service
uniform float uRoomDataWidth;
uniform float uLensMix;       // 0 = colour by usage, 1 = colour by the occupancy ramp
uniform float uOpacity;

out vec4 fragColor;

/**
 * The utilisation ramp.
 *
 * Cool grey-blue for a room that is barely booked, through amber, to a deep red for one that is
 * committed almost every hour of the teaching week. Deliberately NOT a rainbow: the question a
 * space manager asks is "how close to full is this", which is one ordered quantity.
 */
vec3 ramp(float t) {
  vec3 low  = vec3(0.42, 0.52, 0.60);
  vec3 mid  = vec3(0.91, 0.64, 0.24);
  vec3 high = vec3(0.79, 0.20, 0.16);
  return t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
}

void main() {
  if (vOtherBuilding > 0.5) discard;

  int index = int(vRoom + 0.5);
  int width = int(uRoomDataWidth);
  vec4 data = texelFetch(uRoomData, ivec2(index % width, index / width), 0);

  float value = data.r;
  float hasData = data.g;
  float service = data.b;

  vec3 colour = vColour;
  if (uLensMix > 0.0) {
    // A room with no calendar is not "empty" — nothing is known about it. Showing it at the
    // bottom of the ramp would be a claim the data does not support, so it stays grey.
    vec3 lensColour = hasData > 0.5 ? ramp(value) : vec3(0.55, 0.56, 0.57);
    colour = mix(colour, lensColour, uLensMix);
  }

  // Circulation and plant rooms recede so teaching space can be found at a glance.
  colour = mix(colour, vec3(0.62, 0.63, 0.64), service * 0.65);

  // Flat per-face shading from screen-space derivatives of the world position, the same trick the
  // buildings layer uses: the mesh carries no normals, and its faces ARE flat. Without it an
  // exploded floor is a field of flat colour with no readable depth, and walls disappear against
  // the plate they stand on.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float shade = 0.72 + 0.28 * abs(normal.y);
  colour *= shade;

  if (vSelected > 0.5) colour = mix(colour, vec3(1.0), 0.45);

  fragColor = vec4(colour, uOpacity);
}
`;

export async function loadRooms(aoiId: string, base = '/terrain'): Promise<RoomLayer | null> {
  const root = `${base}/${aoiId}`;
  const metaResponse = await fetch(`${root}/rooms.json`);
  if (!metaResponse.ok) return null;
  const meta: RoomsMeta = await metaResponse.json();

  const binResponse = await fetch(`${root}/rooms.bin`);
  if (!binResponse.ok) return null;
  // ⚠️ THE WIDTH IS MEASURED, NOT ASSUMED — and assuming it produced a NaN scene.
  //
  // This used to be a flat `new Int32Array(buffer)`, widened from Int16 because scene coordinates
  // reach ±1.5 km and at 1 cm quantisation that is ~±153 000, far outside Int16; the writer had
  // been clamping instead of widening, which put every room in the campus on one point.
  //
  // Campus-Insights never made that change. Garching's `rooms.bin` is still Int16 — its own
  // metadata says so, `"int16 x,z at 0.04 m"` — and it uses 4 cm quantisation, which fits. Read
  // as Int32 it yields exactly HALF the elements the metadata promises, so every index past the
  // midpoint returns `undefined`, `undefined * scale` is NaN, and Three.js reported "Computed
  // radius is NaN" from the bounding sphere. The scene still drew, because the rooms that landed
  // before the midpoint were fine — which is what made it look cosmetic.
  //
  // So pick the width the FILE supports rather than the one this repo happens to write. The
  // requirement is exact: two components per vertex, and the highest vertex any room refers to.
  // Both AOIs fit one width exactly, so there is no ambiguity to resolve — and if neither fits,
  // that is a corrupt or unknown file and saying so beats rendering NaN.
  const bytes = await binResponse.arrayBuffer();
  const required = meta.rooms.reduce(
    (highest, room) => Math.max(highest, room.vertexOffset + room.vertexCount),
    0
  ) * 2;
  let raw: Int32Array | Int16Array;
  if (bytes.byteLength >= required * 4) {
    raw = new Int32Array(bytes);
  } else if (bytes.byteLength >= required * 2) {
    raw = new Int16Array(bytes);
  } else {
    console.error(
      `rooms.bin for ${aoiId} is too small: ${bytes.byteLength} bytes cannot hold ${required} ` +
        'coordinates at either width — refusing to build a mesh from it'
    );
    return null;
  }

  let occupancy: Uint8Array | null = null;
  if (meta.withOccupancy > 0) {
    const occResponse = await fetch(`${root}/occupancy.bin`);
    if (occResponse.ok) occupancy = new Uint8Array(await occResponse.arrayBuffer());
  }

  const scale = meta.quantisation.xzScaleM;
  const slots = meta.occupancyGrid.slots;

  const occupancyFor = (room: RoomRecord): Uint8Array | null => {
    if (room.occupancy === null || !occupancy) return null;
    return occupancy.subarray(room.occupancy * slots, (room.occupancy + 1) * slots);
  };

  // The busiest slot anywhere stands in for "booked every week of the semester", so the ramp is
  // relative to how this campus actually runs rather than to an assumed number of teaching weeks.
  let maxWeeks = 1;
  if (occupancy) for (const weeks of occupancy) if (weeks > maxWeeks) maxWeeks = weeks;

  // ── Build the mesh ───────────────────────────────────────────────────────
  const buildingCodes = [...new Set(meta.rooms.map((r) => r.building))].sort();
  const buildingIndex = new Map(buildingCodes.map((code, i) => [code, i]));

  const positions: number[] = [];
  const colours: number[] = [];
  const levels: number[] = [];
  const buildingAttr: number[] = [];
  const roomAttr: number[] = [];
  /** Room index per triangle, so a raycast hit can name the room it landed on. */
  const roomOfTriangle: number[] = [];

  const views: RoomView[] = [];
  const colour = new THREE.Color();

  meta.rooms.forEach((room, index) => {
    const flat: number[] = [];
    for (let i = 0; i < room.vertexCount; i += 1) {
      flat.push(
        raw[(room.vertexOffset + i) * 2] * scale,
        raw[(room.vertexOffset + i) * 2 + 1] * scale
      );
    }
    const triangles = triangulate(flat);
    if (!triangles.length) return;

    const service = SERVICE.test(room.usage ?? '');
    const teaching = TEACHING.test(room.usage ?? '');
    colour.setHex(colourFor(room.usage));

    const base = room.baseM + 0.05;
    // Walls are kept low for service rooms so an exploded floor reads as a plan rather than as a
    // maze; teaching rooms keep their measured height and stand out for it.
    const top = base + (service ? Math.min(room.heightM, 1.2) : room.heightM);
    const bIndex = buildingIndex.get(room.building) ?? 0;

    const push = (x: number, y: number, z: number) => {
      positions.push(x, y, z);
      colours.push(colour.r, colour.g, colour.b);
      levels.push(room.level);
      buildingAttr.push(bIndex);
      roomAttr.push(index);
    };

    // Floor plate.
    for (let i = 0; i < triangles.length; i += 3) {
      push(flat[triangles[i] * 2], base, flat[triangles[i] * 2 + 1]);
      push(flat[triangles[i + 1] * 2], base, flat[triangles[i + 1] * 2 + 1]);
      push(flat[triangles[i + 2] * 2], base, flat[triangles[i + 2] * 2 + 1]);
      roomOfTriangle.push(index);
    }

    // Walls, as two triangles per edge. No ceiling: the exploded view is looked at from above and
    // a lid would hide the floor being measured.
    const count = flat.length / 2;
    for (let i = 0; i < count; i += 1) {
      const ax = flat[i * 2];
      const az = flat[i * 2 + 1];
      const bx = flat[((i + 1) % count) * 2];
      const bz = flat[((i + 1) % count) * 2 + 1];
      push(ax, base, az);
      push(bx, base, bz);
      push(bx, top, bz);
      roomOfTriangle.push(index);
      push(ax, base, az);
      push(bx, top, bz);
      push(ax, top, az);
      roomOfTriangle.push(index);
    }

    // Centroid of the outline, for framing the camera and for the detail panel.
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < count; i += 1) {
      cx += flat[i * 2];
      cz += flat[i * 2 + 1];
    }

    const grid = occupancyFor(room);
    let utilisation: number | null = null;
    if (grid) {
      let booked = 0;
      for (const weeks of grid) if (weeks > 0) booked += 1;
      utilisation = booked / slots;
    }

    views.push({
      ...room,
      index,
      centre: new THREE.Vector3(cx / count, room.baseM, cz / count),
      utilisation,
      service,
      teaching,
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('aLevel', new THREE.Float32BufferAttribute(levels, 1));
  geometry.setAttribute('aBuilding', new THREE.Float32BufferAttribute(buildingAttr, 1));
  geometry.setAttribute('aRoom', new THREE.Float32BufferAttribute(roomAttr, 1));
  geometry.computeBoundingSphere();

  // ── Per-room data, as a texture ──────────────────────────────────────────
  // Scrubbing through the week changes one value per room. Rewriting a small texture is a few
  // microseconds; rebuilding 190 000 vertices is not, so nothing about the geometry depends on
  // time or on which lens is active.
  const dataWidth = 256;
  const dataHeight = Math.ceil(meta.rooms.length / dataWidth);
  const roomData = new Uint8Array(dataWidth * dataHeight * 4);
  const roomTexture = new THREE.DataTexture(roomData, dataWidth, dataHeight);
  roomTexture.minFilter = THREE.NearestFilter;
  roomTexture.magFilter = THREE.NearestFilter;
  roomTexture.needsUpdate = true;

  const writeRoomData = (slot: number | null) => {
    for (const view of views) {
      const offset = view.index * 4;
      const grid = occupancyFor(view);
      let value = 0;
      let has = 0;
      if (grid) {
        has = 1;
        if (slot === null) {
          value = view.utilisation ?? 0;
        } else {
          // How reliably this room is busy at this hour: the share of semester weeks in which the
          // slot carried a booking. A room used every single week reads full; one used twice does
          // not, which is the distinction a timetable planner cares about.
          value = grid[slot] / maxWeeks;
        }
      }
      roomData[offset] = Math.round(Math.min(Math.max(value, 0), 1) * 255);
      roomData[offset + 1] = has * 255;
      roomData[offset + 2] = view.service ? 255 : 0;
      roomData[offset + 3] = 255;
    }
    roomTexture.needsUpdate = true;
  };
  writeRoomData(null);

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: {
      uExplodeBuilding: { value: -1 },
      uExplodeT: { value: 0 },
      uGapM: { value: EXPLODE_GAP_M },
      uSelected: { value: -1 },
      uRoomData: { value: roomTexture },
      uRoomDataWidth: { value: dataWidth },
      uLensMix: { value: 0 },
      uOpacity: { value: 1 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const group = new THREE.Group();
  group.add(mesh);
  // Closed buildings hide their own rooms; the scene shows them only once one is opened.
  group.visible = false;

  // ── Building summaries ───────────────────────────────────────────────────
  // Summaries count distinct room codes, not polygons: a room drawn in two parts is one room, and
  // counting it twice would also weight it twice in the mean utilisation.
  const buildings: BuildingView[] = buildingCodes.map((code) => {
    const polygons = views.filter((v) => v.building === code);
    const own = [...new Map(polygons.map((v) => [v.code, v])).values()];
    const booked = own.filter((v) => v.utilisation !== null);
    const centre = new THREE.Vector3();
    for (const view of polygons) centre.add(view.centre);
    if (polygons.length) centre.divideScalar(polygons.length);
    return {
      code,
      roomCount: own.length,
      levels: [...new Set(own.map((v) => v.level))].sort((a, b) => a - b),
      centre,
      bookedRooms: booked.length,
      utilisation: booked.length
        ? booked.reduce((sum, v) => sum + (v.utilisation ?? 0), 0) / booked.length
        : null,
    };
  });

  const distinctCodes = new Set(views.map((room) => room.code));
  const distinctBooked = new Set(
    views.filter((room) => room.occupancy !== null).map((room) => room.code)
  );
  // Bookable and never booked once in the reference semester. A real answer, not missing data —
  // see the note in build_rooms.py. These rooms read 0 %, and they are 43 % of the rooms that
  // publish a calendar at all.
  const distinctNeverBooked = new Set(
    views
      .filter((room) => room.occupancy !== null && room.utilisation === 0)
      .map((room) => room.code)
  );

  return {
    group,
    meta,
    rooms: views,
    buildings,
    distinct: {
      rooms: distinctCodes.size,
      withOccupancy: distinctBooked.size,
      neverBooked: distinctNeverBooked.size,
    },
    occupancyFor,
    setExplode(buildingCode, t) {
      const index = buildingCode === null ? -1 : (buildingIndex.get(buildingCode) ?? -1);
      material.uniforms.uExplodeBuilding.value = index;
      material.uniforms.uExplodeT.value = t;
      material.uniforms.uLensMix.value = index >= 0 ? 1 : 0;
      group.visible = index >= 0;
    },
    setTimeSlot(slot) {
      writeRoomData(slot);
    },
    setSelected(index) {
      material.uniforms.uSelected.value = index ?? -1;
    },
    pick(raycaster) {
      if (!group.visible) return null;
      const hits = raycaster.intersectObject(mesh, false);
      for (const hit of hits) {
        if (hit.faceIndex == null) continue;
        const roomIndex = roomOfTriangle[hit.faceIndex];
        const view = views.find((v) => v.index === roomIndex);
        // A hit on a hidden building is not a hit on anything the viewer can see.
        if (view && material.uniforms.uExplodeBuilding.value >= 0) {
          const chosen = buildingIndex.get(view.building);
          if (chosen === material.uniforms.uExplodeBuilding.value) return view;
        }
      }
      return null;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      roomTexture.dispose();
    },
  };
}
