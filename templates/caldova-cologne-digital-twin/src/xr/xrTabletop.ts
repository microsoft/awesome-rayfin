import * as THREE from 'three';

/**
 * The city on your table: mixed-reality passthrough on a Meta Quest, the arithmetic only.
 *
 * In the tabletop mode the headset shows the real surroundings, and one core of the twin stands in them as a
 * model. Kept apart from `xrSession.ts` so every number a viewer can feel (default scale, limits,
 * where the model appears, how a grab moves it) is unit-tested without a headset.
 *
 * ⚠️ ONE UNIFORM SCALE FOR EVERYTHING. The model is the 1:1 world seen through a rig scaled by the
 * scale denominator, so terrain, buildings, trees and every live layer shrink by exactly the same
 * factor on all three axes. Nothing is enlarged to be visible: at 1:5000 a 20 m house is 4 mm, and
 * that is the honest size. The panel always states the scale.
 *
 * How it works: three.js composes each eye from `camera.parent.matrixWorld x pose`. With the camera
 * in a rig whose scale is k, one real metre is k metres of the world, so the world appears
 * k times smaller and no scene geometry is touched at all. The mapping is
 *
 *   world = anchor + k * R(-yaw) * (real - table)
 *
 * where `anchor` is the world point that sits on the `table` point of real space and `yaw` turns the
 * model about the vertical.
 */

/** 1:5000: the 7 km Köln city table (fine core in the middle, coarse ring around) is 1.4 m. */
export const TABLETOP_DEFAULT_SCALE = 5000;
/** 1:1000: the core is 3.3 x 3.9 m, wall to wall. Closer than this and the walls are in the way. */
export const TABLETOP_MIN_SCALE = 1000;
/** 1:50000: a 50 km span on one table (1 m). */
export const TABLETOP_MAX_SCALE = 50000;
/** Scale change per second at full stick: a factor of e^1.2 = 3.3. */
export const TABLETOP_SCALE_RATE = 1.2;
/** Turn rate at full stick, radians per second. Smooth, because the surroundings stay still. */
export const TABLETOP_TURN_RATE = 1.2;
/** Raise or lower rate at full stick, metres per second. */
export const TABLETOP_LIFT_RATE = 0.4;
/** Where the model appears: this far in front of the head and this far below the eyes. */
export const TABLETOP_AHEAD_M = 0.6;
export const TABLETOP_BELOW_EYES_M = 0.5;
/** The model never goes below this height above the floor. */
export const TABLETOP_MIN_HEIGHT_M = 0.2;

