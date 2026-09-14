import { describe, expect, it } from 'vitest';

import { DeviceDatabase, anonymousId } from '../ddb.js';
import { Traffic, TRAIL_S } from '../traffic.js';

/**
 * The privacy rule (PLAN §2.2.1) is the app's first non-negotiable, so it is tested at the
 * boundary it is enforced at rather than through the relay as a whole. These are the four cases
 * that matter, and the third is the one that is easy to get wrong.
 */
describe('device database privacy', () => {
  const db = new DeviceDatabase();
  db.devices = new Map([
    ['AAAA01', { track: true, identify: true, model: 'Ozone Zeno', registration: 'D-1234', cn: 'AK' }],
    ['AAAA02', { track: true, identify: false, model: 'Nova Mentor', registration: 'D-5678', cn: null }],
    ['AAAA03', { track: false, identify: true, model: 'Advance Omega', registration: 'D-9012', cn: null }],
  ]);

  const report = (deviceId, extra = {}) => ({
    deviceId,
    stealth: false,
    noTrack: false,
    ...extra,
  });

  it('publishes an identity only when the owner consented to it', () => {
    const identity = db.publicIdentity(report('AAAA01'));
    expect(identity.id).toBe('AAAA01');
    expect(identity.registration).toBe('D-1234');
  });

  it('withholds the registration when identify is off', () => {
    const identity = db.publicIdentity(report('AAAA02'));
    expect(identity.registration).toBeNull();
    expect(identity.model).toBeNull();
  });

  /**
   * ⚠️ The case that makes suppressing the registration actually mean something. The device id is a
   * stable hardware address and the OGN database is public, so sending the raw id alongside a null
   * registration would let any client look the pilot up and undo the flag.
   */
  it('does not leak the device id of an unidentified aircraft', () => {
    const identity = db.publicIdentity(report('AAAA02'));
    expect(identity.id).not.toBe('AAAA02');
    expect(identity.id).toMatch(/^anon-/);
    expect(identity.id.toUpperCase()).not.toContain('AAAA02');
  });

  it('suppresses an aircraft whose owner opted out of tracking', () => {
    expect(db.publicIdentity(report('AAAA03'))).toBeNull();
  });

  it('honours the in-band flags even for a device it has never heard of', () => {
    expect(db.publicIdentity(report('BBBB01', { noTrack: true }))).toBeNull();
    expect(db.publicIdentity(report('BBBB01', { stealth: true }))).toBeNull();
  });

  it('treats an unregistered device as anonymous rather than as consenting', () => {
    // The common case: paraglider instruments are rarely registered. Of the seven paragliders
    // airborne during the spike, none were in the database.
    const identity = db.publicIdentity(report('BBBB02'));
    expect(identity).not.toBeNull();
    expect(identity.id).toMatch(/^anon-/);
    expect(identity.registration).toBeNull();
    expect(identity.known).toBe(false);
  });

  it('gives one device a stable anonymous id within a session', () => {
    expect(anonymousId('AAAA02')).toBe(anonymousId('AAAA02'));
    expect(anonymousId('AAAA02')).not.toBe(anonymousId('AAAA03'));
  });
});

describe('traffic state', () => {
  const bbox = { west: 10.1, east: 10.5, south: 47.3, north: 47.6 };
  const identity = { id: 'anon-test', registration: null, model: null, cn: null, known: false };

  const fix = (extra = {}) => ({
    deviceId: '1164F8',
    source: 'FNT',
    aircraftType: 'paraglider',
    lat: 47.4,
    lon: 10.3,
    altM: 2000,
    climbMs: 1.5,
    groundMs: 8,
    courseDeg: 90,
    turnRate: 0,
    ...extra,
  });

  it('ignores aircraft outside the shell', () => {
    const traffic = new Traffic(bbox);
    expect(traffic.ingest(fix({ lat: 48.9, lon: 9.2 }), identity)).toBeNull();
    expect(traffic.aircraft.size).toBe(0);
  });

  /**
   * ⚠️ Measured, not hypothetical: device 1164F8 was relayed as both FNT1164F8 and FLR1164F8 within
   * one second, with altitudes 134 m apart. Accepting both would draw a trail that oscillates by
   * more than the height of the launch above the valley floor.
   */
  it('accepts one transmitter per device while that transmitter is live', () => {
    let now = 1000;
    const traffic = new Traffic(bbox, () => now);

    traffic.ingest(fix({ source: 'FNT', altM: 2260 }), identity);
    now += 1;
    const second = traffic.ingest(fix({ source: 'FLR', altM: 2394 }), identity);

    expect(second).toBeNull();
    expect(traffic.aircraft.get('anon-test').altM).toBe(2260);
  });

  it('switches transmitter once the first one goes quiet', () => {
    // Because the winning source is a receiver, and the aircraft will fly out of its range.
    let now = 1000;
    const traffic = new Traffic(bbox, () => now);

    traffic.ingest(fix({ source: 'FNT', altM: 2260 }), identity);
    now += 120;
    const later = traffic.ingest(fix({ source: 'FLR', altM: 2394 }), identity);

    expect(later).not.toBeNull();
    expect(traffic.aircraft.get('anon-test').altM).toBe(2394);
  });

  it('keeps only the last twenty minutes of trail', () => {
    let now = 1000;
    const traffic = new Traffic(bbox, () => now);

    for (let i = 0; i < 100; i++) {
      traffic.ingest(fix({ lat: 47.4 + i * 1e-4 }), identity);
      now += 30;
    }

    const trail = traffic.aircraft.get('anon-test').trail;
    const lastFixAt = trail[trail.length - 1].t;

    // The window is trimmed on ingest, so the guarantee is about the span the trail covers at the
    // moment a fix arrives — not about wall-clock time since. An aircraft that stops reporting
    // keeps its trail as it was until `prune` removes the aircraft entirely.
    expect(trail.length).toBeLessThanOrEqual(TRAIL_S / 30 + 1);
    expect(lastFixAt - trail[0].t).toBeLessThanOrEqual(TRAIL_S);
    expect(lastFixAt - trail[0].t).toBeGreaterThan(TRAIL_S - 60);
  });

  it('drops an aircraft that has stopped reporting', () => {
    let now = 1000;
    const traffic = new Traffic(bbox, () => now);

    traffic.ingest(fix(), identity);
    expect(traffic.prune()).toEqual([]);

    now += 600;
    expect(traffic.prune()).toEqual(['anon-test']);
    expect(traffic.aircraft.size).toBe(0);
  });

  it('sends the trail on a snapshot and omits it on an update', () => {
    const traffic = new Traffic(bbox);
    traffic.ingest(fix(), identity);
    const craft = traffic.aircraft.get('anon-test');

    expect(traffic.serialise(craft, true).trail).toBeDefined();
    expect(traffic.serialise(craft, false).trail).toBeUndefined();
  });
});
