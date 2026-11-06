import * as THREE from 'three';

/**
 * A delivery van, as geometry.
 *
 * ⚠️ IT WAS A BOX. One `BoxGeometry`, tinted per vehicle type — which reads as a van at 22 km and
 * as a brick from the ride-along camera, where the app now invites you to sit beside one for
 * thirty seconds. A twin whose whole claim is measured geometry should not represent its own
 * fleet with the crudest primitive available.
 *
 * Modelled on the 3,5 t box van that does this work in Germany — a Sprinter or Crafter with a
 * dry-freight body — because that is what a pharmaceutical wholesaler's night wave actually looks
 * like. Real proportions: about 6,0 m long, 2,0 m wide, 2,7 m high, on a 3,7 m wheelbase.
 *
 * ⚠️ STILL ONE INSTANCED MESH. Thirty-one vans, each drawn every frame at up to 2 400x speed, so
 * the shape has to cost one draw call. Every part is merged into a single buffer and identified by
 * an `aPart` attribute, which lets the shader paint the body in the vehicle's own colour while
 * keeping glass dark, tyres black and lamps lit — instead of the whole vehicle taking one tint,
 * which is what makes a coloured box look like a box.
 */

/** What each vertex belongs to. Read by the shader; see the note above. */
export const VAN_PART = {
  body: 0,
  glass: 1,
  tyre: 2,
  headlight: 3,
  taillight: 4,
} as const;

/** Length of the modelled van in metres, at scale 1. Everything else is proportional to it. */
export const VAN_LENGTH_M = 6.0;

interface Part {
  geometry: THREE.BufferGeometry;
  part: number;
}

/**
 * Build the van, standing on y = 0 with its nose along +Z.
 *
 * ⚠️ +Z IS FORWARD, AND IT IS NOT ARBITRARY. The tour layer yaws each instance by
 * `atan2(dir.x, dir.z)`, and a rotation about Y by that angle maps the +Z axis onto the direction
 * of travel. Build the van along +X — which reads more naturally in code, and is how this was first
 * written — and the entire fleet drives sideways down every street, which looks like a physics
 * fault rather than an axis convention. The parts below are laid out along +X because that is
 * easier to reason about, then turned once at the end.
 *
 * The wheels also stand ON the ground rather than straddling it: the layer positions an instance
 * at the road surface, so a body centred on the origin would bury half the van in the tarmac.
 */
export function createVanGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];

  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    part: number
  ): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push({ geometry: g, part });
  };

  const L = VAN_LENGTH_M;
  const W = 2.0;
  const H = 2.7;
  const wheelR = 0.36;
  const floor = wheelR * 2; // the body sits on top of the wheels

  // ── cargo body ────────────────────────────────────────────────────────────────────────────────
  // The tall box behind the cab. Two thirds of the length, and the thing that makes the silhouette
  // recognisable at a distance — a delivery van is mostly box.
  const bodyLength = L * 0.62;
  const bodyCentreX = -L / 2 + bodyLength / 2;
  box(bodyLength, H - floor, W, bodyCentreX, floor + (H - floor) / 2, 0, VAN_PART.body);

  // ── cab ───────────────────────────────────────────────────────────────────────────────────────
  // Lower than the body and set forward, with a windscreen raked back. Two boxes rather than a
  // tapered hull: at the range this is ever seen, the step from cab to body is the readable
  // feature and the taper is not.
  const cabLength = L - bodyLength;
  const cabHeight = (H - floor) * 0.78;
  const cabCentreX = L / 2 - cabLength / 2;
  box(cabLength, cabHeight, W * 0.97, cabCentreX, floor + cabHeight / 2, 0, VAN_PART.body);

  // Windscreen, slightly proud of the cab so it is never z-fighting with it.
  box(
    cabLength * 0.42,
    cabHeight * 0.5,
    W * 0.99,
    cabCentreX + cabLength * 0.12,
    floor + cabHeight * 0.72,
    0,
    VAN_PART.glass
  );
  // Side windows, one per side, sunk into the cab flanks.
  for (const side of [-1, 1]) {
    box(
      cabLength * 0.5,
      cabHeight * 0.34,
      W * 0.02,
      cabCentreX - cabLength * 0.12,
      floor + cabHeight * 0.74,
      (side * W) / 2,
      VAN_PART.glass
    );
  }

  // ── wheels ────────────────────────────────────────────────────────────────────────────────────
  // Four, on a 3,7 m wheelbase. Cylinders laid on their side; eight radial segments is plenty for
  // something whose largest on-screen size is a few dozen pixels.
  const wheelbase = 3.7;
  for (const axleX of [-wheelbase / 2 - 0.2, wheelbase / 2 - 0.2]) {
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(wheelR, wheelR, 0.22, 8);
      // A cylinder stands up the Y axis by default; a wheel spins about Z across the vehicle.
      g.rotateX(Math.PI / 2);
      g.translate(axleX, wheelR, (side * (W - 0.22)) / 2);
      parts.push({ geometry: g, part: VAN_PART.tyre });
    }
  }

  // ── lamps ─────────────────────────────────────────────────────────────────────────────────────
  // Small, and the reason the fleet is legible at 03:00: headlights face the way the van is going,
  // so a night view shows which direction every vehicle is travelling without any other cue.
  for (const side of [-1, 1]) {
    box(0.12, 0.22, 0.42, L / 2 - 0.06, floor + 0.35, (side * (W - 0.5)) / 2, VAN_PART.headlight);
    box(0.1, 0.26, 0.3, -L / 2 + 0.05, floor + 0.9, (side * (W - 0.35)) / 2, VAN_PART.taillight);
  }

  const merged = mergeParts(parts);
  // Nose from +X to +Z. See the note on the function: this one line is the difference between a
  // delivery fleet and thirty-one vans crabbing down the A 656.
  merged.rotateY(-Math.PI / 2);
  merged.computeBoundingSphere();
  return merged;
}

