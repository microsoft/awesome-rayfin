import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';

/**
 * The walk between two buildings, drawn on the ground it actually crosses.
 *
 * A number in a panel ("6 Minuten") is unverifiable — the reader has no way to tell a routed answer
 * from a straight line times a fudge factor. Drawing the line is what makes it checkable: anyone who
 * knows the campus can see at a glance whether the route goes round the building or through it,
 * which is the whole reason a campus map exists.
 *
 * ⚠️ ONE ROUTE AT A TIME, ON PURPOSE. This is not the flow layer: that one answers "where does the
 * load fall" for the whole week and needs its own aggregation. This answers "can I get from my
 * lecture to my next one", which is a question about one person and one gap, and drawing every
 * possible walk at once would answer neither.
 */

const VERTEX = /* glsl */ `
in float aSide;
in float aAlong;

out float vSide;
out float vAlong;

uniform float uWidth;

void main() {
  vSide = aSide;
  vAlong = aAlong;

  // The normal attribute carries the ribbon's sideways direction, computed on the CPU where the
  // neighbouring points are known. Widening here rather than in the buffer keeps the line legible
  // when the camera pulls back without rebuilding geometry.
  vec3 p = position + normal * aSide * uWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in float vSide;
in float vAlong;
out vec4 outColour;

uniform float uTime;
uniform vec3 uColour;
uniform float uOpacity;
uniform float uLength;

void main() {
  // Soft edges so the route reads as a painted line rather than a strip of tape.
  float across = 1.0 - abs(vSide);
  float edge = smoothstep(0.0, 0.35, across);

  // A dash travelling from origin to destination. It carries the DIRECTION of the walk, which a
  // static line cannot, and direction is what tells you which end is the lecture you are leaving.
  float dashes = uLength / 14.0;
  float travel = fract(vAlong * dashes - uTime * 0.8);
  float dash = smoothstep(0.15, 0.45, travel) * smoothstep(1.0, 0.75, travel);

  outColour = vec4(uColour * (0.65 + 0.6 * dash), uOpacity * edge * (0.55 + 0.45 * dash));
}
`;

export interface WalkRouteLayer {
  group: THREE.Group;
  /** Draw one route. Points are [lon, lat] pairs in order of travel. */
  show(points: [number, number][], colour?: THREE.ColorRepresentation): void;
  clear(): void;
  /** How many points are on screen right now. Zero means nothing is drawn. */
  drawn(): number;
  /** Centre and extent of the drawn route, so a camera can frame it. Null when nothing is drawn. */
  bounds(): { centre: THREE.Vector3; spanM: number } | null;
  /**
   * Where the walking figure is, and how far along. Null when no route is drawn.
   *
   * `seconds` is the whole walk at `WALK_SPEED_MS`, which is what makes this checkable: the
   * figure is not a decoration moving at an arbitrary rate, it takes the time the panel claims.
   */
  walker(): { x: number; z: number; progress: number; seconds: number } | null;
  update(elapsed: number): void;
  dispose(): void;
}

/**
 * ⚠️ THE SAME 1.35 m/s THE DATASET USED, and it has to stay that way.
 *
 * `walk-routes.json` records `walkSpeedMs: 1.35` and derives every `minutes` figure in the walk
 * panel from it. A figure animated at any other speed would contradict the number printed beside
 * it — and of the two, the moving one is the one people believe. If the dataset's assumption ever
 * changes, this changes with it.
 */
const WALK_SPEED_MS = 1.35;

/** Roughly a person: 1.75 m to the top of the head. */
function createWalkerMesh(colour: THREE.ColorRepresentation): THREE.Group {
  const figure = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: colour });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.85, 4, 8), material);
  body.position.y = 0.42 + 0.55;
  figure.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), material);
  head.position.y = 1.58;
  figure.add(head);

  return figure;
}

