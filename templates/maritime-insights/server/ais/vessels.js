/**
 * Shared vessel state for the live feed.
 *
 * Held once in the relay rather than once per viewer: the trail memory is bounded a single time,
 * a second viewer costs nothing, and every client sees the identical picture. The alpine sibling
 * makes the same argument for the same reason.
 *
 * The state is deliberately the *same shape* the replay asset decodes into — position, time,
 * speed, class — because the whole point of this phase is that live and replay reach the renderer
 * through one path. If the two shapes ever drift, the render path silently forks.
 */

/** Reports older than this are forgotten: a vessel that stopped transmitting has left the picture. */
const TRAIL_MS = 30 * 60 * 1000;

/** Positions kept per vessel. At a 2–10 s report rate this is comfortably the whole trail window. */
const MAX_POINTS = 400;

/** A vessel silent for this long is dropped entirely rather than left as a stale dot. */
const STALE_MS = 12 * 60 * 1000;

/** A vessel in the shape the browser reads. Identity keys are omitted when absent, never blanked. */
function wire(vessel, points = vessel.points) {
  const out = {
    id: vessel.id,
    class: vessel.class,
    lengthM: vessel.lengthM,
    points: points.map((p) => [
      Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5)), p.t, Number(p.speedKn.toFixed(1)),
    ]),
  };
  for (const key of ["mmsi", "name", "callSign", "imo", "destination", "draughtM", "beamM"]) {
    if (vessel[key] != null) out[key] = vessel[key];
  }
  return out;
}

export class Vessels {
  /**
   * @param {{west:number,south:number,east:number,north:number}} bbox area worth keeping
   */
  constructor(bbox) {
    this.bbox = bbox;
    this.vessels = new Map();
    this.stats = { accepted: 0, outOfArea: 0, dropped: 0 };
  }

  inArea(lat, lon) {
    return lat >= this.bbox.south && lat <= this.bbox.north
      && lon >= this.bbox.west && lon <= this.bbox.east;
  }

  /**
   * Fold one already-sanitised report into the state.
   *
   * @returns true if it was kept. A false here is not an error: most of the world's AIS is
   * somewhere else, and Phase 3 measured that only 0.22 % of a national feed survives this filter.
   */
  add(report) {
    if (!this.inArea(report.lat, report.lon)) {
      this.stats.outOfArea += 1;
      return false;
    }

    let vessel = this.vessels.get(report.id);
    if (!vessel) {
      vessel = { id: report.id, class: report.class, lengthM: report.lengthM, points: [] };
      this.vessels.set(report.id, vessel);
    }
    // Class arrives in a separate static message that may come after the first position, so it is
    // upgraded when it turns up rather than fixed at creation.
    if (vessel.class === "Undefined" && report.class !== "Undefined") vessel.class = report.class;
    if (vessel.lengthM == null && report.lengthM != null) vessel.lengthM = report.lengthM;
    // ⚠️ Same reasoning for identity, and it matters more: the static report carrying the name
    // arrives every few minutes against a position every few seconds, so a vessel is very often
    // tracked for a while before it is named. Filled in when it turns up, never cleared — a later
    // position report without static data must not erase a name we already have.
    for (const key of ["mmsi", "name", "callSign", "imo", "destination", "draughtM", "beamM"]) {
      if (vessel[key] == null && report[key] != null) vessel[key] = report[key];
    }

    const last = vessel.points[vessel.points.length - 1];
    // Duplicate reports of the same second are common and add nothing but buffer churn.
    if (last && Math.abs(last.t - report.timeMs) < 900) {
      last.lat = report.lat;
      last.lon = report.lon;
      last.speedKn = report.speedKn;
      return true;
    }

    vessel.points.push({
      lat: report.lat, lon: report.lon, t: report.timeMs, speedKn: report.speedKn,
    });
    if (vessel.points.length > MAX_POINTS) vessel.points.shift();
    vessel.lastSeen = report.timeMs;
    this.stats.accepted += 1;
    return true;
  }

  /** Forget stale vessels and trail points that have aged out of the window. */
  prune(nowMs = Date.now()) {
    for (const [id, vessel] of this.vessels) {
      const cutoff = nowMs - TRAIL_MS;
      while (vessel.points.length && vessel.points[0].t < cutoff) vessel.points.shift();
      if (!vessel.points.length || (nowMs - (vessel.lastSeen ?? 0)) > STALE_MS) {
        this.vessels.delete(id);
        this.stats.dropped += 1;
      }
    }
  }

  /** The whole picture, for a client that has just connected. */
  snapshot() {
    return {
      type: "snapshot",
      nowMs: Date.now(),
      vessels: [...this.vessels.values()].map((vessel) => wire(vessel)),
    };
  }

  /** Just what changed, for a client that already has the picture. */
  delta(ids) {
    const vessels = [];
    for (const id of ids) {
      const vessel = this.vessels.get(id);
      if (!vessel) continue;
      const p = vessel.points[vessel.points.length - 1];
      if (!p) continue;
      vessels.push(wire(vessel, [p]));
    }
    return { type: "delta", nowMs: Date.now(), vessels };
  }

  get size() {
    return this.vessels.size;
  }
}
