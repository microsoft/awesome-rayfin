import type { AoiBbox, AoiConfig, AoiFocusPlace } from '@/config/aoi';
import { wgs84ToUtm32 } from '@/geo/utm';

/**
 * Where the AOI sits in projected metres, and how places land inside it.
 *
 * Deliberately free of Three.js. This is the arithmetic that decides whether the campus appears in
 * the right place and the right way round, and it is worth being able to test it without standing
 * up a WebGL context — a mirrored Z axis or a swapped corner is invisible in code review and
 * obvious only once 2 400 rooms are drawn in the wrong building.
 *
 * World units are metres with the AOI centred on the origin: **+x east, +z south**. The southward
 * Z is not arbitrary: the generated heightmap is stored row-major from north to south, so a row
 * index that increases southwards is the layout the terrain mesh wants. Fixing that convention
 * here, once, is what keeps the mesh, the buildings and the rooms from disagreeing later.
 */

export interface WorldExtent {
  minEasting: number;
  maxNorthing: number;
  widthM: number;
  depthM: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The AOI rectangle in UTM32 metres.
 *
 * Derived from the config bbox rather than from terrain metadata, so the scene can be laid out
 * before any terrain has been built. Once the pipeline has run, the generated metadata carries the
 * same rectangle and the two must agree — Phase 1 asserts that, because a divergence means the app
 * and the pipeline are projecting differently and every later layer inherits the error.
 */
export function worldExtent(bbox: AoiBbox): WorldExtent {
  const sw = wgs84ToUtm32(bbox.west, bbox.south);
  const ne = wgs84ToUtm32(bbox.east, bbox.north);
  const nw = wgs84ToUtm32(bbox.west, bbox.north);
  const se = wgs84ToUtm32(bbox.east, bbox.south);

  // All four corners, not two. A UTM rectangle is not axis-aligned in geographic coordinates, so
  // taking only SW and NE would clip the AOI by a few metres at the corners — small, but it is
  // exactly the kind of quiet offset that later reads as "the buildings are slightly off".
  const minEasting = Math.min(sw.easting, nw.easting, ne.easting, se.easting);
  const maxEasting = Math.max(sw.easting, nw.easting, ne.easting, se.easting);
  const minNorthing = Math.min(sw.northing, nw.northing, ne.northing, se.northing);
  const maxNorthing = Math.max(sw.northing, nw.northing, ne.northing, se.northing);

  return {
    minEasting,
    maxNorthing,
    widthM: maxEasting - minEasting,
    depthM: maxNorthing - minNorthing,
  };
}

/** A geographic point in world coordinates, at a given ground elevation. */
export function toWorld(lon: number, lat: number, ext: WorldExtent, groundM: number): WorldPoint {
  const { easting, northing } = wgs84ToUtm32(lon, lat);
  return {
    x: easting - ext.minEasting - ext.widthM / 2,
    y: groundM,
    z: ext.maxNorthing - northing - ext.depthM / 2,
  };
}

export function placeToWorld(
  place: AoiFocusPlace,
  ext: WorldExtent,
  groundM: number
): WorldPoint {
  return toWorld(place.lon, place.lat, ext, groundM);
}

/**
 * Is a place inside its own AOI?
 *
 * A focus place outside the bbox is always a configuration error — either the coordinate was
 * resolved from the wrong feature or the box was drawn around the wrong thing. Both have already
 * happened once in this project's history, which is why this is a function rather than a comment.
 */
export function isInsideExtent(point: WorldPoint, ext: WorldExtent, marginM = 0): boolean {
  return (
    Math.abs(point.x) <= ext.widthM / 2 + marginM && Math.abs(point.z) <= ext.depthM / 2 + marginM
  );
}

/** Every focus place that falls outside the AOI bbox. Empty is the only acceptable result. */
export function placesOutsideAoi(aoi: AoiConfig): AoiFocusPlace[] {
  const ext = worldExtent(aoi.bbox);
  return aoi.focusPlaces.filter(
    (place) => !isInsideExtent(placeToWorld(place, ext, 0), ext)
  );
}
