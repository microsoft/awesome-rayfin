import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  easeInOutCubic,
  liftForDistance,
  sampleFlight,
  type Viewpoint,
} from '../cameraFlight';

const viewpoint = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) =>
  ({
    position: new THREE.Vector3(px, py, pz),
    target: new THREE.Vector3(tx, ty, tz),
  }) satisfies Viewpoint;

/**
 * The three villages sit on one terrain, and the camera flies between them rather than cutting.
 * These tests pin the properties that make that read as one continuous valley.
 */
describe('camera flight', () => {
  const from = viewpoint(0, 1000, 0, 0, 0, 0);
  const to = viewpoint(4000, 1000, 3000, 4000, 0, 3000);
  const lift = liftForDistance(from.target.distanceTo(to.target));

  it('starts exactly on the viewpoint it left', () => {
    const at = sampleFlight(from, to, lift, 0);
    expect(at.position.distanceTo(from.position)).toBeCloseTo(0);
    expect(at.target.distanceTo(from.target)).toBeCloseTo(0);
  });

  it('finishes exactly on the viewpoint it was asked for', () => {
    // The arc must contribute nothing at the end, or the camera settles above the framed shot and
    // every village is subtly off its intended composition.
    const at = sampleFlight(from, to, lift, 1);
    expect(at.position.distanceTo(to.position)).toBeCloseTo(0);
    expect(at.target.distanceTo(to.target)).toBeCloseTo(0);
  });

  it('rises above the straight line in the middle', () => {
    const at = sampleFlight(from, to, lift, 0.5);
    const straightLineY = (from.position.y + to.position.y) / 2;
    expect(at.position.y).toBeGreaterThan(straightLineY);
  });

  it('keeps moving towards the destination throughout', () => {
    // A cut would jump; a flight closes the gap monotonically.
    let previous = Infinity;
    for (let k = 0; k <= 1.0001; k += 0.1) {
      const remaining = sampleFlight(from, to, lift, k).target.distanceTo(to.target);
      expect(remaining).toBeLessThan(previous);
      previous = remaining;
    }
    expect(previous).toBeCloseTo(0);
  });

  it('eases: the middle covers more ground than the ends', () => {
    const firstTenth = easeInOutCubic(0.1) - easeInOutCubic(0);
    const middleTenth = easeInOutCubic(0.55) - easeInOutCubic(0.45);
    expect(middleTenth).toBeGreaterThan(firstTenth);
  });

  it('caps the lift so a long hop does not leave the valley behind', () => {
    expect(liftForDistance(2000)).toBeCloseTo(500);
    expect(liftForDistance(100_000)).toBe(2600);
  });

  it('clamps progress outside [0, 1]', () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});
