import * as THREE from 'three';

import type { FlightTrack, TrackPoint } from '@/flight/track';

import { VARIO_GLSL, VARIO_SCALE_MS } from './vario';

/**
 * The flight track, drawn as a ribbon through the valley — PLAN §7 phase 2.
 *
 * A ribbon rather than a line, for two reasons that are both about legibility rather than looks.
 * A one-pixel line disappears against a textured hillside at any distance, and WebGL cannot make
 * it thicker (`linewidth` is silently ignored on every desktop driver). A camera-facing strip is
 * the standard answer, and it also gives the track a surface to carry colour.
 *
 * Colour encodes **vertical speed**, which is the one variable a pilot reads first: blue sink,
 * pale neutral, orange climb. The palette is diverging around zero on purpose — where the air was
 * going up and where it was going down are different in kind, not just in degree, so a single
 * sequential ramp would hide the sign change that matters most.
 *
 * This is the one thing on screen allowed to be saturated. Everything under it — the hypsometric
 * terrain, the greyed land cover, the muted buildings — was kept deliberately quiet so that the
 * track owns the top of the contrast range.
 */

const vertexShader = /* glsl */ `
precision highp float;

attribute vec3 aNext;
attribute float aSide;
attribute float aVario;
attribute float aTime;

uniform float uWidthM;
uniform float uHeadT;

out float vVario;
out float vTime;

void main() {
  // Widen the ribbon perpendicular to BOTH the direction of travel and the direction to the eye,
  // so it always presents its face to the camera. A ribbon widened in world space alone vanishes
  // whenever the flight happens to be heading towards the viewer.
  vec3 here = vec3(position.x, position.y, position.z);
  vec3 next = vec3(aNext.x, aNext.y, aNext.z);

  vec3 forward = next - here;
  if (length(forward) < 1e-4) forward = vec3(1.0, 0.0, 0.0);
  forward = normalize(forward);

  vec3 toEye = normalize(cameraPosition - here);
  vec3 sideways = cross(forward, toEye);
  if (length(sideways) < 1e-4) sideways = vec3(0.0, 1.0, 0.0);
  sideways = normalize(sideways);

  vec3 displaced = here + sideways * (aSide * uWidthM * 0.5);

  vVario = aVario;
  vTime = aTime;

  gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uHeadT;
uniform float uVarioScale;

in float vVario;
in float vTime;

out vec4 fragColor;

${VARIO_GLSL}

void main() {
  // The track ahead of the scrubber is not drawn. Showing the whole flight at once and merely
  // marking the position on it gives away the ending — where the pilot got to, how high, whether
  // that ridge worked. Drawing it as it is flown is the difference between a chart and a replay.
  if (vTime > uHeadT) discard;

  vec3 colour = varioColour(vVario, uVarioScale);

  // The most recent stretch is brightened, so the eye can find the glider without a marker
  // competing with the track for attention.
  float recency = clamp(1.0 - (uHeadT - vTime) / 120.0, 0.0, 1.0);
  colour = mix(colour, colour * 1.25 + 0.06, recency * 0.8);

  fragColor = vec4(colour, 1.0);
}
`;

export interface TrackLayer {
  group: THREE.Group;
  /** Move the head of the replay. Seconds from the first fix. */
  setHeadTime(t: number): void;
  /** World position of the glider at a time, for the follow camera. */
  positionAt(t: number): THREE.Vector3;
  dispose(): void;
}

/**
 * Build the ribbon.
 *
 * Two vertices per fix — one either side of the centreline — joined into a triangle strip. For the
 * hero flight that is 12 586 fixes, so ~25 k vertices and ~50 k triangles: trivial next to the
 * terrain, and it all goes to the GPU once.
 */
export function createTrackLayer(
  track: FlightTrack,
  options: { widthM?: number; varioScaleMs?: number } = {}
): TrackLayer {
  const { points } = track;
  const count = points.length;

  const position = new Float32Array(count * 2 * 3);
  const next = new Float32Array(count * 2 * 3);
  const side = new Float32Array(count * 2);
  const vario = new Float32Array(count * 2);
  const time = new Float32Array(count * 2);

  for (let i = 0; i < count; i++) {
    const point = points[i];
    const ahead = points[Math.min(i + 1, count - 1)];
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s;
      position[v * 3] = point.x;
      position[v * 3 + 1] = point.altM;
      position[v * 3 + 2] = point.z;
      next[v * 3] = ahead.x;
      next[v * 3 + 1] = ahead.altM;
      next[v * 3 + 2] = ahead.z;
      side[v] = s === 0 ? -1 : 1;
      vario[v] = point.varioMs;
      time[v] = point.t;
    }
  }

  // Two triangles per segment.
  const indices = new Uint32Array((count - 1) * 6);
  for (let i = 0; i < count - 1; i++) {
    const base = i * 2;
    indices.set(
      [base, base + 1, base + 2, base + 1, base + 3, base + 2],
      i * 6
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aNext', new THREE.BufferAttribute(next, 3));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setAttribute('aVario', new THREE.BufferAttribute(vario, 1));
  geometry.setAttribute('aTime', new THREE.BufferAttribute(time, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uWidthM: { value: options.widthM ?? 26 },
      uHeadT: { value: track.durationS },
      // ±4 m/s covers almost everything an Alpine thermal does. Scaling to the flight's own
      // extremes instead would make a single 8 m/s spike wash out every ordinary climb.
      uVarioScale: { value: options.varioScaleMs ?? VARIO_SCALE_MS },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh);

  const positionAt = (t: number): THREE.Vector3 => {
    const index = findIndex(points, t);
    const a = points[index];
    const b = points[Math.min(index + 1, count - 1)];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 0;
    return new THREE.Vector3(
      a.x + (b.x - a.x) * k,
      a.altM + (b.altM - a.altM) * k,
      a.z + (b.z - a.z) * k
    );
  };

  return {
    group,
    setHeadTime(t: number) {
      material.uniforms.uHeadT.value = t;
    },
    positionAt,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function findIndex(points: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
