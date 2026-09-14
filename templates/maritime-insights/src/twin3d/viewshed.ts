/**
 * Geometric visibility (PLAN §7).
 *
 * 🔴 This is **not a radar model**. It contains no radar cross-section, no sea clutter, no
 * multipath, no ducting, no rain attenuation and no detection probability. It answers exactly one
 * question: *given a measured terrain surface and standard atmospheric refraction, is there an
 * unobstructed straight line between an eye at height h₁ and a target at height h₂?*
 *
 * That restraint is the point. The physics of a real sensor belongs to the people who build them,
 * and guessing it badly in front of those people is the fastest way to lose the room. Geometry, by
 * contrast, is checkable by anyone with a phone — see `viewshed.test.ts`, which pins this solver
 * against the textbook radar-horizon formula `d_km ≈ 4.12·(√h₁ + √h₂)`.
 *
 * The curvature term is the whole reason that formula falls out: under standard refraction, rays
 * bend slightly downwards, which is modelled by pretending the earth is 4/3 its real size and
 * letting the rays travel straight. Nothing here is tuned — change `EARTH_RADIUS_M` or
 * `REFRACTION_FACTOR` and the test will tell you.
 */

/** Mean earth radius, IUGG. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Standard-refraction "effective earth" factor. The 4/3 that gives 4.12 in the horizon formula. */
const REFRACTION_FACTOR = 4 / 3;

export const EFFECTIVE_EARTH_RADIUS_M = EARTH_RADIUS_M * REFRACTION_FACTOR;

export const enum Visibility {
  /** Never evaluated: beyond the modelled range, or off the grid. Claims nothing. */
  Unknown = 0,
  /** In range, but the terrain or a building stands in the way. This is the interesting one. */
  Shadowed = 1,
  /** In range and unobstructed. */
  Visible = 2,
}

export interface LosGrid {
  width: number;
  height: number;
  resolutionM: number;
  /** Blocking height per cell: bare earth raised to the top of anything standing on it. */
  surfaceM: Float32Array;
  /**
   * 🔴 Bare ground per cell — what a mast stands **on**, which is not what a sight line is
   * blocked **by**.
   *
   * The two were the same raster until the measured surface top (bDOM) went into `surfaceM`.
   * From that moment reading the site's own elevation out of `surfaceM` stood every mast in a
   * wood on top of the canopy — silently adding the tree height to the antenna and inflating
   * coverage, which is the exact failure the vegetation layer was bought to remove. Optional so
   * the tests can still hand in a single flat surface; when absent, `surfaceM` is used.
   */
  groundM?: Float32Array;
}

export interface ViewshedRequest {
  /** Site position in grid coordinates (fractional cells; col grows east, row grows south). */
  col: number;
  row: number;
  /** Antenna height above the ground at the site. */
  mastM: number;
  /** Target height above the surface it sits on — a 2 m RIB against a 20 m container mast. */
  targetM: number;
  /**
   * Ray count. Rays diverge, so too few leaves unevaluated cells at the rim. `azimuthsFor` picks
   * the number that keeps ray spacing inside one cell at maximum range.
   */
  azimuths?: number;
}

export interface ViewshedResult {
  field: Uint8Array;
  /** Ground elevation at the site, read from the surface. */
  siteGroundM: number;
  /** Eye height above the vertical datum. */
  eyeM: number;
  /** Range at which a target of `targetM` drops below the horizon over open water. */
  horizonM: number;
  visibleCells: number;
  shadowedCells: number;
  /** Cells inside the horizon that no ray happened to sample. A quality measure, not a result. */
  unevaluatedInRange: number;
  elapsedMs: number;
}

/**
 * Distance at which the curved earth alone hides a target — the classic `4.12·(√h₁+√h₂)` in km,
 * derived rather than quoted: the horizon of an eye at height h is √(2·R_eff·h).
 */
export function radarHorizonM(eyeAboveSurfaceM: number, targetM: number): number {
  const safeEye = Math.max(eyeAboveSurfaceM, 0);
  const safeTarget = Math.max(targetM, 0);
  return Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * safeEye)
    + Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * safeTarget);
}

/** How far a straight ray rises above the curved surface after travelling `d`. */
export function curvatureDropM(d: number): number {
  return (d * d) / (2 * EFFECTIVE_EARTH_RADIUS_M);
}

/** Ray count that keeps the gap between neighbouring rays under one cell at `maxRangeM`. */
export function azimuthsFor(maxRangeM: number, resolutionM: number): number {
  return Math.max(360, Math.ceil((2 * Math.PI * maxRangeM) / resolutionM));
}