export function createWalkRouteLayer(
  extent: WorldExtent,
  groundAt: (x: number, z: number) => number | null
): WalkRouteLayer {
  const group = new THREE.Group();
  group.name = 'walk-route';
  // Drawn after the terrain and buildings so the line stays readable where it passes beside a wall.
  group.renderOrder = 12;

  const uniforms = {
    uTime: { value: 0 },
    uWidth: { value: 2.6 },
    uColour: { value: new THREE.Color('#38bdf8') },
    uOpacity: { value: 0.95 },
    uLength: { value: 100 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
  });

  let mesh: THREE.Mesh | null = null;
  let drawnPoints = 0;
  let extentOfRoute: { centre: THREE.Vector3; spanM: number } | null = null;

  // The walking figure, and the polyline it walks. Kept alongside the ribbon rather than inside
  // it because the ribbon is one static mesh and this moves every frame.
  let walkerMesh: THREE.Group | null = null;
  let walkerPath: { x: number; y: number; z: number }[] = [];
  let walkerLengths: number[] = [];
  let walkerTotal = 0;
  let walkerAt: { x: number; z: number; progress: number; seconds: number } | null = null;

  const drop = () => {
    drawnPoints = 0;
    extentOfRoute = null;
    walkerPath = [];
    walkerLengths = [];
    walkerTotal = 0;
    walkerAt = null;
    if (walkerMesh) {
      group.remove(walkerMesh);
      walkerMesh.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
      walkerMesh = null;
    }
    if (!mesh) return;
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  };

  return {
    group,

    show(points, colour = '#38bdf8') {
      drop();
      if (points.length < 2) return;

      // Project once, and lift onto the terrain. A route drawn at a constant height crosses the
      // Galgenberg embankment in mid-air, which looks like a bug even when the distance is right.
      const world = points.map(([lon, lat]) => {
        const flat = toWorld(lon, lat, extent, 0);
        return { x: flat.x, z: flat.z, y: (groundAt(flat.x, flat.z) ?? 0) + 1.2 };
      });

      const segments = world.length - 1;
      const positions = new Float32Array(segments * 4 * 3);
      const normals = new Float32Array(segments * 4 * 3);
      const side = new Float32Array(segments * 4);
      const along = new Float32Array(segments * 4);
      const indices = new Uint32Array(segments * 6);

      // Cumulative distance drives the dash, so the dashes stay the same size on the ground rather
      // than stretching over long segments.
      let travelled = 0;
      const lengths: number[] = [0];
      for (let i = 0; i < segments; i += 1) {
        travelled += Math.hypot(world[i + 1].x - world[i].x, world[i + 1].z - world[i].z);
        lengths.push(travelled);
      }
      uniforms.uLength.value = Math.max(travelled, 1);

      for (let i = 0; i < segments; i += 1) {
        const a = world[i];
        const b = world[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = -dz / length;
        const nz = dx / length;

        const corners = [
          [a.x, a.y, a.z, -1, lengths[i]],
          [a.x, a.y, a.z, 1, lengths[i]],
          [b.x, b.y, b.z, 1, lengths[i + 1]],
          [b.x, b.y, b.z, -1, lengths[i + 1]],
        ] as const;

        corners.forEach(([x, y, z, s, t], c) => {
          const v = i * 4 + c;
          positions[v * 3] = x;
          positions[v * 3 + 1] = y;
          positions[v * 3 + 2] = z;
          normals[v * 3] = nx;
          normals[v * 3 + 1] = 0;
          normals[v * 3 + 2] = nz;
          side[v] = s;
          along[v] = t / Math.max(travelled, 1);
        });

        const base = i * 4;
        indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));

      uniforms.uColour.value = new THREE.Color(colour);
      mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      group.add(mesh);
      drawnPoints = world.length;

      // The box the walk occupies, used to frame it. `spanM` is the longer horizontal side rather
      // than the walked distance: a route that doubles back covers less ground than it walks, and
      // framing by distance would put the camera much too far away.
      const xs = world.map((p) => p.x);
      const zs = world.map((p) => p.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      extentOfRoute = {
        centre: new THREE.Vector3(
          (minX + maxX) / 2,
          world.reduce((sum, p) => sum + p.y, 0) / world.length,
          (minZ + maxZ) / 2
        ),
        spanM: Math.max(maxX - minX, maxZ - minZ),
      };

      /*
        Somebody actually walking it.

        The dashed ribbon already carries the direction of travel; what it cannot carry is how LONG
        the walk takes, and that is the question the walk lens exists to answer — "have I got time
        between these two lectures". A figure moving at the dataset's own 1.35 m/s turns the
        printed "6 Minuten" into something a viewer can watch and disbelieve if it looks wrong.

        ⚠️ ONE FIGURE, not a crowd, and that is the same restraint the ribbon was built with. This
        layer answers a question about one person and one gap. A stream of walkers would imply a
        number of people, and nobody has published one — the flow lens is where crowds belong, and
        it has the timetable behind it to say how many.
      */
      walkerPath = world;
      walkerLengths = lengths;
      walkerTotal = Math.max(travelled, 1);
      walkerMesh = createWalkerMesh(colour);
      group.add(walkerMesh);
    },

    clear: drop,

    drawn() {
      return drawnPoints;
    },

    bounds() {
      return extentOfRoute;
    },

    walker() {
      return walkerAt;
    },

    update(elapsed) {
      uniforms.uTime.value = elapsed;

      if (!walkerMesh || walkerPath.length < 2) return;

      // Absolute time rather than a delta: the caller already passes a monotonic clock, and
      // deriving the position from it means the figure cannot drift out of step with the distance
      // it is supposed to have covered.
      const seconds = walkerTotal / WALK_SPEED_MS;
      const travelledNow = (elapsed * WALK_SPEED_MS) % walkerTotal;

      let i = 1;
      while (i < walkerLengths.length - 1 && walkerLengths[i] < travelledNow) i += 1;
      const span = walkerLengths[i] - walkerLengths[i - 1] || 1;
      const local = (travelledNow - walkerLengths[i - 1]) / span;
      const a = walkerPath[i - 1];
      const b = walkerPath[i];

      const x = a.x + (b.x - a.x) * local;
      const y = a.y + (b.y - a.y) * local;
      const z = a.z + (b.z - a.z) * local;
      // The ribbon floats 1.2 m up so it clears the ground; a person standing on it would appear
      // to hover, so put the feet back down.
      walkerMesh.position.set(x, y - 1.2, z);
      walkerMesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);

      walkerAt = { x, z, progress: travelledNow / walkerTotal, seconds };
    },

    dispose() {
      drop();
      material.dispose();
    },
  };
}
