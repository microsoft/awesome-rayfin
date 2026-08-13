import type { PathPoint } from './model';

const MS_TO_KMH = 3.6;

export interface SpeedSample {
  /** 0..1 across the chart width - by time when the timestamps are usable, else by index. */
  x: number;
  /** 0..1 up the chart height, relative to {@link SpeedSeries.ceilingKmh}. */
  y: number;
  kmh: number;
  /** Epoch ms, or null when the timestamp could not be parsed. */
  at: number | null;
}

export interface SpeedSeries {
  samples: SpeedSample[];
  minKmh: number;
  maxKmh: number;
  avgKmh: number;
  /** Top of the y axis - a rounded-up value so the line never touches the edge. */
  ceilingKmh: number;
  /** True when x is spaced by time rather than by sample index. */
  timeScaled: boolean;
  spanMs: number;
}

/** Round up to a readable axis maximum: 10, 20, 30, ... */
function ceilingFor(maxKmh: number): number {
  const step = 10;
  return Math.max(step, Math.ceil((maxKmh * 1.05) / step) * step);
}

function parseAt(timestamp: string): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Turn a vehicle's track into a normalised speed-over-time series.
 *
 * Kept free of any rendering concern so the awkward parts - unparseable timestamps, a track that
 * stands still, a single sample - are testable on their own.
 */
export function buildSpeedSeries(path: PathPoint[]): SpeedSeries | null {
  if (path.length < 2) return null;

  const points = path.map((point) => ({
    kmh: Math.max(0, (Number.isFinite(point.speed) ? point.speed : 0) * MS_TO_KMH),
    at: parseAt(point.timestamp),
  }));

  const times = points.map((p) => p.at).filter((at): at is number => at !== null);
  const timeScaled = times.length === points.length;
  const first = timeScaled ? Math.min(...times) : 0;
  const last = timeScaled ? Math.max(...times) : 0;
  const spanMs = last - first;
  // A track recorded within the same second would collapse every x to 0.
  const useTime = timeScaled && spanMs > 0;

  const speeds = points.map((p) => p.kmh);
  const maxKmh = Math.max(...speeds);
  const minKmh = Math.min(...speeds);
  const avgKmh = speeds.reduce((sum, kmh) => sum + kmh, 0) / speeds.length;
  const ceilingKmh = ceilingFor(maxKmh);

  const samples = points.map((point, index) => ({
    x: useTime && point.at !== null
      ? (point.at - first) / spanMs
      : index / (points.length - 1),
    y: point.kmh / ceilingKmh,
    kmh: point.kmh,
    at: point.at,
  }));

  return {
    samples,
    minKmh,
    maxKmh,
    avgKmh,
    ceilingKmh,
    timeScaled: useTime,
    spanMs: useTime ? spanMs : 0,
  };
}

/** Index of the sample nearest to a 0..1 position across the chart. */
export function nearestSample(series: SpeedSeries, fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < series.samples.length; index++) {
    const distance = Math.abs(series.samples[index].x - clamped);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** SVG path data for the line, in a 0..100 by 0..100 viewBox with y pointing down. */
export function linePath(series: SpeedSeries): string {
  return series.samples
    .map((sample, index) => {
      const x = (sample.x * 100).toFixed(2);
      const y = ((1 - sample.y) * 100).toFixed(2);
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

/** The same line closed along the baseline, for the area fill. */
export function areaPath(series: SpeedSeries): string {
  if (!series.samples.length) return '';
  const firstX = (series.samples[0].x * 100).toFixed(2);
  const lastX = (series.samples[series.samples.length - 1].x * 100).toFixed(2);
  return `${linePath(series)} L${lastX} 100 L${firstX} 100 Z`;
}