/**
 * Close the cells a diverging sweep stepped over.
 *
 * A hole is only filled when its neighbours agree unanimously, and only inside the swept disc.
 * That restraint matters: a cell on a shadow boundary has disagreeing neighbours and is left
 * alone, so the fill can tidy the sampling without ever moving the edge of a shadow — which is
 * the one thing in this field anybody is going to point at.
 */
function fillHoles(
  field: Uint8Array,
  width: number,
  height: number,
  siteCol: number,
  siteRow: number,
  rangeCells: number,
): void {
  const source = field.slice();
  for (let r = 1; r < height - 1; r += 1) {
    for (let c = 1; c < width - 1; c += 1) {
      const index = r * width + c;
      if (source[index] !== Visibility.Unknown) continue;
      const dc = c - siteCol;
      const dr = r - siteRow;
      if (dc * dc + dr * dr > rangeCells * rangeCells) continue;

      let seen = Visibility.Unknown;
      let unanimous = true;
      for (let or = -1; or <= 1 && unanimous; or += 1) {
        for (let oc = -1; oc <= 1; oc += 1) {
          if (!or && !oc) continue;
          const neighbour = source[(r + or) * width + (c + oc)];
          if (neighbour === Visibility.Unknown) continue;
          if (seen === Visibility.Unknown) seen = neighbour;
          else if (seen !== neighbour) { unanimous = false; break; }
        }
      }
      if (unanimous && seen !== Visibility.Unknown) field[index] = seen;
    }
  }
}

/**
 * Radial-sweep viewshed. For each azimuth, walk outward keeping the steepest upward angle seen so
 * far; anything that cannot clear that angle is in shadow.
 *
 * Sweeping outward from the eye — rather than tracing a ray inward from every cell — turns an
 * O(cells × path) problem into O(rays × path), which is what makes this cheap enough to re-run
 * while a slider is being dragged.
 *
 * 🔴 A sweep leaves holes, in two different ways, and both of them were visible in a rendered
 * frame before they were visible in a test:
 *   * **along** a ray, because stepping a whole cell diagonally moves only 0.7 cells on each axis
 *     and skips the ones in between — fixed by stepping half a cell;
 *   * **between** rays, because they diverge with range — bounded by `azimuthsFor`, then swept up
 *     by `fillHoles`.
 * Left alone these render as a radial moiré that looks like a property of the terrain and is
 * really a property of the sampling. Anything still unfilled stays `Unknown`, which claims
 * nothing, rather than being guessed as visible.
 */
export function computeViewshed(grid: LosGrid, request: ViewshedRequest): ViewshedResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { width, height, resolutionM, surfaceM } = grid;
  const field = new Uint8Array(width * height);

  const siteCol = Math.min(Math.max(request.col, 0), width - 1);
  const siteRow = Math.min(Math.max(request.row, 0), height - 1);
  const siteIndex = Math.round(siteRow) * width + Math.round(siteCol);
  const siteGroundM = (grid.groundM ?? surfaceM)[siteIndex];
  const eyeM = siteGroundM + request.mastM;

  // Over open water the eye is `mastM` above the sea, but on a cliff it is the whole height that
  // counts. The horizon is measured from the eye down to the surface the target stands on.
  const horizonM = radarHorizonM(eyeM - 0, request.targetM);
  const diagonal = Math.hypot(width * resolutionM, height * resolutionM);
  const maxRangeM = Math.min(horizonM, diagonal);
  const azimuths = request.azimuths ?? azimuthsFor(maxRangeM, resolutionM);

  const step = resolutionM / 2;
  const steps = Math.ceil(maxRangeM / step);

  for (let a = 0; a < azimuths; a += 1) {
    const angle = (a / azimuths) * Math.PI * 2;
    const dCol = Math.sin(angle);
    const dRow = -Math.cos(angle);
    let maxSlope = -Infinity;

    for (let s = 1; s <= steps; s += 1) {
      const d = s * step;
      const col = siteCol + (dCol * d) / resolutionM;
      const row = siteRow + (dRow * d) / resolutionM;
      const ci = col | 0;
      const ri = row | 0;
      if (ci < 0 || ci >= width || ri < 0 || ri >= height) break;

      const index = ri * width + ci;
      const surface = surfaceM[index];
      const drop = curvatureDropM(d);

      // The target sits on top of whatever the surface is here; the blocking test uses the
      // surface itself. Keeping these separate is what makes target height a real lever rather
      // than a cosmetic one.
      const targetSlope = (surface + request.targetM - drop - eyeM) / d;
      const state = targetSlope > maxSlope ? Visibility.Visible : Visibility.Shadowed;
      if (state > field[index]) field[index] = state;

      const surfaceSlope = (surface - drop - eyeM) / d;
      if (surfaceSlope > maxSlope) maxSlope = surfaceSlope;
    }
  }

  // The site's own cell is trivially visible and no ray starts there.
  field[siteIndex] = Visibility.Visible;

  const rangeCells = maxRangeM / resolutionM;
  fillHoles(field, width, height, siteCol, siteRow, rangeCells);

  let visibleCells = 0;
  let shadowedCells = 0;
  let unevaluatedInRange = 0;
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const index = r * width + c;
      const state = field[index];
      if (state === Visibility.Visible) visibleCells += 1;
      else if (state === Visibility.Shadowed) shadowedCells += 1;
      else if (Math.hypot(c - siteCol, r - siteRow) < rangeCells) unevaluatedInRange += 1;
    }
  }

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    field,
    siteGroundM,
    eyeM,
    horizonM,
    visibleCells,
    shadowedCells,
    unevaluatedInRange,
    elapsedMs: now - started,
  };
}

