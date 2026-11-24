import * as THREE from 'three';

/**
 * Flying through the twin in a headset: the arithmetic, with no WebXR in it.
 *
 * Kept apart from `xrSession.ts` so that every number a viewer can feel (dead zone, speed curve,
 * snap angle, the pivot of a turn) is unit-tested without a headset. The session module only reads
 * the controllers and hands the values in here.
 *
 * ⚠️ ONE WORLD UNIT IS ONE METRE, AND THE HEADSET AGREES. WebXR reports poses in metres, the twin
 * is built in metres (EPSG:25832 and DHHN2016), so the viewer stands in Köln at true size: the
 * Frauenkirche towers are 99 m over your head and a tram is 2.4 m wide. There is no world scale in
 * the FLY rig, and there must not be one. Scaling it would shrink the viewer instead of enlarging
 * anything, which reads as a model railway while pretending to be 1:1.
 *
 * The tabletop mode (`xrTabletop.ts`) is the one, declared exception: there the WHOLE world is
 * shown at one stated uniform scale (1:5000 by default) and the panel says so. Uniform on every
 * axis, so nothing is exaggerated relative to anything else.
 */

/** Thumbsticks rest a few percent off centre. Below this the stick reads as zero. */
export const STICK_DEAD_ZONE = 0.18;

/**
 * Speed at the reference height, metres per second.
 *
 * Like the desktop drone, speed scales with height above ground so that close and precise are the
 * same thing: 1.5 m above the street the stick is a brisk walk, at rooftop height a cyclist, and a
 * few hundred metres up the Altstadt crosses in about twenty seconds.
 */
export const XR_CRUISE_MS = 14;
export const XR_REFERENCE_AGL_M = 40;
export const XR_AGL_SCALE_MIN = 0.12;
export const XR_AGL_SCALE_MAX = 9;
/** Grip held: this much faster. */
export const XR_BOOST = 4;

/** Comfort snap turn. 30 degrees is the common default and what Quest's own home uses. */
export const SNAP_TURN_RAD = THREE.MathUtils.degToRad(30);
/** The stick must pass this to turn, and come back under {@link SNAP_REARM} before it turns again. */
export const SNAP_TRIGGER = 0.7;
export const SNAP_REARM = 0.35;

/** Velocity smoothing. Instant starts and stops are the strongest motion-sickness trigger there is. */
export const XR_ACCELERATE_TAU_S = 0.25;
export const XR_BRAKE_TAU_S = 0.18;

/**
 * How far below the surface the viewer may go, metres.
 *
 * Negative: the head is held at least 1.6 m ABOVE the ground, eye height of a pedestrian. This twin
 * models nothing underground, so below the surface there is only the underside of the terrain.
 */
export const XR_MAX_DEPTH_BELOW_GROUND_M = -1.6;
/** Above this nothing in the scene gets any clearer, only smaller. */
export const XR_MAX_ALTITUDE_M = 2500;

/** Rescale a stick axis so the dead zone does not leave a jump at its edge. */
export function deadZone(value: number, zone = STICK_DEAD_ZONE): number {
  const magnitude = Math.abs(value);
  if (magnitude <= zone) return 0;
  return (Math.sign(value) * (magnitude - zone)) / (1 - zone);
}

/** Speed for a height above ground; `null` (off the core) uses the reference speed. */
export function xrSpeedForAgl(aglM: number | null, boosted: boolean): number {
  const scale =
    aglM === null
      ? 1
      : THREE.MathUtils.clamp(Math.abs(aglM) / XR_REFERENCE_AGL_M, XR_AGL_SCALE_MIN, XR_AGL_SCALE_MAX);
  return XR_CRUISE_MS * scale * (boosted ? XR_BOOST : 1);
}

export interface FlyInput {
  /** Left stick, already dead-zoned. y is forward-positive (gamepad y is inverted upstream). */
  moveX: number;
  moveY: number;
  /** Right stick vertical, dead-zoned, up-positive. */
  climb: number;
}

