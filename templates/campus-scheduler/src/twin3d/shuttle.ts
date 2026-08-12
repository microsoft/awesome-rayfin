import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';

/**
 * The shuttle between an AOI's campuses.
 *
 * OTH Regensburg teaches on two sites 3 km apart and LMU on two more; "which cohorts have to cross
 * town between two lectures" is a question both of them asked out loud. The walk lens already
 * answers it as a number. This answers it as a thing you can watch: a vehicle on the actual road,
 * leaving one campus and arriving at the other.
 *
 * ⚠️ **THE ROUTE IS THE ROAD, NOT THE FOOTPATH.** `walk-routes.json` already contains a measured
 * 3.5 km path between OTH's campuses, and reusing it would have saved a build step. It runs over
 * footways and through a park. A bus driving down it, in a photoreal twin, in front of people who
 * know that ground, would discredit everything else on the screen. `drive-route.json` is built
 * from the OSM road network for exactly this reason — see `tools/geodata/build_drive_route.py`.
 *
 * ⚠️ **THE CROSSING RUNS AT THE MEASURED DRIVING TIME, AND THE FIRST VERSION DID NOT.** That one
 * crossed in a fixed twelve seconds, chosen so a whole journey could be watched end to end from a
 * wide shot. Measured on screen, that works out at 250 m/s — about 900 km/h — and the moment the
 * camera came down to street level the bus was a streak that crossed the frame between two frames.
 * A twin whose vehicles move at nine hundred kilometres an hour is a cartoon, and the caveat it
 * needed in the panel ("the animation is not to scale") was a sign the design was wrong rather
 * than a thing worth explaining. It now drives the time the road actually takes, which is honest
 * at every zoom and needs no footnote. The cost is real and accepted: a full crossing takes about
 * five minutes, so you watch a bus that is under way rather than a whole journey.
 */

const BUS_LENGTH_M = 12;
const BUS_WIDTH_M = 2.55;
const BUS_HEIGHT_M = 3.2;

/** Lifted clear of the road surface so the terrain does not z-fight through the wheels. */
const LIFT_M = 1.2;

/**
 * How long it waits at each end before turning round.
 *
 * The crossing itself is not a constant: it is `leg.driveSeconds`, straight from the road network.
 */
const STOP_SECONDS = 8;

export const BUS_PART = {
  body: 0,
  glass: 1,
  tyre: 2,
  light: 3,
} as const;

/**
 * A city bus, procedurally.
 *
 * ⚠️ BUILT ALONG +X AND THEN ROTATED SO +Z IS FORWARD. The heading below is
 * `atan2(dir.x, dir.z)`, which measures from +Z; a body modelled along +X without this rotation
 * drives sideways down every street. PHOENIX's van model records the same one-line fix, and it is
 * cheaper to copy the lesson than to re-derive it from a bus crabbing along the Galgenbergstraße.
 */
export function createBusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wheelR = 0.5;
  const floor = wheelR * 1.6;

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const tag = new Float32Array(g.attributes.position.count).fill(part);
    g.setAttribute('aPart', new THREE.BufferAttribute(tag, 1));
    parts.push(g);
  };

  // Body, sitting on the axles rather than on the ground.
  const bodyH = BUS_HEIGHT_M - floor;
  box(BUS_LENGTH_M, bodyH, BUS_WIDTH_M, 0, floor + bodyH / 2, 0, BUS_PART.body);

  // Windows: one band per side, plus the windscreen. Inset a hair so they read as glass rather
  // than as paint.
  const bandH = bodyH * 0.42;
  const bandY = floor + bodyH * 0.62;
  box(BUS_LENGTH_M * 0.9, bandH, BUS_WIDTH_M + 0.06, 0, bandY, 0, BUS_PART.glass);
  box(0.12, bandH * 1.05, BUS_WIDTH_M * 0.92, BUS_LENGTH_M / 2, bandY, 0, BUS_PART.glass);

  // Four wheels on two axles.
  for (const x of [BUS_LENGTH_M * 0.34, -BUS_LENGTH_M * 0.3]) {
    for (const z of [BUS_WIDTH_M / 2 - 0.12, -BUS_WIDTH_M / 2 + 0.12]) {
      const g = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 12);
      g.rotateX(Math.PI / 2);
      g.translate(x, wheelR, z);
      const tag = new Float32Array(g.attributes.position.count).fill(BUS_PART.tyre);
      g.setAttribute('aPart', new THREE.BufferAttribute(tag, 1));
      parts.push(g);
    }
  }

  // Headlights, so the front is readable at a distance and the heading is obvious.
  for (const z of [BUS_WIDTH_M / 2 - 0.45, -BUS_WIDTH_M / 2 + 0.45]) {
    box(0.14, 0.3, 0.5, BUS_LENGTH_M / 2, floor + 0.3, z, BUS_PART.light);
  }

  const merged = mergeGeometries(parts);
  merged.rotateY(-Math.PI / 2);
  return merged;
}

