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

  it('is a campus-sized rectangle, not a country', () => {
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
  const OTH = AOIS['oth-regensburg'];

  it('puts +x east and +z south', () => {
    const aoi = OTH;
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
    // North is NEGATIVE z. Getting this backwards mirrors the entire campus.
    expect(north.z).toBeLessThan(centre.z);
  });

  it('centres the AOI on the origin', () => {
    const ext = worldExtent(OTH.bbox);
    const centreLon = (OTH.bbox.west + OTH.bbox.east) / 2;
    const centreLat = (OTH.bbox.south + OTH.bbox.north) / 2;
    const centre = placeToWorld({ id: 'c', name: 'c', lon: centreLon, lat: centreLat }, ext, 0);

    // Within 50 m of the origin: not exact, because a UTM rectangle is not axis-aligned in
    // geographic coordinates, but far closer than the size of a building.
    expect(Math.abs(centre.x)).toBeLessThan(50);
    expect(Math.abs(centre.z)).toBeLessThan(50);
  });

  it('agrees with the UTM zone the pipeline works in', () => {
    const seyboth = wgs84ToUtm32(12.09627, 49.00308);
    const pruefening = wgs84ToUtm32(12.07024, 49.01742);

    // EPSG:25832's central meridian is 9°E, where the easting is exactly the 500 km false
    // easting. Regensburg sits ~3.1° further east and lands near 725 km. Values measured with
    // the pipeline's own `tools/geodata/utm.py`, not recalled:
    //   Seybothstraße  726 440 E / 5 432 418 N
    //   Prüfening      724 472 E / 5 433 935 N
    // Anything wildly outside those bands means the projection is returning degrees, or the
    // wrong zone.
    for (const p of [seyboth, pruefening]) {
      expect(p.easting).toBeGreaterThan(720_000);
      expect(p.easting).toBeLessThan(730_000);
      expect(p.northing).toBeGreaterThan(5_425_000);
      expect(p.northing).toBeLessThan(5_440_000);
    }

    // The two campuses must not collapse onto each other: Seybothstraße is the eastern and
    // southern of the pair, and the separation is the constraint this whole app exists for.
    expect(seyboth.easting).toBeGreaterThan(pruefening.easting);
    expect(seyboth.northing).toBeLessThan(pruefening.northing);
    const gapM = Math.hypot(
      seyboth.easting - pruefening.easting,
      seyboth.northing - pruefening.northing
    );
    expect(gapM).toBeGreaterThan(2_000);
    expect(gapM).toBeLessThan(3_000);
  });

  it('reports a place outside the box rather than clamping it', () => {
    const ext = worldExtent(OTH.bbox);
    // Neutraubling — a real town ~7 km east of Regensburg, from the same Overpass sweep that
    // produced the control points (node/34207240).
    //
    // ⚠️ The first version of this test used the Regensburg Dom and FAILED, which is the test
    // doing its job: this AOI is not "a campus", it is two campuses plus the corridor between
    // them, and the corridor swallows the Altstadt. The cathedral, the Danube and a good part of
    // the old town are all INSIDE the box. Pick an out-of-AOI point from outside the city.
    const neutraubling = placeToWorld({ id: 'n', name: 'n', lon: 12.199075, lat: 48.992657 }, ext, 0);
    expect(isInsideExtent(neutraubling, ext)).toBe(false);
  });
});
