import { wgs84ToUtm32 } from './utm';
import type { IgcFix, IgcFlight } from './igc';

/**
 * Turn a parsed IGC log into something the scene can draw — PLAN §7 phase 2.
 *
 * Two jobs: place every fix in the same world metres the terrain uses, and derive vertical speed.
 * Nothing here invents data; everything is either a projection of a recorded value or a
 * differentiation of one, and the units are stated wherever that matters.
 */

export interface TrackPoint {
  /** Seconds from the first fix. */
  t: number;
  /** World metres, x east, z south, origin at the centre of the terrain core. */
  x: number;
  z: number;
  /** Metres above sea level, GPS. */
  altM: number;
  /** Metres per second, positive up. Derived from pressure altitude — see `deriveVario`. */
  varioMs: number;
  /** Metres per second over the ground. */
  groundMs: number;
  lat: number;
  lon: number;
}

export interface FlightTrack {
  id: string;
  date: string;
  points: TrackPoint[];
  durationS: number;
  altMinM: number;
  altMaxM: number;
  varioMinMs: number;
  varioMaxMs: number;
  /** Straight-line distance from first to last fix, metres. */
  netDistanceM: number;
  /** Distance actually flown over the ground, metres. */
  trackDistanceM: number;
}

export interface WorldOrigin {
  /** UTM32 easting/northing of the terrain core's centre. */
  centreEasting: number;
  centreNorthing: number;
}

/**
 * Smoothed vertical speed.
 *
 * ⚠️ Derived from **pressure** altitude, not GPS altitude, and the choice matters. GPS vertical
 * error is several metres and largely uncorrelated between fixes, so differentiating it at 1 Hz
 * produces a vario signal dominated by noise — ±3 m/s of pure invention on a glide. Pressure
 * altitude is smooth, and while its absolute value is wrong (it is referenced to 1013.25 hPa, not
 * to the day's actual pressure), its *derivative* is exactly right, which is all that is wanted.
 *
 * The window is centred and time-based rather than sample-based, because instruments do not log at
 * a constant rate and a fixed sample count would mean a different time constant in different parts
 * of the same flight.
 */
function deriveVario(fixes: IgcFix[], windowS = 6): number[] {
  const vario = new Array<number>(fixes.length).fill(0);
  let lo = 0;
  let hi = 0;

  for (let i = 0; i < fixes.length; i++) {
    const centre = fixes[i].seconds;
    while (lo < i && centre - fixes[lo].seconds > windowS / 2) lo++;
    while (hi < fixes.length - 1 && fixes[hi + 1].seconds - centre <= windowS / 2) hi++;

    const dt = fixes[hi].seconds - fixes[lo].seconds;
    vario[i] = dt > 0 ? (fixes[hi].pressureM - fixes[lo].pressureM) / dt : 0;
  }
  return vario;
}

export function buildTrack(flight: IgcFlight, origin: WorldOrigin, id: string): FlightTrack {
  // A 2D fix has no trustworthy altitude, and a track that dips to zero for a few seconds draws a
  // spike through the terrain. Dropping them is honest: the instrument said it did not know.
  const fixes = flight.fixes.filter((f) => f.valid);
  if (fixes.length < 2) throw new Error('flight has fewer than two valid 3D fixes');

  const vario = deriveVario(fixes);
  const t0 = fixes[0].seconds;

  const points: TrackPoint[] = [];
  let trackDistanceM = 0;

  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i];
    const { easting, northing } = wgs84ToUtm32(fix.lon, fix.lat);
    // Northing increases north, but +Z is south once the terrain plane is rotated flat, so the
    // northing term is negated. Getting this wrong mirrors the flight about the valley axis, which
    // still looks like a plausible track — which is exactly why it is worth stating.
    const x = easting - origin.centreEasting;
    const z = -(northing - origin.centreNorthing);

    let groundMs = 0;
    if (i > 0) {
      const previous = points[i - 1];
      const step = Math.hypot(x - previous.x, z - previous.z);
      const dt = fix.seconds - fixes[i - 1].seconds;
      trackDistanceM += step;
      groundMs = dt > 0 ? step / dt : 0;
    }

    points.push({
      t: fix.seconds - t0,
      x,
      z,
      altM: fix.gpsM,
      varioMs: vario[i],
      groundMs,
      lat: fix.lat,
      lon: fix.lon,
    });
  }

  const altitudes = points.map((p) => p.altM);
  const varios = points.map((p) => p.varioMs);
  const first = points[0];
  const last = points[points.length - 1];

  return {
    id,
    date: flight.date,
    points,
    durationS: last.t,
    altMinM: Math.min(...altitudes),
    altMaxM: Math.max(...altitudes),
    varioMinMs: Math.min(...varios),
    varioMaxMs: Math.max(...varios),
    netDistanceM: Math.hypot(last.x - first.x, last.z - first.z),
    trackDistanceM,
  };
}

/** Index of the last point at or before `t` seconds. Binary search — the scrubber calls this a lot. */
export function indexAtTime(points: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