/** Minimal merge: every part is a non-indexed box/cylinder with the same attribute set. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'aPart']) {
    const arrays = nonIndexed.map((g) => g.attributes[name].array as Float32Array);
    const size = nonIndexed[0].attributes[name].itemSize;
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const a of arrays) {
      merged.set(a, at);
      at += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, size));
  }
  for (const g of nonIndexed) g.dispose();
  return out;
}

const VERTEX = /* glsl */ `
in float aPart;
out float vPart;
out vec3 vNormal;
void main() {
  vPart = aPart;
  vNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
in float vPart;
in vec3 vNormal;
out vec4 outColour;
uniform vec3 uBody;

void main() {
  vec3 colour = uBody;
  float emissive = 0.0;
  if (vPart > 2.5)      { colour = vec3(1.0, 0.95, 0.82); emissive = 1.0; }
  else if (vPart > 1.5) { colour = vec3(0.07, 0.07, 0.08); }
  else if (vPart > 0.5) { colour = vec3(0.10, 0.14, 0.18); }

  // A single fixed key light. The campus is lit by an environment this vehicle does not sample,
  // and matching it exactly matters far less than the shape reading as solid from every angle.
  float lambert = max(dot(normalize(vNormal), normalize(vec3(0.4, 0.9, 0.2))), 0.0);
  outColour = vec4(colour * mix(0.45 + 0.75 * lambert, 1.0, emissive), 1.0);
}
`;

export interface DriveLeg {
  from: string;
  to: string;
  distanceM: number;
  driveSeconds: number;
  points: [number, number][];
}

export interface ShuttleLayer {
  group: THREE.Group;
  /** Advance the animation. `seconds` is wall clock, not the week. */
  tick(seconds: number): void;
  setVisible(visible: boolean): void;
  visible(): boolean;
  /** Scene position, for tests and for anything that wants to follow it. */
  position(): { x: number; z: number } | null;
  legs(): DriveLeg[];
  dispose(): void;
}

export async function loadShuttle(
  aoiId: string,
  base: string,
  ext: WorldExtent,
  groundAt: (x: number, z: number) => number | null,
  bodyColour = 0xc9532b
): Promise<ShuttleLayer | null> {
  let doc: { legs?: DriveLeg[] };
  try {
    const response = await fetch(`${base}/${aoiId}/drive-route.json`);
    if (!response.ok) return null;
    doc = await response.json();
  } catch {
    // A site with one campus has no route file, and that is not an error — it has nowhere to
    // drive to. Returning null keeps the scene identical to what it was before this layer existed.
    return null;
  }
  const legs = (doc.legs ?? []).filter((l) => l.points.length > 1);
  if (!legs.length) return null;

  const group = new THREE.Group();
  group.name = 'shuttle';

  // One leg for now — the AOIs have two campuses each. More legs would need a schedule to decide
  // which one is running, and inventing a timetable is exactly what this layer must not do.
  const leg = legs[0];
  const points = leg.points.map(([lon, lat]) => {
    const flat = toWorld(lon, lat, ext, 0);
    const ground = groundAt(flat.x, flat.z);
    return new THREE.Vector3(flat.x, (ground ?? 0) + LIFT_M, flat.z);
  });

  // Cumulative length, so the vehicle moves at a constant speed rather than at a constant number
  // of points per second — OSM digitises corners densely and straights sparsely, and stepping by
  // index makes a bus crawl round bends and rocket down the straight bits.
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const total = cumulative[cumulative.length - 1];

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uBody: { value: new THREE.Color(bodyColour) } },
  });
  const mesh = new THREE.Mesh(createBusGeometry(), material);
  mesh.frustumCulled = false;
  group.add(mesh);

  let elapsed = 0;
  let here: { x: number; z: number } | null = null;
  const up = new THREE.Vector3(0, 1, 0);

  const at = (distance: number): { pos: THREE.Vector3; dir: THREE.Vector3 } => {
    const clamped = Math.min(Math.max(distance, 0), total);
    let i = 1;
    while (i < cumulative.length - 1 && cumulative[i] < clamped) i += 1;
    const span = cumulative[i] - cumulative[i - 1] || 1;
    const local = (clamped - cumulative[i - 1]) / span;
    const pos = new THREE.Vector3().lerpVectors(points[i - 1], points[i], local);
    const dir = new THREE.Vector3().subVectors(points[i], points[i - 1]);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    return { pos, dir: dir.normalize() };
  };

  const apply = () => {
    // The road's own time, so the vehicle moves at the speed the network says it can.
    const crossing = Math.max(leg.driveSeconds, 30);
    const cycle = 2 * (crossing + STOP_SECONDS);
    const phase = ((elapsed % cycle) + cycle) % cycle;

    let distance: number;
    let reverse = false;
    if (phase < crossing) {
      distance = (phase / crossing) * total;
    } else if (phase < crossing + STOP_SECONDS) {
      distance = total;
    } else if (phase < 2 * crossing + STOP_SECONDS) {
      const back = (phase - crossing - STOP_SECONDS) / crossing;
      distance = (1 - back) * total;
      reverse = true;
    } else {
      distance = 0;
      reverse = true;
    }

    const { pos, dir } = at(distance);
    if (reverse) dir.negate();
    mesh.position.copy(pos);
    mesh.quaternion.setFromAxisAngle(up, Math.atan2(dir.x, dir.z));
    here = { x: pos.x, z: pos.z };
  };

  apply();

  return {
    group,
    tick(seconds) {
      elapsed += seconds;
      apply();
    },
    setVisible(visible) {
      group.visible = visible;
    },
    visible() {
      return group.visible;
    },
    position() {
      return group.visible ? here : null;
    },
    legs() {
      return legs;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
