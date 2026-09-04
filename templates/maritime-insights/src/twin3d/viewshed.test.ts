import { describe, expect, it } from "vitest";
import {
  azimuthsFor,
  computeViewshed,
  curvatureDropM,
  EFFECTIVE_EARTH_RADIUS_M,
  hasLineOfSight,
  measureApproachCoverage,
  radarHorizonM,
  resampleGround,
  Visibility,
  type LosGrid,
} from "./viewshed";

/**
 * The point of these tests is that the visibility model can be checked by someone who does not
 * trust it. Every expectation below is either a textbook constant or a shape that follows from
 * the geometry — none of them were read off the implementation and pasted back in.
 */

/** Flat sea at the vertical datum. */
function flatSea(width: number, height: number, resolutionM: number): LosGrid {
  return { width, height, resolutionM, surfaceM: new Float32Array(width * height) };
}

describe("the constants are the textbook ones", () => {
  it("uses a 4/3 effective earth radius", () => {
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeCloseTo(8_494_678, 0);
  });

  it("reproduces the 4.12·√h horizon coefficient", () => {
    // d = √(2·R_eff·h) metres. Expressed in km with h in metres, the coefficient is 4.12.
    const coefficient = Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M) / 1000;
    expect(coefficient).toBeCloseTo(4.12, 2);
  });

  it("drops a ray by the expected amount over distance", () => {
    // A well-known sanity figure: about 20 m of curvature over 18 km under standard refraction.
    expect(curvatureDropM(18_000)).toBeCloseTo(19.1, 1);
    expect(curvatureDropM(0)).toBe(0);
  });
});

describe("radarHorizonM", () => {
  it("matches 4.12·(√h₁ + √h₂) in kilometres", () => {
    for (const [h1, h2] of [[25, 2], [10, 0], [50, 20], [4, 4]]) {
      const textbookKm = 4.12 * (Math.sqrt(h1) + Math.sqrt(h2));
      expect(radarHorizonM(h1, h2) / 1000).toBeCloseTo(textbookKm, 1);
    }
  });

  it("treats negative heights as sea level rather than producing NaN", () => {
    expect(radarHorizonM(-5, -5)).toBe(0);
  });
});

describe("computeViewshed over open water", () => {
  const resolutionM = 16;
  // Large enough that the horizon, not the grid edge, is what limits the result.
  const size = 3600;

  /**
   * ⚠️ These two sweep a 3600 × 3600 grid and take seconds, which is inherent: the horizon they
   * check against the textbook formula is 26 km away, and a grid small enough to be quick would
   * clip it and check nothing. The default 5 s limit passes in isolation and fails under parallel
   * load, so the budget is stated rather than left to luck.
   */
  const HEAVY = 30_000;

  it("puts the visible edge where the textbook horizon says it is", () => {
    const grid = flatSea(size, size, resolutionM);
    const mastM = 25;
    const targetM = 2;
    const result = computeViewshed(grid, {
      col: size / 2,
      row: size / 2,
      mastM,
      targetM,
    });

    // Furthest visible cell, measured from the field rather than from the reported horizon.
    let furthest = 0;
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (grid.width && result.field[r * size + c] === Visibility.Visible) {
          const d = Math.hypot(c - size / 2, r - size / 2) * resolutionM;
          if (d > furthest) furthest = d;
        }
      }
    }

    const textbookM = 4.12 * (Math.sqrt(mastM) + Math.sqrt(targetM)) * 1000;
    // Within one percent of a formula this solver never refers to.
    expect(Math.abs(furthest - textbookM) / textbookM).toBeLessThan(0.01);
  }, HEAVY);

  it("makes target height a real lever: a container mast is seen further than a RIB", () => {
    const grid = flatSea(size, size, resolutionM);
    const base = { col: size / 2, row: size / 2, mastM: 25 };
    const rib = computeViewshed(grid, { ...base, targetM: 2 });
    const container = computeViewshed(grid, { ...base, targetM: 20 });

    expect(container.horizonM).toBeGreaterThan(rib.horizonM);
    expect(container.visibleCells).toBeGreaterThan(rib.visibleCells);
    // The extra reach is the difference of the two square-root terms, not a fudge factor.
    const expectedExtra = 4.12 * (Math.sqrt(20) - Math.sqrt(2)) * 1000;
    expect(container.horizonM - rib.horizonM).toBeCloseTo(expectedExtra, -2);
  }, HEAVY);

  it("leaves nothing in shadow when there is nothing to hide behind", () => {
    const grid = flatSea(600, 600, resolutionM);
    const result = computeViewshed(grid, { col: 300, row: 300, mastM: 30, targetM: 2 });
    expect(result.shadowedCells).toBe(0);
    expect(result.visibleCells).toBeGreaterThan(0);
  });
});

