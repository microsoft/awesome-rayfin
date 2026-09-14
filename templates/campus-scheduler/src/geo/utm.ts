/**
 * WGS84 → UTM zone 32N, without a projection library.
 *
 * A direct port of `tools/geodata/utm.py`, and it has to stay one: the terrain grid is generated
 * by the Python side and a flight track is placed on it by this one. If the two projections
 * disagree by so much as a few metres, tracks drift off the ridges they actually flew along —
 * which is invisible from the code and obvious in the render.
 *
 * Transverse Mercator on the GRS80/WGS84 ellipsoid (Krüger series, 6th order), which is what
 * EPSG:25832 uses. Accurate to a few millimetres across a UTM zone.
 */

const A = 6378137.0;
const F = 1 / 298.257222101;
const N = F / (2 - F);

const K0 = 0.9996;
const FALSE_EASTING = 500000.0;
const FALSE_NORTHING = 0.0;

const UTM_ZONE = 32;
const LON_ORIGIN = ((6 * UTM_ZONE - 183) * Math.PI) / 180;

const A_BAR = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const ALPHA = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3,
  (61 / 240) * N ** 3,
];

export interface Utm {
  easting: number;
  northing: number;
}

export function wgs84ToUtm32(lon: number, lat: number): Utm {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180 - LON_ORIGIN;

  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) -
      ((2 * Math.sqrt(N)) / (1 + N)) * Math.atanh(((2 * Math.sqrt(N)) / (1 + N)) * Math.sin(phi))
  );
  const xi = Math.atan(t / Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));

  let easting = K0 * A_BAR * eta;
  let northing = K0 * A_BAR * xi;
  ALPHA.forEach((alpha, index) => {
    const j = index + 1;
    easting += K0 * A_BAR * alpha * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    northing += K0 * A_BAR * alpha * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  });

  return { easting: easting + FALSE_EASTING, northing: northing + FALSE_NORTHING };
}
