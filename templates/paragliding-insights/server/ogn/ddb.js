/**
 * The OGN device database — the mechanism behind PLAN §2.2.1, the app's first non-negotiable rule.
 *
 * Pilots opt out of tracking by registering their device here, with two independent flags:
 *
 *   `tracked: 'N'`     do not show this aircraft at all
 *   `identified: 'N'`  show the aircraft, but never the pilot, registration or competition number
 *
 * Both are enforced **here, server-side**, so a flagged device never reaches the browser. Doing it
 * in the client would mean shipping the very data the flag exists to withhold and trusting the
 * front end not to draw it.
 *
 * ⚠️ **Suppressing the identity is not enough on its own.** The device id is a stable hardware
 * address, and this database is public — so a client holding a raw device id can look up the
 * registration itself, and `identified: 'N'` becomes decorative. Anonymous aircraft therefore
 * leave here under a salted hash, with the salt regenerated on every relay start: stable enough
 * for a trail to accumulate during a session, useless for correlating one session with the next.
 */

import { createHash, randomBytes } from 'node:crypto';

const DDB_URL = 'https://ddb.glidernet.org/download/?j=1';

/** Rotated per process, never logged, never sent. See the header note. */
const SALT = randomBytes(16).toString('hex');

export function anonymousId(deviceId) {
  return `anon-${createHash('sha256').update(SALT).update(deviceId).digest('hex').slice(0, 10)}`;
}

export class DeviceDatabase {
  constructor() {
    /** deviceId (upper hex) → { track, identify, model, registration, cn } */
    this.devices = new Map();
    this.fetchedAt = null;
  }

  get size() {
    return this.devices.size;
  }

  /**
   * Fetch and replace the device list.
   *
   * Throws on failure rather than degrading quietly. The caller decides what that means, and it
   * decides differently for the first fetch than for a refresh — see `relay.js`.
   */
  async refresh(signal) {
    const response = await fetch(DDB_URL, { signal });
    if (!response.ok) throw new Error(`DDB responded ${response.status}`);

    const payload = await response.json();
    const list = payload?.devices;
    if (!Array.isArray(list) || list.length === 0) {
      // An empty list would silently mean "nobody opted out", which is the one wrong answer this
      // module must never give.
      throw new Error('DDB returned no devices');
    }

    const next = new Map();
    for (const entry of list) {
      const id = String(entry.device_id ?? '').toUpperCase();
      if (!id) continue;
      next.set(id, {
        // Anything other than an explicit 'Y' is treated as opted out. The flags are the pilot's
        // instruction, and a malformed record is not consent.
        track: entry.tracked === 'Y',
        identify: entry.identified === 'Y',
        model: entry.aircraft_model || null,
        registration: entry.registration || null,
        cn: entry.cn || null,
      });
    }

    this.devices = next;
    this.fetchedAt = new Date().toISOString();
    return next.size;
  }

  /**
   * Apply the pilot's wishes to one report.
   *
   * Returns `null` if the aircraft must not be shown at all, otherwise the public identity the
   * browser is allowed to see.
   *
   * An **unknown** device is shown but never identified: it is not registered, so there is no
   * opt-out to honour and equally no consent to publish a name. That is the same position PLAN
   * §2.2.3 takes about the author's own flights.
   */
  publicIdentity(report) {
    // The in-band flags come from the aircraft itself and outrank the database, which may simply
    // not have heard of this device.
    if (report.stealth || report.noTrack) return null;

    const record = this.devices.get(report.deviceId);
    if (record && !record.track) return null;

    if (!record || !record.identify) {
      return { id: anonymousId(report.deviceId), registration: null, model: null, cn: null, known: Boolean(record) };
    }

    return {
      id: report.deviceId,
      registration: record.registration,
      model: record.model,
      cn: record.cn,
      known: true,
    };
  }
}
