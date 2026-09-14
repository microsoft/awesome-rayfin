/**
 * Live traffic state — what is in the air right now, and where it has just been.
 *
 * The relay holds this rather than the browser, for three reasons: a client that connects
 * mid-session gets a populated map instead of an empty one that fills in over twenty minutes; the
 * trail memory is bounded once instead of once per viewer; and the privacy filter has already run
 * by the time anything is stored, so opted-out aircraft are absent from the state rather than
 * filtered on the way out.
 */

/** Trails fade over the last 20 minutes — PLAN §3, Mode C. */
export const TRAIL_S = 20 * 60;

/**
 * How long an aircraft stays on the map after its last report.
 *
 * Generous, because OGN coverage is line-of-sight and a paraglider low in a side valley can drop
 * out for a minute at a time. Too short and gliders blink; too long and the map shows aircraft
 * that landed a quarter of an hour ago as though they were still flying.
 */
export const STALE_S = 180;

/**
 * How long to wait before accepting a different transmitter for a device already being tracked.
 *
 * ⚠️ This exists because of a measured problem, not a theoretical one. Device `1164F8` was relayed
 * simultaneously as `FNT1164F8` and `FLR1164F8` with altitudes 134 m apart. Taking both would draw
 * a trail that oscillates by more than the height of the launch above the valley. So one source
 * wins per device — but not permanently, because that source is a receiver that the aircraft will
 * eventually fly out of range of.
 */
const SOURCE_HOLD_S = 45;

export class Traffic {
  /**
   * @param {{west:number,east:number,south:number,north:number}} bbox area worth relaying
   * @param {() => number} now seconds, injectable so the tests are not timing-dependent
   */
  constructor(bbox, now = () => Date.now() / 1000) {
    this.bbox = bbox;
    this.now = now;
    /** public id → aircraft */
    this.aircraft = new Map();
  }

  inBbox(lat, lon) {
    return (
      lon >= this.bbox.west && lon <= this.bbox.east && lat >= this.bbox.south && lat <= this.bbox.north
    );
  }

  /**
   * Fold one privacy-filtered report into the state.
   *
   * Returns the updated aircraft, or null if the report was not used — out of area, or from the
   * transmitter that lost the coin toss for this device.
   */
  ingest(report, identity) {
    if (!this.inBbox(report.lat, report.lon)) return null;

    const t = this.now();
    const existing = this.aircraft.get(identity.id);

    if (existing) {
      // One source per device, until the winning source goes quiet. See SOURCE_HOLD_S.
      if (existing.source !== report.source && t - existing.lastSeen < SOURCE_HOLD_S) return null;

      // A repeated fix from the same second carries no new information and would put two trail
      // vertices in the same place.
      if (t - existing.lastSeen < 0.5 && existing.lat === report.lat && existing.lon === report.lon) {
        return null;
      }
    }

    const craft = existing ?? {
      id: identity.id,
      registration: identity.registration,
      model: identity.model,
      cn: identity.cn,
      known: identity.known,
      type: report.aircraftType,
      firstSeen: t,
      trail: [],
    };

    craft.source = report.source;
    craft.type = report.aircraftType;
    craft.lat = report.lat;
    craft.lon = report.lon;
    craft.altM = report.altM;
    craft.climbMs = report.climbMs;
    craft.groundMs = report.groundMs;
    craft.courseDeg = report.courseDeg;
    craft.turnRate = report.turnRate;
    craft.lastSeen = t;

    // ⚠️ Trail timestamps are *receive* times, not the fix times in the packet. OGN latency is a
    // couple of seconds and roughly constant, so the spacing is right either way — but receive
    // time is monotonic, immune to a transmitter with a bad clock, and does not wrap at midnight,
    // which the packet's seconds-since-UTC-midnight stamp does. The app never quotes these times
    // to the viewer, so the small constant offset costs nothing.
    craft.trail.push({ t, lat: report.lat, lon: report.lon, altM: report.altM });

    const cutoff = t - TRAIL_S;
    while (craft.trail.length > 0 && craft.trail[0].t < cutoff) craft.trail.shift();

    this.aircraft.set(identity.id, craft);
    return craft;
  }

  /** Drop anything that has stopped reporting. Returns the ids removed, so they can be announced. */
  prune() {
    const cutoff = this.now() - STALE_S;
    const gone = [];
    for (const [id, craft] of this.aircraft) {
      if (craft.lastSeen < cutoff) {
        this.aircraft.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  /** Everything currently airborne, trails included — what a newly connected client receives. */
  snapshot() {
    return [...this.aircraft.values()].map((craft) => this.serialise(craft, true));
  }

  /**
   * One aircraft, for the wire.
   *
   * Trails are sent whole on the snapshot and omitted on updates: the client already has the
   * history and appends the new fix itself, so re-sending 240 points per aircraft per second would
   * be almost all of the bandwidth and none of the information.
   */
  serialise(craft, withTrail) {
    const out = {
      id: craft.id,
      type: craft.type,
      lat: craft.lat,
      lon: craft.lon,
      altM: Math.round(craft.altM),
      climbMs: craft.climbMs,
      groundMs: craft.groundMs,
      courseDeg: craft.courseDeg,
      t: Math.round(craft.lastSeen),
      registration: craft.registration,
      model: craft.model,
      cn: craft.cn,
    };
    if (withTrail) {
      out.trail = craft.trail.map((p) => [Math.round(p.t), p.lat, p.lon, Math.round(p.altM)]);
    }
    return out;
  }
}
