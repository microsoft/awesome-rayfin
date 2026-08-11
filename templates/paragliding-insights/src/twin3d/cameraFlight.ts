import * as THREE from 'three';

/** A camera placement: where it sits, and what it orbits around. */
export interface Viewpoint {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Slow at both ends, quick through the middle — travel, rather than a lurch. */
export function easeInOutCubic(k: number): number {
  const clamped = Math.min(1, Math.max(0, k));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/**
 * How far to rise mid-flight, for a hop of a given ground distance.
 *
 * Rising shows the stretch of valley between the two villages, which is the whole point of flying
 * instead of cutting. The cap stops a long hop from climbing so high that the valley — the thing
 * being demonstrated as continuous — is left behind.
 */
export function liftForDistance(distanceM: number): number {
  return Math.min(distanceM * 0.25, 2600);
}

/**
 * The camera placement partway through a flight, at progress `k` in [0, 1].
 *
 * The lift is a half-sine, so it contributes exactly nothing at either end: the flight starts on
 * the viewpoint it left and finishes on the viewpoint it was asked for, with no drift. Getting
 * that wrong is easy and shows up as the camera settling slightly above the framed shot.
 */
export function sampleFlight(
  from: Viewpoint,
  to: Viewpoint,
  liftM: number,
  k: number
): Viewpoint {
  const eased = easeInOutCubic(k);
  const position = new THREE.Vector3().lerpVectors(from.position, to.position, eased);
  position.y += Math.sin(Math.PI * eased) * liftM;
  return {
    position,
    target: new THREE.Vector3().lerpVectors(from.target, to.target, eased),
  };
}
