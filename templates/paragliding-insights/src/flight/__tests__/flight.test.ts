import { describe, expect, it } from 'vitest';

import { parseIgc, IgcParseError } from '../igc';
import { buildTrack } from '../track';
import { deriveWind } from '../wind';

/** A minimal but real-shaped IGC, in the exact fixed-width format XCTracer writes. */
function igc(bRecords: string[]): string {
  return ['AXTR000', 'HFDTE240421', 'HFPLTPILOTINCHARGE:', ...bRecords].join('\n');
}

describe('parseIgc', () => {
  it('reads position, time and both altitudes from a B record', () => {
    const flight = parseIgc(
      igc([
        'B1049424732287N01013129EA0130101399',
        'B1049434732289N01013136EA0130101400',
      ])
    );
    expect(flight.date).toBe('2021-04-24');
    expect(flight.logger).toBe('XTR');
    expect(flight.fixes).toHaveLength(2);

    const fix = flight.fixes[0];
    expect(fix.seconds).toBe(10 * 3600 + 49 * 60 + 42);
    // 47°32.287' -> 47 + 32.287/60
    expect(fix.lat).toBeCloseTo(47.538117, 5);
    expect(fix.lon).toBeCloseTo(10.218817, 5);
    expect(fix.pressureM).toBe(1301);
    expect(fix.gpsM).toBe(1399);
    expect(fix.valid).toBe(true);
  });

  it('reports whether the file still identifies a pilot', () => {
    // An empty HFPLT is the anonymised state and must not count as identification.
    const anonymous = parseIgc(
      igc([
        'B1049424732287N01013129EA0130101399',
        'B1049434732289N01013136EA0130101400',
      ])
    );
    expect(anonymous.identified).toBe(false);

    const named = [
      'AXTR000',
      'HFDTE240421',
      'HFPLTPILOTINCHARGE:Jane Doe',
      'B1049424732287N01013129EA0130101399',
      'B1049434732289N01013136EA0130101400',
    ].join('\n');
    expect(parseIgc(named).identified).toBe(true);
  });

  it('keeps time monotonic across midnight', () => {
    // 23:59:59 followed by 00:00:01 is the next day, not sixteen hours backwards. A naive parser
    // makes the scrubber run in reverse for the rest of the flight.
    const flight = parseIgc(
      igc([
        'B2359594732287N01013129EA0130101399',
        'B0000014732289N01013136EA0130101400',
      ])
    );
    expect(flight.fixes[1].seconds).toBeGreaterThan(flight.fixes[0].seconds);
    expect(flight.fixes[1].seconds - flight.fixes[0].seconds).toBe(2);
  });

  it('skips unparseable lines rather than refusing the file', () => {
    const flight = parseIgc(
      igc([
        'B1049424732287N01013129EA0130101399',
        'Gsomeproprietarychecksumrecord',
        'B1049434732289N01013136EA0130101400',
      ])
    );
    expect(flight.fixes).toHaveLength(2);
  });

  it('rejects a file with no fixes', () => {
    expect(() => parseIgc('AXTR000\nHFDTE240421\n')).toThrow(IgcParseError);
  });
});

describe('buildTrack', () => {
  const origin = { centreEasting: 600000, centreNorthing: 5251000 };

  it('places north at negative z', () => {
    // The terrain plane is rotated flat, which puts +Z to the SOUTH. Getting this backwards
    // mirrors every flight about the valley axis and still looks plausible.
    const flight = parseIgc(
      igc([
        'B1000004724000N01013000EA0100001000',
        'B1000104725000N01013000EA0100001000',
      ])
    );
    const track = buildTrack(flight, origin, 'test');
    expect(track.points[1].z).toBeLessThan(track.points[0].z);
  });

  it('derives climb from pressure altitude, not GPS altitude', () => {
    // GPS altitude here is deliberately noisy and flat while pressure altitude climbs steadily.
    // The vario must follow the pressure trace.
    const records: string[] = [];
    for (let i = 0; i < 20; i++) {
      const seconds = String(i).padStart(2, '0');
      const pressure = String(1000 + i * 2).padStart(5, '0');
      const gps = String(1000 + ((i * 7) % 5)).padStart(5, '0');
      records.push(`B1000${seconds}4724000N01013000EA${pressure}${gps}`);
    }
    const track = buildTrack(parseIgc(igc(records)), origin, 'test');
    const middle = track.points[10];
    expect(middle.varioMs).toBeCloseTo(2, 1);
  });

  it('drops 2D fixes, which carry no trustworthy altitude', () => {
    const flight = parseIgc(
      igc([
        'B1000004724000N01013000EA0100001000',
        'B1000014724000N01013000EV0100000000',
        'B1000024724000N01013000EA0100001000',
      ])
    );
    expect(buildTrack(flight, origin, 'test').points).toHaveLength(2);
  });
});

describe('deriveWind', () => {
  /**
   * A synthetic thermal: a perfect circle, translated at a known wind speed, climbing steadily.
   * If the derivation is right it must recover that translation exactly — this is the one test
   * that can prove the wind figures are a measurement rather than a plausible-looking number.
   */
  function circlingClimb(windX: number, windZ: number, turns = 6) {
    const points = [];
    const radius = 40;
    const period = 20; // seconds per turn
    const dt = 1;
    let t = 0;
    for (let n = 0; n < turns * period; n += dt) {
      const angle = (n / period) * Math.PI * 2;
      points.push({
        t,
        x: Math.cos(angle) * radius + windX * t,
        z: Math.sin(angle) * radius + windZ * t,
        altM: 1000 + t * 2,
        varioMs: 2,
        groundMs: 10,
        lat: 47.4,
        lon: 10.3,
      });
      t += dt;
    }
    return points;
  }

  it('recovers the speed and direction of a known wind', () => {
    // 5 m/s blowing towards the east, i.e. a wind FROM the west (270°).
    const profile = deriveWind(circlingClimb(5, 0));
    expect(profile.samples.length).toBeGreaterThan(3);

    for (const sample of profile.samples) {
      expect(sample.speedMs).toBeCloseTo(5, 1);
      expect(sample.fromDeg).toBeCloseTo(270, 0);
    }
  });

  it('reports a wind from the north as 0°, not 180°', () => {
    // World +z is SOUTH, so a wind from the north drifts the circle towards +z.
    const profile = deriveWind(circlingClimb(0, 4));
    const bearing = profile.samples[0].fromDeg;
    expect(Math.min(bearing, 360 - bearing)).toBeCloseTo(0, 0);
  });

  it('finds no wind in a straight glide', () => {
    // No circles means no drift measurement. Inventing one here is exactly the failure this whole
    // approach exists to avoid.
    const points = Array.from({ length: 300 }, (_, i) => ({
      t: i,
      x: i * 12,
      z: i * 3,
      altM: 2000 - i,
      varioMs: -1,
      groundMs: 12,
      lat: 47.4,
      lon: 10.3,
    }));
    expect(deriveWind(points).samples).toHaveLength(0);
  });

  it('averages directions as vectors, so 350° and 10° give 0° rather than 180°', () => {
    const profile = deriveWind(circlingClimb(0, 4));
    const band = profile.bands[0];
    expect(band).toBeDefined();
    expect(Math.min(band.fromDeg, 360 - band.fromDeg)).toBeLessThan(5);
  });
});
