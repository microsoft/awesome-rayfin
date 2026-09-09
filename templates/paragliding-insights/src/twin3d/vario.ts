import * as THREE from 'three';

/**
 * The vertical-speed palette, in one place.
 *
 * Diverging around zero rather than sequential, because rising air and sinking air are different
 * in kind and not merely in degree — a single ramp would hide the one sign change a pilot reads
 * first. Blue sink · pale neutral · orange climb.
 *
 * ⚠️ It lives here because it is now used from **two shaders and one piece of JavaScript**: the
 * flight ribbon (§7 phase 2), the live traffic markers and their trails (phase 4). PLAN §2.1
 * records what happens when constants like these are repeated per shader — they are fine until one
 * of them is edited, and then two things that should match quietly stop matching.
 */

const SINK: [number, number, number] = [0.16, 0.36, 0.62];
const NEUTRAL: [number, number, number] = [0.94, 0.93, 0.9];
const CLIMB: [number, number, number] = [0.85, 0.42, 0.11];

/**
 * The vario value that saturates the ramp, in m/s.
 *
 * 4 m/s is a strong Alpine thermal. Higher and an ordinary day renders as uniformly pale; lower
 * and everything above a gentle climb clips to the same orange.
 */
export const VARIO_SCALE_MS = 4;

/** The same ramp as GLSL, for the places that colour a mesh from JavaScript. */
export function varioColour(ms: number | null, scale = VARIO_SCALE_MS): THREE.Color {
  const t = Math.max(-1, Math.min(1, (ms ?? 0) / scale));
  const [from, to] = t < 0 ? [NEUTRAL, SINK] : [NEUTRAL, CLIMB];
  const k = Math.abs(t);
  return new THREE.Color(
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k
  );
}

/** Drop-in for any fragment shader that needs the ramp. Declares `varioColour(float, float)`. */
export const VARIO_GLSL = /* glsl */ `
vec3 varioColour(float ms, float scale) {
  vec3 sink    = vec3(${SINK.join(', ')});
  vec3 neutral = vec3(${NEUTRAL.join(', ')});
  vec3 climb   = vec3(${CLIMB.join(', ')});
  float t = clamp(ms / scale, -1.0, 1.0);
  return t < 0.0 ? mix(neutral, sink, -t) : mix(neutral, climb, t);
}
`;