describe("computeViewshed against terrain", () => {
  const resolutionM = 16;

  it("casts a shadow behind a ridge, and the shadow shortens when the mast is raised", () => {
    const width = 400;
    const height = 400;
    const surfaceM = new Float32Array(width * height);
    // A 40 m wall running east-west, 50 cells north of the site.
    for (let c = 0; c < width; c += 1) surfaceM[150 * width + c] = 40;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };

    const low = computeViewshed(grid, { col: 200, row: 200, mastM: 5, targetM: 2 });
    const high = computeViewshed(grid, { col: 200, row: 200, mastM: 80, targetM: 2 });

    // Directly behind the wall, low down, is hidden.
    const behind = 100 * width + 200;
    expect(low.field[behind]).toBe(Visibility.Shadowed);

    // Raising the eye above the wall recovers ground behind it. This is the phase gate in one
    // assertion: the shadow must move when the lever moves.
    expect(high.shadowedCells).toBeLessThan(low.shadowedCells);
    expect(high.field[behind]).toBe(Visibility.Visible);
  });

  it("does not let a wall block a target that stands taller than it", () => {
    const width = 300;
    const height = 300;
    const surfaceM = new Float32Array(width * height);
    for (let c = 0; c < width; c += 1) surfaceM[120 * width + c] = 20;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };

    const site = { col: 150, row: 150, mastM: 10 };
    const smallTarget = computeViewshed(grid, { ...site, targetM: 1 });
    const tallTarget = computeViewshed(grid, { ...site, targetM: 60 });
    expect(tallTarget.shadowedCells).toBeLessThan(smallTarget.shadowedCells);
  });

  it("reports the site's own ground height rather than assuming sea level", () => {
    const width = 100;
    const height = 100;
    const surfaceM = new Float32Array(width * height);
    surfaceM[50 * width + 50] = 31;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };
    const result = computeViewshed(grid, { col: 50, row: 50, mastM: 10, targetM: 2 });
    expect(result.siteGroundM).toBe(31);
    expect(result.eyeM).toBe(41);
  });
});

describe("sampling quality", () => {
  it("leaves no radial holes on a grid the size of the real one", () => {
    // 🔴 This threshold used to be 0.5 %, which passed while the deployed app showed a clear
    // radial moiré across the water. The test was measuring the right quantity and tolerating a
    // visible defect, so the number here is now the one a rendered frame demanded.
    const resolutionM = 16;
    const width = 708;
    const height = 1103;
    const grid = flatSea(width, height, resolutionM);
    const result = computeViewshed(grid, { col: 300, row: 700, mastM: 25, targetM: 2 });
    const evaluated = result.visibleCells + result.shadowedCells;
    expect(result.unevaluatedInRange / evaluated).toBeLessThan(0.0005);
  });

  it("fills holes without moving a shadow boundary", () => {
    // A wall casts a straight-edged shadow. If the fill were allowed to guess at disagreeing
    // neighbours it would round that edge off, so the count either side must stay put.
    const width = 400;
    const height = 400;
    const resolutionM = 16;
    const surfaceM = new Float32Array(width * height);
    for (let c = 0; c < width; c += 1) surfaceM[150 * width + c] = 40;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };
    const result = computeViewshed(grid, { col: 200, row: 200, mastM: 5, targetM: 2 });

    // Immediately behind the wall every cell is shadowed, with no visible speckle mixed in.
    let visibleBehind = 0;
    for (let c = 100; c < 300; c += 1) {
      if (result.field[120 * width + c] === Visibility.Visible) visibleBehind += 1;
    }
    expect(visibleBehind).toBe(0);
  });

  it("scales the ray count with range so spacing stays inside a cell", () => {
    expect(azimuthsFor(20_000, 16)).toBeGreaterThanOrEqual((2 * Math.PI * 20_000) / 16);
    expect(azimuthsFor(10, 16)).toBe(360);
  });
});

