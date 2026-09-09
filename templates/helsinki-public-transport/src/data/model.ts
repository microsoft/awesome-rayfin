export type DaxRow = Record<string, unknown>;

/**
 * Read a column out of a Power BI `executeQueries` row.
 *
 * Power BI returns either the bare alias or a qualified name (`[alias]`,
 * `'Table'[alias]`) depending on the query shape, so match on both.
 */
export function daxRaw(row: DaxRow, alias: string): unknown {
  if (alias in row) return row[alias];
  for (const key of Object.keys(row)) {
    if (key === `[${alias}]` || key.endsWith(`[${alias}]`)) return row[key];
  }
  return undefined;
}

export function daxString(row: DaxRow, alias: string): string {
  const value = daxRaw(row, alias);
  return value == null ? '' : String(value);
}

export function daxNumber(row: DaxRow, alias: string): number {
  const value = daxRaw(row, alias);
  if (value == null || value === '') return NaN;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** A vehicle's latest known position. */
export interface Vehicle {
  vehicleId: string;
  route: string;
  label: string;
  lat: number;
  lon: number;
  bearing: number;
  /** metres per second, as reported by the GTFS-RT feed */
  speed: number;
  /** km/h, derived from {@link speed} */
  speedKmh: number;
  occupancy: string;
  /** POSIX seconds from the feed, or NaN when absent */
  timestamp: number;
}

/** One sample of a vehicle's recent track. */
export interface PathPoint {
  lat: number;
  lon: number;
  speed: number;
  bearing: number;
  timestamp: string;
}

export interface Counters {
  positionsLastHour: number;
  positionsTotal: number;
}

const MS_TO_KMH = 3.6;

export function toVehicle(row: DaxRow): Vehicle | null {
  const lat = daxNumber(row, 'position_latitude');
  const lon = daxNumber(row, 'position_longitude');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;

  const speed = daxNumber(row, 'position_speed');
  return {
    vehicleId: daxString(row, 'vehicle_id'),
    route: daxString(row, 'trip_route_id'),
    label: daxString(row, 'vehicle_label'),
    lat,
    lon,
    bearing: daxNumber(row, 'position_bearing') || 0,
    speed: Number.isFinite(speed) ? speed : 0,
    speedKmh: Number.isFinite(speed) ? speed * MS_TO_KMH : 0,
    occupancy: daxString(row, 'occupancy_status'),
    timestamp: daxNumber(row, 'vehicle_timestamp'),
  };
}

export function toPathPoint(row: DaxRow): PathPoint | null {
  const lat = daxNumber(row, 'Latitude');
  const lon = daxNumber(row, 'Longitude');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    speed: daxNumber(row, 'Speed') || 0,
    bearing: daxNumber(row, 'Bearing') || 0,
    timestamp: daxString(row, 'timestamp'),
  };
}
