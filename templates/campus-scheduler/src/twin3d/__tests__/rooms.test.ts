import { describe, expect, it } from 'vitest';

import { __testing } from '@/twin3d/rooms';

const { triangulate, polygonAreaM2 } = __testing;

/**
 * Room outlines are not convex.
 *
 * L-shaped and U-shaped rooms are ordinary in these buildings, and the cheap way to fill a polygon
 * — a triangle fan from one vertex — spills a wedge of floor outside the wall for any of them. The
 * test that matters is therefore not "does it produce triangles" but "do the triangles cover
 * exactly the polygon", which is what comparing the triangulated area against the shoelace area
 * checks.
 */

/** Total area of a triangulated polygon, from its own triangles. */
function triangulatedArea(points: number[], indices: number[]): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 2, indices[i + 1] * 2, indices[i + 2] * 2];
    total += Math.abs(
      (points[b] - points[a]) * (points[c + 1] - points[a + 1]) -
        (points[c] - points[a]) * (points[b + 1] - points[a + 1])
    );
  }
  return total / 2;
}

describe('triangulate', () => {
  it('fills a rectangle with two triangles', () => {
    const square = [0, 0, 10, 0, 10, 4, 0, 4];
    const indices = triangulate(square);
    expect(indices.length).toBe(6);
    expect(triangulatedArea(square, indices)).toBeCloseTo(40, 6);
  });

  it('fills an L-shaped room without spilling outside it', () => {
    // A fan from vertex 0 across this shape covers area the room does not occupy.
    const shape = [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10];
    const expected = polygonAreaM2(shape);
    expect(expected).toBeCloseTo(10 * 4 + 4 * 6, 6);

    const indices = triangulate(shape);
    expect(indices.length).toBe((shape.length / 2 - 2) * 3);
    expect(triangulatedArea(shape, indices)).toBeCloseTo(expected, 6);
  });

  it('fills a U-shaped room', () => {
    const shape = [0, 0, 12, 0, 12, 10, 9, 10, 9, 3, 3, 3, 3, 10, 0, 10];
    const expected = polygonAreaM2(shape);
    const indices = triangulate(shape);
    expect(triangulatedArea(shape, indices)).toBeCloseTo(expected, 6);
  });

  it('handles either winding order', () => {
    const clockwise = [0, 0, 0, 4, 10, 4, 10, 0];
    const indices = triangulate(clockwise);
    expect(triangulatedArea(clockwise, indices)).toBeCloseTo(40, 6);
  });

  it('returns nothing for a degenerate outline', () => {
    expect(triangulate([0, 0, 1, 1])).toEqual([]);
    expect(triangulate([])).toEqual([]);
  });

  it('terminates on a self-intersecting outline rather than hanging', () => {
    // A bow tie has no ear to clip. The loader must degrade rather than spin: a slightly wrong
    // plate for one room is survivable, a hung page load is not.
    const bowtie = [0, 0, 10, 10, 10, 0, 0, 10];
    const indices = triangulate(bowtie);
    expect(indices.length).toBeGreaterThan(0);
  });
});

describe('polygonAreaM2', () => {
  it('agrees with the pipeline on a known rectangle', () => {
    // The same shoelace the Python side runs, so a room's area is the same number in both.
    expect(polygonAreaM2([0, 0, 8, 0, 8, 5, 0, 5])).toBeCloseTo(40, 6);
  });

  it('is independent of winding direction', () => {
    const a = polygonAreaM2([0, 0, 8, 0, 8, 5, 0, 5]);
    const b = polygonAreaM2([0, 5, 8, 5, 8, 0, 0, 0]);
    expect(a).toBeCloseTo(b, 6);
  });
});