/**
 * Desired velocity, world metres per second.
 *
 * Forward follows the HEAD, pitch included: look down at a street and push the stick and you dive
 * towards it. That is what "flying" means and it needs no extra control. Strafe stays horizontal,
 * because a sideways move that tilts with the head is the one that makes people queasy. Climb is
 * pure world-up.
 */
export function desiredVelocity(
  input: FlyInput,
  headForward: THREE.Vector3,
  speedMs: number,
  out = new THREE.Vector3()
): THREE.Vector3 {
  out.set(0, 0, 0);
  if (input.moveY !== 0) out.addScaledVector(headForward, input.moveY);
  if (input.moveX !== 0) {
    // Right-hand side of the head, flattened. Forward is -Z in three, so right = forward x up.
    const right = new THREE.Vector3(-headForward.z, 0, headForward.x);
    if (right.lengthSq() > 1e-8) out.addScaledVector(right.normalize(), input.moveX);
  }
  if (input.climb !== 0) out.y += input.climb;
  // Diagonal stick is not faster than straight stick.
  const length = out.length();
  if (length > 1) out.divideScalar(length);
  return out.multiplyScalar(speedMs);
}

/** Frame-rate-independent approach of the current velocity towards the desired one. */
export function smoothVelocity(
  current: THREE.Vector3,
  desired: THREE.Vector3,
  dt: number
): THREE.Vector3 {
  const tau = desired.lengthSq() > current.lengthSq() ? XR_ACCELERATE_TAU_S : XR_BRAKE_TAU_S;
  const k = 1 - Math.exp(-dt / tau);
  current.lerp(desired, k);
  if (desired.lengthSq() === 0 && current.lengthSq() < 0.0025) current.set(0, 0, 0);
  return current;
}

/**
 * Snap turn as a latch: one turn per flick, not one per frame.
 *
 * Returns the yaw to apply this frame (0, +snap or -snap). A stick pushed right turns right, which
 * in three's right-handed, Y-up frame is a NEGATIVE rotation about Y.
 */
export class SnapTurn {
  private armed = true;

  update(stickX: number): number {
    if (!this.armed) {
      if (Math.abs(stickX) < SNAP_REARM) this.armed = true;
      return 0;
    }
    if (Math.abs(stickX) >= SNAP_TRIGGER) {
      this.armed = false;
      return stickX > 0 ? -SNAP_TURN_RAD : SNAP_TURN_RAD;
    }
    return 0;
  }
}

/**
 * Turn the rig about the viewer's HEAD rather than about the rig's own origin.
 *
 * The rig origin is the centre of the play space on the floor, and the head is wherever the viewer
 * is standing in it. Rotating about the origin swings a viewer who stands a metre off centre round
 * in a two-metre arc on every snap, which feels like being shoved. Rotating about the head is a
 * pure turn.
 */
export function turnRigAboutHead(
  rig: THREE.Object3D,
  headWorld: THREE.Vector3,
  angleRad: number
): void {
  if (angleRad === 0) return;
  const offset = rig.position.clone().sub(headWorld);
  offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, angleRad);
  rig.position.copy(headWorld).add(offset);
  rig.rotateY(angleRad);
}

/**
 * How far to move the rig vertically so the head stays inside the allowed band.
 * Returns 0 when the head is inside it.
 */
export function altitudeCorrection(headY: number, groundY: number | null): number {
  const floor = (groundY ?? 0) - XR_MAX_DEPTH_BELOW_GROUND_M;
  if (headY < floor) return floor - headY;
  if (headY > XR_MAX_ALTITUDE_M) return XR_MAX_ALTITUDE_M - headY;
  return 0;
}

/** Comfort vignette strength for a speed: none when parked, most of the way in at full tilt. */
export function vignetteFor(speedMs: number, cruiseMs: number): number {
  if (cruiseMs <= 0) return 0;
  return THREE.MathUtils.clamp(speedMs / cruiseMs, 0, 1) * 0.85;
}
