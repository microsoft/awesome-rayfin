import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { decodeTracks, TRANSIT_MIN_KM } from "./data.mjs";

/**
 * Build a `tracks.binz` payload the way `tools/ais/build_tracks.py` writes it: PLANAR, not
 * interleaved — all the x values, then all the z, then t, then speed.
 */
function encode(points) {
  const n = points.length;
  const buffer = Buffer.alloc(n * 7);
  let offset = 0;
  for (const p of points) { buffer.writeInt16LE(p.x, offset); offset += 2; }
  for (const p of points) { buffer.writeInt16LE(p.z, offset); offset += 2; }
  for (const p of points) { buffer.writeUInt16LE(p.t ?? 0, offset); offset += 2; }
  for (const p of points) { buffer.writeUInt8(p.s ?? 0, offset); offset += 1; }
  return gzipSync(buffer);
}

describe("decodeTracks", () => {
  it("reads the planar layout the builder writes", () => {
    const points = [
      { x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 1000, z: -2000 },
    ];
    const { xs, zs } = decodeTracks(encode(points), points.length);
    expect([...xs]).toEqual([0, 1000, 1000]);
    expect([...zs]).toEqual([0, 0, -2000]);
  });

  it("refuses a payload of the wrong length rather than reading garbage", () => {
    // 🔴 The failure this prevents is silent: a short buffer read as if it were long yields
    // plausible coordinates in the wrong place, and every distance downstream is quietly wrong.
    const points = [{ x: 1, z: 2 }, { x: 3, z: 4 }];
    expect(() => decodeTracks(encode(points), 5)).toThrow(/expected/);
  });

  it("keeps negative metres negative", () => {
    // +z is south and the origin is the area centre, so half the map is negative. An unsigned
    // read would fold the southern half onto the northern one.
    const { xs, zs } = decodeTracks(encode([{ x: -5000, z: -8000 }]), 1);
    expect(xs[0]).toBe(-5000);
    expect(zs[0]).toBe(-8000);
  });
});

describe("the transit rule", () => {
  it("is the same 0.5 km the app publishes with", () => {
    // ⚠️ Pinned as a constant rather than trusted to stay in step by convention. If the app ever
    // moves this threshold, the assistant would otherwise keep quoting the old denominator in the
    // same conversation as the app quotes the new one.
    expect(TRANSIT_MIN_KM).toBe(0.5);
  });
});
