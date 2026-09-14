import { describe, expect, it } from "vitest";
import {
  createBuffers, fill, LIVE_MAX_STEP_M, LIVE_TRAIL_M, LIVE_TRAIL_MAX_POINTS, projector,
  type LiveBuffers, type LiveVessel,
} from "./liveSource";

const FRAME = { centreLat: 54.383, centreLon: 10.175 };
const BOUNDS = { west: 10.05, east: 10.30, south: 54.30, north: 54.47 };
const M_PER_DEG_LAT = 111_132.92 - 559.82 * Math.cos((2 * 54.383 * Math.PI) / 180);

function vessel(
  id: string,
  points: [number, number, number, number][],
  extra: Partial<LiveVessel> = {},
): LiveVessel {
  return { id, class: "Cargo", lengthM: 100, points, ...extra };
}

/**
 * A vessel under way, `stepM` between consecutive reports, patrolling a `legM` leg.
 *
 * ⚠️ It doubles back rather than steaming in a straight line on purpose. A straight run of 400
 * reports 100 m apart is 40 km, which leaves an 18 km AOI — and the vessel is then excluded by the
 * bounds filter, so a test about tail LENGTH would pass for the wrong reason.
 */
function steaming(id: string, steps: number, startLat = 54.35, stepM = 100, legM = 2_000):
LiveVessel {
  const points: [number, number, number, number][] = [];
  for (let i = 0; i < steps; i += 1) {
    const along = (i * stepM) % (2 * legM);
    const offset = along <= legM ? along : 2 * legM - along;
    points.push([
      startLat + offset / M_PER_DEG_LAT, 10.175, 1_700_000_000_000 + i * 10_000, 19.4,
    ]);
  }
  return vessel(id, points);
}

/** Total length of the drawn track, in metres. */
function drawnLength(buffers: LiveBuffers): number {
  let total = 0;
  for (let i = 0; i < buffers.segments.length; i += 2) {
    const a = buffers.segments[i];
    const b = buffers.segments[i + 1];
    total += Math.hypot(buffers.x[b] - buffers.x[a], buffers.z[b] - buffers.z[a]);
  }
  return total;
}

