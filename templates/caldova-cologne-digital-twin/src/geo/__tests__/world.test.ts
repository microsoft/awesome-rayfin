import { describe, expect, it } from 'vitest';

import { AOIS, type AoiConfig } from '@/config/aoi';
import { wgs84ToUtm32 } from '@/geo/utm';
import { isInsideExtent, placeToWorld, placesOutsideAoi, worldExtent } from '@/geo/world';

/**
 * Phase 0 exit criteria, as assertions.
 *
 * These tests exist because the AOIs of the app this engine came from had already produced wrong
 * coordinates during setup — a fraternity house instead of a castle, a bookshop instead of the
 * Hölderlinturm — and neither was caught by reading the config. The cheapest place to catch a
 * misplaced campus is before there is anything drawn on it.
 *
 * They earned their keep again on the first day of this fork: the lens test below caught an AOI
 * that declared an `occupancy` lens while having no room data at all.
 */

const aois = Object.entries(AOIS) as [string, AoiConfig][];

// The id is consumed by the `%s` in the suite name, not by the body.
describe.each(aois)('AOI %s', (_id, aoi) => {
  it('has a bbox that is the right way round', () => {
    expect(aoi.bbox.east).toBeGreaterThan(aoi.bbox.west);
    expect(aoi.bbox.north).toBeGreaterThan(aoi.bbox.south);
  });

  it('sits inside its own shell', () => {
    expect(aoi.shell.west).toBeLessThanOrEqual(aoi.bbox.west);
    expect(aoi.shell.east).toBeGreaterThanOrEqual(aoi.bbox.east);
    expect(aoi.shell.south).toBeLessThanOrEqual(aoi.bbox.south);
    expect(aoi.shell.north).toBeGreaterThanOrEqual(aoi.bbox.north);
  });

  it('is a site-sized rectangle, not a country', () => {
    const ext = worldExtent(aoi.bbox);
    // Between 1 and 6 km on a side. Smaller means the box was drawn around a single building;
    // larger means the 2 m grid is about to produce an unusable heightmap.
    expect(ext.widthM).toBeGreaterThan(1000);
    expect(ext.widthM).toBeLessThan(6000);
    expect(ext.depthM).toBeGreaterThan(1000);
    expect(ext.depthM).toBeLessThan(6000);
  });

  it('places every focus place inside the AOI', () => {
    const stray = placesOutsideAoi(aoi);
    expect(
      stray.map((p) => `${p.id} (${p.lat}, ${p.lon})`),
      'focus places outside the bbox — the coordinate or the box is wrong'
    ).toEqual([]);
  });

  it('declares only lenses whose data requirements it can meet', () => {
    // A room-level lens without a rooms block would render an empty building and read as a bug.
    if (aoi.lenses.includes('occupancy')) expect(aoi.rooms).toBeDefined();
    if (aoi.lenses.includes('condition')) expect(aoi.condition).toBeDefined();
    // Staffing divides the generated timetable. A site without one has no teaching load to
    // report, and an empty lens reads as a broken one.
    if (aoi.lenses.includes('staffing')) expect(aoi.staffing).toBeDefined();
    if (aoi.lenses.includes('quality')) expect(aoi.planQuality).toBeDefined();
  });

  it('keeps the heightmap within a sane memory budget', () => {
    const ext = worldExtent(aoi.bbox);
    const samples =
      (ext.widthM / aoi.grids.renderResolutionM) * (ext.depthM / aoi.grids.renderResolutionM);
    // uint16 per sample. Above ~32 MB the browser is being asked to hold a raster that should
    // have been tiled instead.
    expect(samples * 2).toBeLessThan(32 * 1024 * 1024);
  });
});

describe('world projection', () => {
  // ⚠️ Re-pointed from the OTH Regensburg AOI, which no longer exists in this repository. The
  // projection contract is worth testing against the area of interest actually shipped, not
  // against one carried over from the engine's previous life.
  const SITE = AOIS['koeln-messe'];

  it('puts +x east and +z south', () => {
    const aoi = SITE;
    const ext = worldExtent(aoi.bbox);
    const centreLon = (aoi.bbox.west + aoi.bbox.east) / 2;
    const centreLat = (aoi.bbox.south + aoi.bbox.north) / 2;

    const centre = placeToWorld({ id: 'c', name: 'c', lon: centreLon, lat: centreLat }, ext, 0);
    const east = placeToWorld(
      { id: 'e', name: 'e', lon: centreLon + 0.005, lat: centreLat },
      ext,
      0
    );
    const north = placeToWorld(
      { id: 'n', name: 'n', lon: centreLon, lat: centreLat + 0.005 },
      ext,
      0
    );

    expect(east.x).toBeGreaterThan(centre.x);
    // North is NEGATIVE z. Getting this backwards mirrors the entire site.
    expect(north.z).toBeLessThan(centre.z);
  });

  it('centres the AOI on the origin', () => {
    const ext = worldExtent(SITE.bbox);
    const centreLon = (SITE.bbox.west + SITE.bbox.east) / 2;
    const centreLat = (SITE.bbox.south + SITE.bbox.north) / 2;
    const centre = placeToWorld({ id: 'c', name: 'c', lon: centreLon, lat: centreLat }, ext, 0);

    // Within 50 m of the origin: not exact, because a UTM rectangle is not axis-aligned in
    // geographic coordinates, but far closer than the size of a building.
    expect(Math.abs(centre.x)).toBeLessThan(50);
    expect(Math.abs(centre.z)).toBeLessThan(50);
  });

  it('agrees with the UTM zone the pipeline works in', () => {
    const confex = wgs84ToUtm32(6.9747092, 50.9441324);
    const halle1 = wgs84ToUtm32(6.9765042, 50.945927);

    // Cologne sits ~2° WEST of EPSG:25832's 9°E central meridian, so the easting is far below the
    // 500 km false easting. Value measured by the pipeline (pyproj, fetch_nrw_mesh.py 2026-10-17):
    // the Confex projects to 357 722 E / 5 645 565 N.
    expect(Math.abs(confex.easting - 357_722)).toBeLessThan(2);
    expect(Math.abs(confex.northing - 5_645_565)).toBeLessThan(2);

    // Halle 1 and the Confex are neighbours on the same fair ground, not the same point.
    const gapM = Math.hypot(confex.easting - halle1.easting, confex.northing - halle1.northing);
    expect(gapM).toBeGreaterThan(100);
    expect(gapM).toBeLessThan(400);
  });

  it('reports a place outside the box rather than clamping it', () => {
    const ext = worldExtent(SITE.bbox);
    // Leverkusen — ~10 km north, unambiguously outside a 3 km box.
    const leverkusen = placeToWorld({ id: 'l', name: 'l', lon: 6.99, lat: 51.03 }, ext, 0);
    expect(isInsideExtent(leverkusen, ext)).toBe(false);
  });
});