export interface TabletopPose {
  /** World point (metres, scene coordinates) that sits on the table point. */
  anchor: THREE.Vector3;
  /** Real-space point (metres, local-floor reference space) the anchor sits on. */
  table: THREE.Vector3;
  /** Model rotation about the vertical, radians. 0 shows north (-Z) as real-space -Z. */
  yaw: number;
  /** Scale denominator k: 1:k. */
  scale: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Put the rig where it makes the world look like `pose`. */
export function applyTabletop(rig: THREE.Object3D, pose: TabletopPose): void {
  rig.scale.setScalar(pose.scale);
  rig.quaternion.setFromAxisAngle(UP, -pose.yaw);
  // position = anchor - k * R(-yaw) * table
  const offset = pose.table.clone().applyQuaternion(rig.quaternion).multiplyScalar(pose.scale);
  rig.position.copy(pose.anchor).sub(offset);
  rig.updateMatrixWorld(true);
}

/** Real-space point to world point under a pose. */
export function realToWorld(pose: TabletopPose, real: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out
    .copy(real)
    .sub(pose.table)
    .applyAxisAngle(UP, -pose.yaw)
    .multiplyScalar(pose.scale)
    .add(pose.anchor);
}

/** World point to real-space point under a pose. */
export function worldToReal(pose: TabletopPose, world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out
    .copy(world)
    .sub(pose.anchor)
    .divideScalar(pose.scale)
    .applyAxisAngle(UP, pose.yaw)
    .add(pose.table);
}

/** Heading of a direction projected on the floor, radians; 0 is real-space -Z. */
export function yawOf(forward: THREE.Vector3, fallback = 0): number {
  if (forward.x * forward.x + forward.z * forward.z < 1e-8) return fallback;
  return Math.atan2(-forward.x, -forward.z);
}

/**
 * Where the model appears at the start: in front of the viewer, below the eyes, turned so that
 * the viewer looks at it from the south (north of the city points away).
 */
export function initialTable(
  headReal: THREE.Vector3,
  headForwardReal: THREE.Vector3,
  aheadM = TABLETOP_AHEAD_M,
): { table: THREE.Vector3; yaw: number } {
  const yaw = yawOf(headForwardReal);
  const table = new THREE.Vector3(
    headReal.x - Math.sin(yaw) * aheadM,
    Math.max(TABLETOP_MIN_HEIGHT_M, headReal.y - TABLETOP_BELOW_EYES_M),
    headReal.z - Math.cos(yaw) * aheadM,
  );
  return { table, yaw };
}

/**
 * How far in front of the head the model's centre goes: the default, or far enough that a large
 * model's near edge stays a hand's width in front of the viewer instead of inside them.
 */
export function aheadFor(extentWorldM: number | undefined, scale: number): number {
  if (!extentWorldM) return TABLETOP_AHEAD_M;
  return Math.max(TABLETOP_AHEAD_M, extentWorldM / scale / 2 + 0.3);
}

/** New scale after a stick input; up (positive) makes the model BIGGER, i.e. k smaller. */
export function scaleStep(scale: number, stickUp: number, dt: number): number {
  if (stickUp === 0) return scale;
  const next = scale * Math.exp(-stickUp * TABLETOP_SCALE_RATE * dt);
  return THREE.MathUtils.clamp(next, TABLETOP_MIN_SCALE, TABLETOP_MAX_SCALE);
}

/** New yaw after a stick input; right (positive) turns the model clockwise seen from above. */
export function yawStep(yaw: number, stickRight: number, dt: number): number {
  return yaw - stickRight * TABLETOP_TURN_RATE * dt;
}

/** New table height after a stick input; up (positive) raises it. */
export function liftStep(y: number, stickUp: number, dt: number): number {
  return Math.max(TABLETOP_MIN_HEIGHT_M, y + stickUp * TABLETOP_LIFT_RATE * dt);
}

/**
 * A grab: the model follows the hand by the hand's own displacement, so it does not jump to the
 * controller when the grip closes.
 */
export class TabletopGrab {
  private hand: string | null = null;
  private readonly handStart = new THREE.Vector3();
  private readonly tableStart = new THREE.Vector3();

  get holding(): string | null {
    return this.hand;
  }

  /** Call every frame per hand. Returns the new table point while this hand holds the model. */
  update(hand: string, squeezed: boolean, handReal: THREE.Vector3, table: THREE.Vector3): THREE.Vector3 | null {
    if (this.hand === null && squeezed) {
      this.hand = hand;
      this.handStart.copy(handReal);
      this.tableStart.copy(table);
    }
    if (this.hand !== hand) return null;
    if (!squeezed) {
      this.hand = null;
      return null;
    }
    const next = this.tableStart.clone().add(handReal).sub(this.handStart);
    next.y = Math.max(TABLETOP_MIN_HEIGHT_M, next.y);
    return next;
  }

  reset() {
    this.hand = null;
  }
}

/**
 * "1:5.000" for the scale, two significant digits, digits grouped for the locale. A value the
 * rounding changed by more than half a percent is marked "≈": the panel states the scale, and a
 * rounded figure must not pass for an exact one.
 */
export function scaleLabel(scale: number, locale = 'en-US'): string {
  const step = 10 ** (Math.floor(Math.log10(scale)) - 1);
  const rounded = Math.round(scale / step) * step;
  const approximate = Math.abs(rounded - scale) / scale > 0.005;
  return `${approximate ? '≈ ' : ''}1:${rounded.toLocaleString(locale)}`;
}

/**
 * Four vertical planes around a scene rectangle [minX, minZ, maxX, maxZ], normals pointing in.
 * For `renderer.clippingPlanes`: the live layers know nothing of the table's edge, and a supply
 * line running on past the model would hang in mid-air.
 */
export function footprintPlanes(rect: readonly [number, number, number, number]): THREE.Plane[] {
  const [minX, minZ, maxX, maxZ] = rect;
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -minX),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), maxX),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -minZ),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), maxZ),
  ];
}
