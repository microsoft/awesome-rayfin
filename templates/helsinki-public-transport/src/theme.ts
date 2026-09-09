/** Shared visual language: speed ramp used by both the map markers and the fleet list. */

const RAMP: Array<{ maxKmh: number; color: string }> = [
  { maxKmh: 1, color: '#94a3b8' }, // stationary - slate
  { maxKmh: 15, color: '#f59e0b' }, // crawling - amber
  { maxKmh: 30, color: '#34d399' }, // normal - emerald
  { maxKmh: 60, color: '#38bdf8' }, // fast - sky
  { maxKmh: Infinity, color: '#a78bfa' }, // very fast - violet
];

export function speedColor(speedKmh: number): string {
  const bucket = RAMP.find((b) => speedKmh < b.maxKmh);
  return bucket ? bucket.color : RAMP[RAMP.length - 1].color;
}

/** Below this the vehicle counts as standing still - same cut the speed ramp uses for 'stopped'. */
export const STOPPED_BELOW_KMH = 1;

/**
 * Colour every unselected vehicle takes while a comparison is open. Greying the rest is what
 * makes a handful of tracked vehicles findable in a fleet of 1,300.
 */
export const DIMMED_COLOR = '#6b7280';

export const SPEED_LEGEND = [
  { label: 'stopped', color: '#94a3b8' },
  { label: '< 15', color: '#f59e0b' },
  { label: '< 30', color: '#34d399' },
  { label: '< 60', color: '#38bdf8' },
  { label: '60+', color: '#a78bfa' },
];

/**
 * Per-vehicle colours for the comparison tracks.
 *
 * Deliberately distinct from the speed ramp above: a marker's fill still means "how fast", while
 * these identify *which* of the selected vehicles a track belongs to.
 */
const TRACK_COLORS = [
  '#38bdf8', // sky
  '#fb7185', // rose
  '#fbbf24', // amber
  '#4ade80', // green
  '#c084fc', // purple
];

export function trackColor(index: number): string {
  return TRACK_COLORS[((index % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length];
}
