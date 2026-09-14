import type { TrackPoint } from './track';

/**
 * Wind measured from the flight itself — PLAN §5.5, track 1.
 *
 * DWD publishes ICON-D2 as a rolling ~24-hour window, not an archive, so there is no free way to
 * fetch the wind field over the Nebelhorn for a day in April 2021. Overlaying a model wind on a
 * historical flight would mean inventing it, which §2.2.6 forbids.
 *
 * The honest answer turns out to be better than the compromise. When a pilot thermals, the circle
 * drifts downwind — so the drift of one full 360° turn, divided by the time it took, **is** the
 * wind at that altitude, at that moment, measured. Stack the turns up a climb and the flight
 * yields its own wind profile.
 *
 * This is what pilots already do by eye, it needs no API and no key, it works offline, and every
 * historical flight carries it — including one from ten years ago.
 *
 * ⚠️ Its limitation is equally real and is surfaced rather than smoothed over: it only exists where
 * the pilot circled. Glides produce no wind data at all, and altitude bands the flight never
 * climbed through stay empty. The UI says so instead of interpolating across the gap.
 */

export interface WindSample {
  /** Mean altitude of the turn, metres. */
  altM: number;
  /** Metres per second. */
  speedMs: number;
  /** Degrees, meteorological convention: the direction the wind comes FROM. */
  fromDeg: number;
  /** Seconds into the flight, at the middle of the turn. */
  t: number;
  /** How close to a circle the turn was, 0..1. Low values mean a drifting S-turn, not a thermal. */
  quality: number;
}

export interface WindBand {
  /** Lower edge of the altitude band, metres. */
  altM: number;
  speedMs: number;
  fromDeg: number;
  /** Number of turns that contributed. One turn is a hint; ten are a measurement. */
  samples: number;
}

export interface WindProfile {
  samples: WindSample[];
  bands: WindBand[];
  /** Altitude band width used for the aggregation, metres. */
  bandM: number;
}

const TWO_PI = Math.PI * 2;

/** Signed angle from a to b, wrapped to (−π, π]. */
function angleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= TWO_PI;
  while (delta <= -Math.PI) delta += TWO_PI;
  return delta;
}

/**
 * Find complete 360° turns and measure the drift of each.
 *
 * A turn is detected by accumulating heading change until it passes a full circle. Using the
 * accumulated angle rather than looking for a closed loop in space is what makes this work at all
 * — in wind the circle never closes, and that failure to close is the measurement.
 */
