/**
 * The rectangle the hall interior is laid out in: the MINIMUM-AREA bounding rectangle of the measured
 * footprint, in world metres (x east, +z south).
 *
 * ⚠️ Same rule as principal_axis() in tools/data/generate_operations.py, which sizes the zones and
 * rack rows from it: one side lies on a hull edge (a real wall), the long side is "along", and along
 * points east (north when exactly north-south). Both frames share east, so goods-in and the docks
 * land at the same physical ends although northing is inverted between them.
 *
 * Not the vertex covariance (measured 2026-10-21): the Confex outline has 28 corners on two wall
 * directions, and the covariance gave 32°, wrong for both walls (main hall 61.5°). The twin uses
 * one rectangle over the whole building (191 × 132 m).
 */
export interface Pt {
  x: number;
  z: number;
}

export interface FootprintRect {
  /** Angle of `along` from +x towards +z (world), as used by rotation.y = -theta. */
  theta: number;
  centre: Pt;
  lengthM: number;
  widthM: number;
}

function hull(points: Pt[]): Pt[] {
  const pts = [...new Map(points.map((p) => [`${p.x},${p.z}`, p])).values()].sort((a, b) => a.x - b.x || a.z - b.z);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Pt[] = [];
  const upper: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function extent(points: Pt[], t: number) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const al = points.map((p) => p.x * c + p.z * s);
  const ac = points.map((p) => -p.x * s + p.z * c);
  return { a0: Math.min(...al), a1: Math.max(...al), c0: Math.min(...ac), c1: Math.max(...ac) };
}

export function footprintRect(points: Pt[]): FootprintRect {
  const h = hull(points);
  let t = 0;
  let best = Infinity;
  for (let i = 0; i < h.length; i += 1) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const ti = Math.atan2(b.z - a.z, b.x - a.x);
    const e = extent(points, ti);
    const area = (e.a1 - e.a0) * (e.c1 - e.c0);
    if (area < best - 1e-9) {
      best = area;
      t = ti;
    }
  }
  let e = extent(points, t);
  if (e.c1 - e.c0 > e.a1 - e.a0) {
    t += Math.PI / 2;
    e = extent(points, t);
  }
  // East, or north (-z in this frame) when exactly north-south.
  if (Math.cos(t) < -1e-9 || (Math.abs(Math.cos(t)) <= 1e-9 && Math.sin(t) > 0)) {
    t += Math.PI;
    e = extent(points, t);
  }
  t = Math.atan2(Math.sin(t), Math.cos(t));
  const am = (e.a0 + e.a1) / 2;
  const cm = (e.c0 + e.c1) / 2;
  return {
    theta: t,
    centre: { x: am * Math.cos(t) - cm * Math.sin(t), z: am * Math.sin(t) + cm * Math.cos(t) },
    lengthM: e.a1 - e.a0,
    widthM: e.c1 - e.c0,
  };
}