/**
 * Resample bare earth onto the coarser line-of-sight grid, to be used as `LosGrid.groundM`.
 *
 * 🔴 A mast stands on the ground. It does not stand on the canopy, and once the measured surface
 * top went into the blocking raster those stopped being the same number — in this AOI 54 % of land
 * cells rise, by a median 5.5 m. Left alone, every site placed in a wood would have quietly been
 * handed that lift as free antenna height, and coverage would have gone **up** as a result of
 * adding the layer that exists to bring it down.
 *
 * The sample is the **centre cell** of each block, not its maximum or its mean. A maximum would
 * put the mast on the highest point within 16 m, which is the flattering choice; a mean invents an
 * elevation that exists nowhere on the ground. The centre is a measured height at a real place,
 * and it is also the height the rendered terrain shows there, so the marker sits on the surface
 * the viewer can see instead of hovering over it.
 */
export function resampleGround(
  elevation: Float32Array,
  fine: { width: number; height: number; resolutionM: number },
  coarse: { width: number; height: number; resolutionM: number },
): Float32Array {
  const out = new Float32Array(coarse.width * coarse.height);
  const factor = coarse.resolutionM / fine.resolutionM;
  for (let row = 0; row < coarse.height; row += 1) {
    const fineRow = Math.min(Math.floor((row + 0.5) * factor), fine.height - 1);
    for (let col = 0; col < coarse.width; col += 1) {
      const fineCol = Math.min(Math.floor((col + 0.5) * factor), fine.width - 1);
      out[row * coarse.width + col] = elevation[fineRow * fine.width + fineCol];
    }
  }
  return out;
}

/**
 * Is there a clear line from the site's eye to one specific point in the air?
 *
 * 🔴 This exists because sampling the viewshed field answers a **different question**. The field is
 * solved for one `targetM` — a hull height, or a chosen flight altitude — and every cell in it
 * means "a target *that* high above the surface here would be seen". Asking it about the drone
 * camera, which is wherever the viewer has flown it, returns the answer for a target at the
 * slider's height standing on the ground below, and the two are not the same thing: at 480 m the
 * camera can be in clear air while the 40 m target under it sits in shadow.
 *
 * So this takes an **absolute** height above the vertical datum rather than a height above the
 * surface, and marches the one ray it actually needs. The arithmetic is deliberately identical to
 * the sweep's — same curvature term, same slope comparison — so the two can be pinned against each
 * other, and `viewshed.test.ts` does exactly that.
 */
export function hasLineOfSight(
  grid: LosGrid,
  site: { col: number; row: number; mastM: number },
  target: { col: number; row: number; aboveDatumM: number },
): boolean {
  const { width, height, resolutionM, surfaceM } = grid;
  const siteCol = Math.min(Math.max(site.col, 0), width - 1);
  const siteRow = Math.min(Math.max(site.row, 0), height - 1);
  const eyeM = (grid.groundM ?? surfaceM)[Math.round(siteRow) * width + Math.round(siteCol)]
    + site.mastM;

  const dCol = target.col - siteCol;
  const dRow = target.row - siteRow;
  const distanceM = Math.hypot(dCol, dRow) * resolutionM;
  if (distanceM < resolutionM) return true;

  // The slope the target sits at, curvature already taken out of it. Anything along the way that
  // stands at a steeper slope than this blocks the view.
  const targetSlope = (target.aboveDatumM - curvatureDropM(distanceM) - eyeM) / distanceM;

  const step = resolutionM / 2;
  for (let d = step; d < distanceM; d += step) {
    const fraction = d / distanceM;
    const c = Math.round(siteCol + dCol * fraction);
    const r = Math.round(siteRow + dRow * fraction);
    if (c < 0 || c >= width || r < 0 || r >= height) continue;
    const surfaceSlope = (surfaceM[r * width + c] - curvatureDropM(d) - eyeM) / d;
    if (surfaceSlope >= targetSlope) return false;
  }
  return true;
}

