const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * 8-point compass label for a GTFS-RT bearing, so `BEARING · E` reads without doing trigonometry
 * in your head.
 *
 * Bearings arrive as degrees clockwise from north and are not guaranteed to be in range - the
 * feed occasionally reports 360, and a wrapped value must land back on N rather than off the end
 * of the table.
 */
export function compassPoint(bearing: number): string {
  if (!Number.isFinite(bearing)) return '-';
  const normalised = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(normalised / 45) % 8];
}