/** Length of the modelled 7.5 t truck in metres. */
export const TRUCK_LENGTH_M = 8.0;

/**
 * A 7.5 t box truck, as geometry (Caldova Cologne: trucks for the heaviest tours).
 *
 * Modelled on the cab-over distribution truck German wholesalers run in cities (an Atego or a
 * Daily 72C class): about 8,0 m long, 2,5 m wide, 3,6 m high, cab 1,9 m long, 4,4 m wheelbase,
 * twin rear wheels. True size, like the van — vehicles are never scaled up (strict 1:1).
 * Same part scheme and the same +Z-forward convention as `createVanGeometry`, so the tour layer
 * drives it with the same material and the same yaw.
 */
export function createTruckGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, part: number): void => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push({ geometry: g, part });
  };

  const L = TRUCK_LENGTH_M;
  const W = 2.5;
  const H = 3.6;
  const wheelR = 0.45;
  const chassis = wheelR * 2 + 0.15;

  // ── cargo box ── the dominant volume; slightly narrower cab in front of it.
  const cabLength = 1.9;
  const gap = 0.15;
  const boxLength = L - cabLength - gap;
  box(boxLength, H - chassis, W, -L / 2 + boxLength / 2, chassis + (H - chassis) / 2, 0, VAN_PART.body);
  // chassis rail under the box, dark like the tyres
  box(L * 0.92, 0.28, W * 0.7, -0.1, chassis - 0.14, 0, VAN_PART.tyre);

  // ── cab-over cab ──
  const cabHeight = 2.95 - wheelR;
  const cabX = L / 2 - cabLength / 2;
  box(cabLength, cabHeight, W * 0.96, cabX, wheelR + cabHeight / 2, 0, VAN_PART.body);
  box(0.06, cabHeight * 0.36, W * 0.86, L / 2 + 0.01, wheelR + cabHeight * 0.72, 0, VAN_PART.glass);
  for (const side of [-1, 1]) {
    box(cabLength * 0.55, cabHeight * 0.3, 0.04, cabX + 0.1, wheelR + cabHeight * 0.74, (side * W * 0.96) / 2, VAN_PART.glass);
  }

  // ── wheels: single front, twin rear on a 4,4 m wheelbase ──
  const frontX = L / 2 - 1.0;
  const rearX = frontX - 4.4;
  const wheel = (x: number, z: number, width: number): void => {
    const g = new THREE.CylinderGeometry(wheelR, wheelR, width, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x, wheelR, z);
    parts.push({ geometry: g, part: VAN_PART.tyre });
  };
  for (const side of [-1, 1]) {
    wheel(frontX, (side * (W - 0.3)) / 2, 0.28);
    wheel(rearX, (side * (W - 0.5)) / 2, 0.5);
  }

  // ── lamps ──
  for (const side of [-1, 1]) {
    box(0.1, 0.22, 0.38, L / 2 + 0.02, wheelR + 0.55, (side * (W - 0.55)) / 2, VAN_PART.headlight);
    box(0.08, 0.3, 0.3, -L / 2 - 0.02, chassis + 0.25, (side * (W - 0.4)) / 2, VAN_PART.taillight);
  }

  const merged = mergeParts(parts);
  merged.rotateY(-Math.PI / 2);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Merge the parts into one buffer, carrying `aPart` per vertex.
 *
 * ⚠️ HAND-ROLLED RATHER THAN `BufferGeometryUtils.mergeGeometries`. That helper lives in
 * `three/examples/jsm`, which this project does not otherwise depend on, and it refuses to merge
 * geometries whose attribute sets differ — which is exactly what happens here, because the part
 * attribute has to be added per piece. Twenty boxes is not worth a new dependency.
 */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const { geometry } of parts) {
    vertexCount += geometry.getAttribute('position').count;
    indexCount += geometry.getIndex()?.count ?? 0;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const partAttribute = new Float32Array(vertexCount);
  const indices = new Uint16Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const { geometry, part } of parts) {
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    for (let i = 0; i < p.count; i += 1) {
      positions[(vertexOffset + i) * 3] = p.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = p.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = p.getZ(i);
      normals[(vertexOffset + i) * 3] = n.getX(i);
      normals[(vertexOffset + i) * 3 + 1] = n.getY(i);
      normals[(vertexOffset + i) * 3 + 2] = n.getZ(i);
      partAttribute[vertexOffset + i] = part;
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        indices[indexOffset + i] = index.getX(i) + vertexOffset;
      }
      indexOffset += index.count;
    }
    vertexOffset += p.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('aPart', new THREE.BufferAttribute(partAttribute, 1));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * GLSL that turns `aPart` into a colour. Shared so the tour layer's shader stays readable.
 *
 * The body takes the vehicle's own colour — diesel or electric — and nothing else does, which is
 * the whole point: a van whose wheels and windows are also mint green reads as a green box.
 */
export const VAN_PART_GLSL = /* glsl */ `
vec3 vanPartColour(float part, vec3 bodyColour, out float emissive) {
  emissive = 0.0;
  if (part < 0.5) return bodyColour;                       // body
  if (part < 1.5) return vec3(0.10, 0.13, 0.17);           // glass
  if (part < 2.5) return vec3(0.07, 0.07, 0.08);           // tyre
  if (part < 3.5) { emissive = 1.0; return vec3(1.0, 0.96, 0.86); }  // headlight
  emissive = 0.7; return vec3(0.85, 0.12, 0.10);           // taillight
}
`;