/**
 * How much of the way in to a protected object a site actually covers.
 *
 * 🔴 This is the counter-UAS counterpart to the traffic figure, and it exists for the same reason:
 * an area in km² cannot be written into a requirement, and "the system shall detect an approach to
 * the aerodrome" can. There is no recorded drone traffic to multiply against — inventing some
 * would be fabrication — so the threat here is **parametric**: a target at a chosen height above
 * the ground, on every bearing, walking in.
 *
 * The definition, stated in full because Phase 6 taught that two implementations of one figure
 * drift exactly where the definition was left implicit:
 *
 *   * an **approach** is one bearing, walked inbound from `radiusM` towards the object in steps of
 *     one cell, **stopping short of the object's own cell** — being able to see the aerodrome is
 *     not the same as catching something on the way in, and the solver marks the site's own cell
 *     visible by construction, so including the centre would hand back a free detection on every
 *     bearing;
 *   * it **counts** only if at least half of its samples lie inside the modelled grid — a bearing
 *     whose approach mostly runs off the map is not a failure of the site and is excluded, not
 *     counted as missed (exactly as a passage that never enters the area is excluded);
 *   * it is **observed** if at least one sample on the path falls in a cell the field marks
 *     visible;
 *   * `firstSeenM` is the **outermost** such sample, because what matters operationally is how
 *     early the approach is caught, not that it is eventually caught overhead.
 *
 * Target height is already baked into `field`: it was solved for one `targetM`, so 30 m and 150 m
 * give different answers from the same site. That is the whole point of the altitude ladder.
 */
export interface ApproachCoverage {
  /** Bearings whose inbound path touches the modelled grid at all. */
  bearings: number;
  observedBearings: number;
  missedBearings: number;
  share: number;
  /** Widest contiguous arc of unobserved bearings, in degrees. The hole a planner cares about. */
  widestGapDeg: number;
  /** Centre of that arc, or null when nothing is missed. */
  widestGapCentreDeg: number | null;
  /** Median range at which an approach is first caught, over the bearings that are caught. */
  medianFirstSeenM: number | null;
}

export function measureApproachCoverage(
  grid: LosGrid,
  field: Uint8Array,
  assetCol: number,
  assetRow: number,
  radiusM: number,
  bearingCount = 72,
): ApproachCoverage {
  const { width, height, resolutionM } = grid;
  const observed: boolean[] = [];
  const counted: boolean[] = [];
  const firstSeen: number[] = [];

  for (let b = 0; b < bearingCount; b += 1) {
    const angle = (b / bearingCount) * Math.PI * 2;
    const dCol = Math.sin(angle);
    const dRow = -Math.cos(angle);
    let onGrid = 0;
    let samples = 0;
    let seenAt: number | null = null;

    // Outward-in walk, so the first hit is the outermost one and no second pass is needed. The
    // loop stops at one cell out rather than at zero: see the note on the object's own cell.
    for (let d = radiusM; d >= resolutionM; d -= resolutionM) {
      samples += 1;
      const c = Math.round(assetCol + (dCol * d) / resolutionM);
      const r = Math.round(assetRow + (dRow * d) / resolutionM);
      if (c < 0 || c >= width || r < 0 || r >= height) continue;
      onGrid += 1;
      if (seenAt === null && field[r * width + c] === Visibility.Visible) seenAt = d;
    }

    const evaluable = samples > 0 && onGrid * 2 >= samples;
    counted.push(evaluable);
    observed.push(evaluable && seenAt !== null);
    if (evaluable && seenAt !== null) firstSeen.push(seenAt);
  }

  const bearings = counted.filter(Boolean).length;
  const observedBearings = observed.filter(Boolean).length;

  // Widest run of missed bearings, wrapping the circle. Only bearings that count can be missed;
  // an excluded bearing breaks a run rather than extending it, because claiming a gap where the
  // model has no opinion would be inventing one.
  let widestRun = 0;
  let widestEnd = -1;
  if (observedBearings < bearings) {
    let run = 0;
    for (let i = 0; i < bearingCount * 2; i += 1) {
      const k = i % bearingCount;
      if (counted[k] && !observed[k]) {
        run += 1;
        if (run > widestRun) { widestRun = run; widestEnd = k; }
      } else {
        run = 0;
      }
    }
    widestRun = Math.min(widestRun, bearingCount);
  }

  const degPer = 360 / bearingCount;
  const sorted = firstSeen.slice().sort((a, b) => a - b);

  return {
    bearings,
    observedBearings,
    missedBearings: bearings - observedBearings,
    share: bearings ? observedBearings / bearings : 0,
    widestGapDeg: widestRun * degPer,
    widestGapCentreDeg: widestRun
      ? (((widestEnd - (widestRun - 1) / 2) * degPer) + 360) % 360
      : null,
    medianFirstSeenM: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}
