import { describe, expect, it } from 'vitest';

import { footprintRect, type Pt } from '../footprintRect';

const rect = (w: number, d: number): Pt[] => [
  { x: 0, z: 0 },
  { x: w, z: 0 },
  { x: w, z: d },
  { x: 0, z: d },
];
const rotate = (pts: Pt[], deg: number): Pt[] => {
  const r = (deg * Math.PI) / 180;
  return pts.map((p) => ({ x: p.x * Math.cos(r) - p.z * Math.sin(r), z: p.x * Math.sin(r) + p.z * Math.cos(r) }));
};

describe('footprintRect (minimum-area rectangle, long side along, along points east)', () => {
  it('finds an axis-aligned hall', () => {
    const r = footprintRect(rect(100, 40));
    expect(r.theta).toBeCloseTo(0);
    expect(r.lengthM).toBeCloseTo(100);
    expect(r.widthM).toBeCloseTo(40);
    expect(r.centre.x).toBeCloseTo(50);
    expect(r.centre.z).toBeCloseTo(20);
  });

  it('follows a rotated hall and keeps the long side along', () => {
    const r = footprintRect(rotate(rect(100, 40), 30));
    expect(r.theta).toBeCloseTo((30 * Math.PI) / 180);
    expect(r.lengthM).toBeCloseTo(100);
    expect(r.widthM).toBeCloseTo(40);
  });

  it('points along east even when the outline is listed the other way round', () => {
    const r = footprintRect(rotate(rect(100, 40), 150));
    expect(Math.cos(r.theta)).toBeGreaterThan(0);
    expect(r.lengthM).toBeCloseTo(100);
  });

  it('points north (-z) for an exactly north-south hall', () => {
    const r = footprintRect(rect(40, 100));
    expect(Math.sin(r.theta)).toBeCloseTo(-1);
    expect(r.lengthM).toBeCloseTo(100);
  });

  it('lies on a wall of an L-shaped outline, not on the vertex average, and contains every corner', () => {
    // A 100 x 40 hall with a 30 x 30 wing on one end, both rotated by 61.5 degrees.
    const l = rotate(
      [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 40 },
        { x: 30, z: 40 },
        { x: 30, z: 70 },
        { x: 0, z: 70 },
      ],
      61.5
    );
    const r = footprintRect(l);
    const deg = (((r.theta * 180) / Math.PI) % 90 + 90) % 90;
    expect(deg).toBeCloseTo(61.5, 5);
    const c = Math.cos(r.theta);
    const s = Math.sin(r.theta);
    for (const p of l) {
      const dx = p.x - r.centre.x;
      const dz = p.z - r.centre.z;
      expect(Math.abs(dx * c + dz * s)).toBeLessThanOrEqual(r.lengthM / 2 + 1e-6);
      expect(Math.abs(-dx * s + dz * c)).toBeLessThanOrEqual(r.widthM / 2 + 1e-6);
    }
  });
});