export function deriveWind(
  points: TrackPoint[],
  options: { bandM?: number; minQuality?: number } = {}
): WindProfile {
  const bandM = options.bandM ?? 100;
  const minQuality = options.minQuality ?? 0.55;
  const samples: WindSample[] = [];

  if (points.length < 8) return { samples, bands: [], bandM };

  // Headings between consecutive fixes.
  const heading: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    heading[i] = Math.atan2(points[i].z - points[i - 1].z, points[i].x - points[i - 1].x);
  }
  heading[0] = heading[1];

  let start = 1;
  let accumulated = 0;

  for (let i = 2; i < points.length; i++) {
    const delta = angleDelta(heading[i - 1], heading[i]);

    // A reversal means the pilot stopped circling: reset and start looking again from here.
    // Without this, two opposite half-turns would accumulate to a "full circle" that never
    // happened and produce a wind vector out of a straight glide.
    if (accumulated !== 0 && Math.sign(delta) !== Math.sign(accumulated) && Math.abs(delta) > 0.25) {
      start = i;
      accumulated = 0;
      continue;
    }

    accumulated += delta;

    if (Math.abs(accumulated) < TWO_PI) continue;

    // ⚠️ Interpolate the end of the turn to EXACTLY 360°.
    //
    // The circle is only closed at a whole turn, so any overshoot leaves part of an extra arc in
    // the displacement and biases the measured wind. With one fix per second and a 20 s turn each
    // step is 18°, so the overshoot averages half a step — which measured a known 5.0 m/s wind as
    // 4.76 m/s, nearly 5 % low. Splitting the final step at the crossing point removes it.
    const before = accumulated - delta;
    const fraction = delta !== 0 ? (Math.sign(accumulated) * TWO_PI - before) / delta : 1;
    const k = Math.max(0, Math.min(1, fraction));

    const previous = points[i - 1];
    const current = points[i];
    const endX = previous.x + (current.x - previous.x) * k;
    const endZ = previous.z + (current.z - previous.z) * k;
    const endT = previous.t + (current.t - previous.t) * k;
    const endAlt = previous.altM + (current.altM - previous.altM) * k;

    const from = points[start];
    const dt = endT - from.t;

    // A "turn" completed in a couple of seconds is heading noise while flying straight; one taking
    // several minutes is not a thermal turn either.
    if (dt >= 8 && dt <= 180) {
      const driftX = (endX - from.x) / dt;
      const driftZ = (endZ - from.z) / dt;
      const speedMs = Math.hypot(driftX, driftZ);

      // Quality: a real thermal turn traces a roughly constant radius. Comparing the spread of
      // distances from the turn's own centre against their mean gives a cheap circularity score,
      // and it is the thing that separates a genuine climb from a sloppy S.
      let cx = 0;
      let cz = 0;
      for (let n = start; n <= i; n++) {
        cx += points[n].x;
        cz += points[n].z;
      }
      const count = i - start + 1;
      cx /= count;
      cz /= count;

      let meanRadius = 0;
      for (let n = start; n <= i; n++) {
        meanRadius += Math.hypot(points[n].x - cx, points[n].z - cz);
      }
      meanRadius /= count;

      let variance = 0;
      for (let n = start; n <= i; n++) {
        const radius = Math.hypot(points[n].x - cx, points[n].z - cz);
        variance += (radius - meanRadius) ** 2;
      }
      const spread = Math.sqrt(variance / count);
      const quality = meanRadius > 0 ? Math.max(0, 1 - spread / meanRadius) : 0;

      if (quality >= minQuality && speedMs < 30) {
        const altM = (from.altM + endAlt) / 2;

        // Meteorological convention: the direction the wind blows FROM, clockwise from north.
        // World +x is east and +z is SOUTH, so north is −z — which is why the y argument is
        // negated rather than used directly.
        const towardDeg = (Math.atan2(driftX, -driftZ) * 180) / Math.PI;
        const fromDeg = (towardDeg + 180 + 360) % 360;

        samples.push({
          altM,
          speedMs,
          fromDeg,
          t: (from.t + endT) / 2,
          quality,
        });
      }
    }

    start = i;
    accumulated = 0;
  }

  return { samples, bands: aggregate(samples, bandM), bandM };
}

/**
 * Average the turns into altitude bands.
 *
 * Directions are averaged as **vectors**, never as degrees: the arithmetic mean of 350° and 10° is
 * 180°, which is the exact opposite of the right answer and would be entirely believable on a
 * chart.
 */
function aggregate(samples: WindSample[], bandM: number): WindBand[] {
  const buckets = new Map<number, { u: number; v: number; n: number }>();

  for (const sample of samples) {
    const key = Math.floor(sample.altM / bandM) * bandM;
    const bucket = buckets.get(key) ?? { u: 0, v: 0, n: 0 };
    const radians = (sample.fromDeg * Math.PI) / 180;
    // Weighted by quality, so a ragged turn contributes less than a clean one.
    bucket.u += Math.sin(radians) * sample.speedMs * sample.quality;
    bucket.v += Math.cos(radians) * sample.speedMs * sample.quality;
    bucket.n += sample.quality;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([altM, bucket]) => {
      const u = bucket.u / bucket.n;
      const v = bucket.v / bucket.n;
      return {
        altM,
        speedMs: Math.hypot(u, v),
        fromDeg: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360,
        samples: Math.round(bucket.n),
      };
    })
    .sort((a, b) => a.altM - b.altM);
}

/** Compass point for a bearing, for a label that reads the way pilots talk. */
export function compassPoint(degrees: number): string {
  const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}