describe("live buffers", () => {
  it("🔴 caps the tail by LENGTH, so a fast ship does not trail across the map", () => {
    // 400 reports 100 m apart is 40 km of history. Capping by report COUNT let exactly this
    // through: measured on the real feed, a 24-report tail reached 17.7 km on an 18 km AOI.
    const buffers = fill(
      new Map([["a", steaming("a", 400, 54.32)]]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(buffers.vessels).toBe(1);
    expect(drawnLength(buffers)).toBeLessThanOrEqual(LIVE_TRAIL_M);
    expect(drawnLength(buffers)).toBeGreaterThan(LIVE_TRAIL_M * 0.5);
  });

  it("bounds a slow ship too, without letting it hoard vertices", () => {
    const fast = fill(
      new Map([["f", steaming("f", 200, 54.34, 200)]]), FRAME, createBuffers(), { bounds: BOUNDS });
    const slow = fill(
      new Map([["s", steaming("s", 200, 54.34, 20)]]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(drawnLength(fast)).toBeLessThanOrEqual(LIVE_TRAIL_M);
    expect(drawnLength(slow)).toBeLessThanOrEqual(LIVE_TRAIL_M);
    expect(slow.count).toBeLessThanOrEqual(LIVE_TRAIL_MAX_POINTS);
  });

  it("never spends the whole budget on a ship going nowhere", () => {
    // Moored: hundreds of reports, all within a few metres of each other.
    const buffers = fill(
      new Map([["m", steaming("m", 500, 54.38, 1)]]), FRAME, createBuffers(), { bounds: BOUNDS });
    expect(buffers.count).toBeLessThanOrEqual(LIVE_TRAIL_MAX_POINTS);
  });

  it("anchors the tail to where the ship is NOW", () => {
    const watched = steaming("a", 200, 54.34);
    const buffers = fill(new Map([["a", watched]]), FRAME, createBuffers(), { bounds: BOUNDS });

    const project = projector(FRAME);
    const newest = watched.points[watched.points.length - 1];
    const expected = project(newest[0], newest[1]);
    expect(buffers.heads).toHaveLength(1);
    expect(buffers.x[buffers.heads[0]]).toBeCloseTo(expected.x, 3);
    expect(buffers.z[buffers.heads[0]]).toBeCloseTo(expected.z, 3);
    // The newest report is the last vertex written, so the tail leads up to the ship.
    expect(buffers.heads[0]).toBe(buffers.count - 1);
  });

  it("draws one marker per vessel, not one per report", () => {
    const buffers = fill(new Map([
      ["a", steaming("a", 50, 54.36)],
      ["b", steaming("b", 50, 54.40)],
    ]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(buffers.vessels).toBe(2);
    expect(buffers.heads).toHaveLength(2);
    expect(buffers.count).toBeGreaterThan(2);
  });

  it("🔴 stops the tail at a jump it cannot explain", () => {
    // The ship is at 54.4209 with a plausible step back to 54.42; 8 km further back is a report
    // that cannot belong to the same recent track — a replay wrap, a re-entry, or a bad fix.
    const jumper = vessel("j", [
      [54.35, 10.175, 1_700_000_000_000, 12],
      [54.42, 10.175, 1_700_000_010_000, 12],
      [54.4209, 10.175, 1_700_000_020_000, 12],
    ]);
    const buffers = fill(new Map([["j", jumper]]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(buffers.count).toBe(2);
    expect(buffers.segments).toEqual([0, 1]);
    expect(drawnLength(buffers)).toBeLessThan(LIVE_MAX_STEP_M);
  });

  it("admits a long but plausible step, so the guard cannot quietly erase traffic", () => {
    const nearLimit = vessel("q", [
      [54.36, 10.175, 1_700_000_000_000, 30],
      [54.36 + (LIVE_MAX_STEP_M * 0.3) / M_PER_DEG_LAT, 10.175, 1_700_000_180_000, 30],
    ]);
    const buffers = fill(new Map([["q", nearLimit]]), FRAME, createBuffers(), { bounds: BOUNDS });
    expect(buffers.segments).toEqual([0, 1]);
  });

  it("holds back vessels outside the modelled water, and counts them", () => {
    const buffers = fill(new Map([
      ["in", steaming("in", 5, 54.38)],
      ["out", steaming("out", 5, 54.90)], // north of the AOI, still inside the relay's shell
    ]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(buffers.vessels).toBe(1);
    expect(buffers.outside).toBe(1);
  });

  it("judges a vessel by where it is now, not where it has been", () => {
    // Inbound: the older reports are outside the area, the latest is inside. It must appear.
    const inbound = vessel("i", [
      [54.90, 10.175, 1_700_000_000_000, 14],
      [54.60, 10.175, 1_700_000_010_000, 14],
      [54.40, 10.175, 1_700_000_020_000, 14],
    ]);
    const buffers = fill(new Map([["i", inbound]]), FRAME, createBuffers(), { bounds: BOUNDS });

    expect(buffers.vessels).toBe(1);
    expect(buffers.outside).toBe(0);
    // ...but the enormous approach legs are not drawn as track.
    expect(buffers.segments).toEqual([]);
    expect(buffers.heads).toHaveLength(1);
  });

  it("resets its counters between fills, so a quiet feed empties the screen", () => {
    const buffers = createBuffers();
    fill(new Map([["a", steaming("a", 10)]]), FRAME, buffers, { bounds: BOUNDS });
    expect(buffers.segments.length).toBeGreaterThan(0);

    fill(new Map(), FRAME, buffers, { bounds: BOUNDS });
    expect(buffers.count).toBe(0);
    expect(buffers.vessels).toBe(0);
    expect(buffers.segments).toEqual([]);
    expect(buffers.heads).toEqual([]);
  });

  it("ignores a vessel that has sent no position at all", () => {
    const buffers = fill(
      new Map([["empty", vessel("empty", [])]]), FRAME, createBuffers(), { bounds: BOUNDS });
    expect(buffers.vessels).toBe(0);
    expect(buffers.count).toBe(0);
  });
});