describe("hasLineOfSight", () => {
  const resolutionM = 16;

  it("agrees with the swept field for a target at the field's own height", () => {
    // 🔴 The reason this test exists: the two are separate implementations of one geometry, and
    // the app now uses both. A ridge, sampled along a row, must be reported identically.
    const width = 300;
    const height = 300;
    const surfaceM = new Float32Array(width * height);
    for (let c = 0; c < width; c += 1) surfaceM[150 * width + c] = 45;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };
    const targetM = 10;
    const result = computeViewshed(grid, { col: 150, row: 200, mastM: 20, targetM });

    let compared = 0;
    for (let row = 20; row < 140; row += 7) {
      for (let col = 40; col < 260; col += 11) {
        const state = result.field[row * width + col];
        if (state === Visibility.Unknown) continue;
        const direct = hasLineOfSight(
          grid,
          { col: 150, row: 200, mastM: 20 },
          { col, row, aboveDatumM: surfaceM[row * width + col] + targetM },
        );
        expect(direct).toBe(state === Visibility.Visible);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("sees over a wall that hides the ground beneath the same point", () => {
    // The bug this replaced: the camera at altitude was told it was in shadow because the field
    // had been solved for a low target standing on the ground under it.
    const width = 200;
    const height = 200;
    const surfaceM = new Float32Array(width * height);
    for (let c = 0; c < width; c += 1) surfaceM[100 * width + c] = 60;
    const grid: LosGrid = { width, height, resolutionM, surfaceM };
    const site = { col: 100, row: 150, mastM: 5 };

    // A point just above the ground beyond the wall is hidden …
    expect(hasLineOfSight(grid, site, { col: 100, row: 50, aboveDatumM: 3 })).toBe(false);
    // … and the same plan position at 500 m is not.
    expect(hasLineOfSight(grid, site, { col: 100, row: 50, aboveDatumM: 500 })).toBe(true);
  });

  it("puts the curvature horizon where the textbook does", () => {
    // Flat sea, eye at 25 m. A target at 2 m should drop out of sight near 4.12·(√25+√2) km.
    const size = 1400;
    const grid = flatSea(size, size, resolutionM);
    const site = { col: 0, row: size / 2, mastM: 25 };
    const horizonKm = 4.12 * (Math.sqrt(25) + Math.sqrt(2));
    const insideCol = ((horizonKm * 0.8) * 1000) / resolutionM;
    const outsideCol = ((horizonKm * 1.25) * 1000) / resolutionM;
    expect(hasLineOfSight(grid, site,
      { col: insideCol, row: size / 2, aboveDatumM: 2 })).toBe(true);
    expect(hasLineOfSight(grid, site,
      { col: outsideCol, row: size / 2, aboveDatumM: 2 })).toBe(false);
  });

  it("treats a point at the site itself as visible rather than dividing by zero", () => {
    const grid = flatSea(100, 100, resolutionM);
    expect(hasLineOfSight(grid, { col: 50, row: 50, mastM: 10 },
      { col: 50, row: 50, aboveDatumM: 0 })).toBe(true);
  });
});

describe("measureApproachCoverage", () => {
  const width = 400;
  const height = 400;
  const resolutionM = 16;
  const grid: LosGrid = flatSea(width, height, resolutionM);

  /** A field where every cell holds one state, so the metric can be read without the solver. */
  function uniform(state: Visibility): Uint8Array {
    return new Uint8Array(width * height).fill(state);
  }

  it("reports full coverage when every cell is visible", () => {
    const result = measureApproachCoverage(grid, uniform(Visibility.Visible), 200, 200, 1600);
    expect(result.bearings).toBe(72);
    expect(result.observedBearings).toBe(72);
    expect(result.share).toBe(1);
    expect(result.widestGapDeg).toBe(0);
    expect(result.widestGapCentreDeg).toBeNull();
  });

  it("reports nothing observed when every cell is shadowed", () => {
    const result = measureApproachCoverage(grid, uniform(Visibility.Shadowed), 200, 200, 1600);
    expect(result.observedBearings).toBe(0);
    expect(result.share).toBe(0);
    // Every bearing is missed, so the gap closes the whole circle.
    expect(result.widestGapDeg).toBe(360);
    expect(result.medianFirstSeenM).toBeNull();
  });

  it("finds the outermost detection, not the nearest one", () => {
    // Visible only in a band 800-900 m east of the asset. Walking in along bearing 090° the
    // approach must be reported as first caught at the far edge of that band.
    const field = uniform(Visibility.Shadowed);
    for (let r = 0; r < height; r += 1) {
      for (let c = 250; c <= 256; c += 1) field[r * width + c] = Visibility.Visible;
    }
    const result = measureApproachCoverage(grid, field, 200, 200, 1600, 4);
    // Cell 256 is 56 cells east of 200 → 896 m; the walk samples on cell centres.
    expect(result.medianFirstSeenM).toBeGreaterThan(850);
    expect(result.medianFirstSeenM).toBeLessThan(910);
  });

  it("measures the widest missed arc rather than the total missed count", () => {
    // Visible everywhere except a wedge to the north. Two separate small holes must not add up
    // into one wide one — the planner is asking how big the biggest hole is.
    const field = uniform(Visibility.Visible);
    for (let r = 0; r < 200; r += 1) {
      for (let c = 190; c < 210; c += 1) field[r * width + c] = Visibility.Shadowed;
    }
    const result = measureApproachCoverage(grid, field, 200, 200, 1600);
    expect(result.missedBearings).toBeGreaterThan(0);
    expect(result.widestGapDeg).toBeGreaterThan(0);
    // The hole straddles due north, so its centre is near 0°/360°.
    const centre = result.widestGapCentreDeg!;
    expect(Math.min(centre, 360 - centre)).toBeLessThan(20);
  });

  it("excludes bearings whose approach never touches the grid, rather than calling them missed", () => {
    // An asset in the corner: roughly three quarters of the compass walks straight off the map.
    // Those bearings are not the site's failure and must not appear in the denominator.
    const result = measureApproachCoverage(grid, uniform(Visibility.Visible), 2, 2, 1600);
    expect(result.bearings).toBeLessThan(72);
    expect(result.bearings).toBeGreaterThan(0);
    expect(result.share).toBe(1);
    expect(result.missedBearings).toBe(0);
  });

  it("counts a gap that wraps past north as one arc, not two", () => {
    const field = uniform(Visibility.Visible);
    // Shadow a wedge covering bearings 350°-010° by blanking a narrow column north of the asset.
    for (let r = 0; r < 200; r += 1) field[r * width + 200] = Visibility.Shadowed;
    const result = measureApproachCoverage(grid, field, 200, 200, 1600, 360);
    expect(result.widestGapDeg).toBeGreaterThan(0);
    const centre = result.widestGapCentreDeg!;
    expect(Math.min(centre, 360 - centre)).toBeLessThan(5);
  });
});

/**
 * 🔴 The regression this file exists to prevent from ever happening twice.
 *
 * Vegetation went into the blocking surface to make the model claim *less*. Because the site's own
 * elevation was read out of that same raster, the first effect of adding it was to stand every
 * mast in a wood on top of the canopy — 20 m of antenna the customer never buys, and coverage that
 * went **up** because an obstruction was added. These pin the two rasters apart.
 */
describe("a mast stands on the ground, not on the canopy", () => {
  const width = 600;
  const height = 600;
  const resolutionM = 16;

  /** Flat sea with a wood around the site: canopy in `surfaceM`, bare earth in `groundM`. */
  function woodedSite(canopyM: number): LosGrid {
    const surfaceM = new Float32Array(width * height);
    const groundM = new Float32Array(width * height);
    for (let r = 250; r < 350; r += 1) {
      for (let c = 250; c < 350; c += 1) surfaceM[r * width + c] = canopyM;
    }
    return { width, height, resolutionM, surfaceM, groundM };
  }

  it("puts the eye at mast height above bare earth, not above the trees", () => {
    const result = computeViewshed(woodedSite(25), { col: 300, row: 300, mastM: 25, targetM: 2 });
    expect(result.siteGroundM).toBe(0);
    expect(result.eyeM).toBe(25);
  });

  it("sees less from inside a wood than from the same spot in the open", () => {
    const open = computeViewshed(
      flatSea(width, height, resolutionM), { col: 300, row: 300, mastM: 25, targetM: 2 },
    );
    const wooded = computeViewshed(woodedSite(30), { col: 300, row: 300, mastM: 25, targetM: 2 });
    // A 30 m canopy over a 25 m mast blocks the view outward. Adding an obstruction may never
    // increase what a site can see; before the fix it did, because it also raised the mast.
    expect(wooded.visibleCells).toBeLessThan(open.visibleCells);
  });

  it("uses the same ground for a single sight line as for the sweep", () => {
    const grid = woodedSite(25);
    // Target just outside the wood at 2 m. From an eye on bare earth under a 25 m canopy the
    // trees are in the way; from an eye sitting on the canopy they would not be.
    expect(hasLineOfSight(grid, { col: 300, row: 300, mastM: 5 },
                          { col: 420, row: 300, aboveDatumM: 2 })).toBe(false);
  });

  it("falls back to the blocking surface when no ground raster is supplied", () => {
    const surfaceM = new Float32Array(width * height).fill(40);
    const result = computeViewshed({ width, height, resolutionM, surfaceM },
                                   { col: 300, row: 300, mastM: 25, targetM: 2 });
    expect(result.siteGroundM).toBe(40);
  });
});

describe("resampleGround", () => {
  const fine = { width: 8, height: 8, resolutionM: 4 };
  const coarse = { width: 2, height: 2, resolutionM: 16 };

  it("samples the centre of each block, so the height is one that exists on the ground", () => {
    const elevation = new Float32Array(64);
    for (let i = 0; i < 64; i += 1) elevation[i] = i;
    const out = resampleGround(elevation, fine, coarse);
    // Block (0,0) spans fine rows/cols 0-3; its centre sample is row 2, col 2 → index 18.
    expect(out[0]).toBe(18);
    expect(out[1]).toBe(22);
    expect(out[2]).toBe(50);
    expect(out[3]).toBe(54);
  });

  it("never invents a height: every output value is one of the inputs", () => {
    const elevation = new Float32Array(64);
    for (let i = 0; i < 64; i += 1) elevation[i] = (i % 7) * 3.5;
    const out = resampleGround(elevation, fine, coarse);
    const inputs = new Set(Array.from(elevation));
    for (const value of out) expect(inputs.has(value)).toBe(true);
  });

  it("stays inside the fine grid when the coarse grid rounds up", () => {
    const elevation = new Float32Array(64).fill(3);
    const out = resampleGround(elevation, fine, { width: 3, height: 3, resolutionM: 16 });
    expect(out.length).toBe(9);
    for (const value of out) expect(value).toBe(3);
  });
});
