/**
 * The live vessel feed — Phase 5.
 *
 * 🔴 **The gate for this phase is that live and replay reach the screen through the same render
 * path**, and the way that is achieved is deliberately blunt: this module produces exactly the
 * buffer layout the replay asset decodes into — `position`, `aTime`, `aSpeed` — and the scene
 * hands those buffers to *the same material instances* the recorded day uses. Not an equivalent
 * shader; the same compiled program, the same uniforms.
 *
 * So everything the renderer learned in Phases 3 and 4 applies to live traffic for free: speed
 * colouring, the trail window, and — the one that matters — Mode D, which asks the coverage field
 * whether a vessel is inside a notional site's modelled view. That question is far more
 * interesting asked of a ship that is out there now than of one that sailed a month ago.
 *
 * The transport is `EventSource`. It reconnects on its own, which is most of what a live feed
 * needs, and the traffic is strictly one-way.
 *
 * **No relay, no live mode.** The deployed app is static hosting and cannot open a socket to
 * aisstream.io — which forbids browser connections anyway. When no relay answers, the app stays in
 * replay and says so. That is a first-class path, not an error state.
 */

export interface LiveVessel {
  id: string;
  class: string;
  lengthM: number | null;
  /** [lat, lon, epochMs, knots] */
  points: [number, number, number, number][];
  /**
   * Identity as the vessel transmitted it, when the relay runs in an identified mode.
   *
   * ⚠️ Optional twice over: the relay may be set to `commercial` or `anonymous`, and even in
   * `full` a vessel has no name until its first static report arrives — which is every few
   * minutes, against a position every few seconds. Absent means "not received", never "none".
   */
  mmsi?: string;
  name?: string;
  callSign?: string;
  imo?: string;
  destination?: string;
  draughtM?: number;
  beamM?: number;
}

export interface LiveStatus {
  mode: "replay" | "live";
  upstream: string;
  /** Who the data came from, as opposed to whether the socket is up. Used for attribution. */
  source?: string;
  vessels: number;
  aoi: string;
  messages: number;
  accepted: number;
  privacy: string;
  /**
   * Has the upstream ever delivered a usable message on this connection?
   *
   * 🔴 The difference between "no ships here" and "nothing has been said about anywhere". A relay
   * whose socket is open and whose subscription was accepted can still receive nothing at all;
   * reporting that as a vessel count is a claim about the water made by a feed that has not
   * spoken. Same rule as the coverage field's three states.
   *
   * ⚠️ **Optional on purpose.** A deployed app and a deployed relay do not update in the same
   * instant, and an older relay sends neither this nor `silentForMs`. An absent field is not
   * evidence of silence — reading it as such would break live mode for everyone mid-rollout.
   */
  everReceived?: boolean;
  /** Milliseconds since the last usable upstream message. Optional for the same reason. */
  silentForMs?: number;
  /** True when the relay is serving the recorded day because the live source went mute. */
  fallback?: boolean;
}

export type LiveState = "idle" | "connecting" | "open" | "unavailable";

export interface LiveBuffers {
  /** Scene metres, +x east, +z south — the convention every other asset uses. */
  x: Float32Array;
  z: Float32Array;
  /** Seconds, on the same wall clock the scene's `uNow` runs on in live mode. */
  t: Float32Array;
  speed: Float32Array;
  /** Index pairs for the trail line segments, built per vessel so no two are ever joined. */
  segments: number[];
  /**
   * One index per vessel, pointing at its newest report.
   *
   * The marker layer draws these and nothing else. Drawing a point per *report* put a dot every
   * few seconds along the whole tail, which reads as a queue of ships rather than one ship with a
   * history.
   */
  heads: number[];
  count: number;
  vessels: number;
  /**
   * Vessels the relay sent that are outside the modelled water.
   *
   * Counted rather than silently discarded: the relay subscribes to the coarse shell box, so most
   * of what arrives is legitimately elsewhere, and a panel that shows 12 while the relay says 380
   * looks broken unless the difference is named.
   */
  outside: number;
}

/**
 * How much history one vessel may draw behind it, in metres of ground track.
 *
 * 🔴 **A LENGTH, not a report count** — and that distinction is the whole point. Capping by count
 * looks equivalent and is not: reports arrive every few seconds regardless of speed, so a fixed
 * count is a few metres for a moored boat and kilometres for a ferry. Measured on the real feed, a
 * 24-report tail reached **17.7 km on an 18 km AOI** — one ship drew a line across the entire map.
 *
 * 1200 m is measured, not chosen: steps on the real feed run p50 **94 m**, p90 **675 m**, p99
 * 2.2 km, so this holds roughly the last dozen reports of a moving vessel — enough to read where
 * it is heading, short enough that a dozen ferries do not fill the fjord with lines.
 */
export const LIVE_TRAIL_M = 1_200;

/**
 * A hard vertex ceiling per vessel, so a stationary ship cannot hoard the budget.
 *
 * A moored vessel transmits all day within a few metres, so the length cap never bites and it
 * would otherwise accumulate hundreds of coincident vertices that draw nothing.
 */
export const LIVE_TRAIL_MAX_POINTS = 64;

/**
 * The longest jump between consecutive reports that can still be one continuous track, in metres.
 *
 * ⚠️ Generous on purpose. At 40 kn a three-minute AIS gap is legitimately 3.7 km, and a guard that
 * erased that would quietly delete real traffic — the failure would look like clean data. What it
 * is for is the *impossible* step: a replay wrap, a re-entry after an absence, or a bad fix, where
 * joining the two would draw a line the vessel never sailed.
 *
 * 3000 m was measured against the real feed rather than picked: it refuses **0.59 %** of observed
 * steps. That figure is the justification — a threshold nobody has counted the cost of is a
 * threshold that deletes traffic silently.
 */
export const LIVE_MAX_STEP_M = 3_000;

/**
 * How much bigger a live vessel marker is drawn than a recorded one.
 *
 * 🔴 Not decoration. The head shader has a `+ 3.0` pixel floor, and the default camera sits about
 * 9 km back, so at rest every vessel is a 3 px dot — the user's report was that live traffic was
 * there but impossible to find. The recorded day is watched from close in, live traffic is watched
 * from wherever the camera happens to be, so the two need different marker sizes even though they
 * deliberately share a shader.
 */
export const LIVE_HEAD_SCALE = 3.4;

/** Capacity. The busiest hour Phase 3 measured had 53 vessels; this is generous headroom. */
const MAX_VESSELS = 400;
const MAX_POINTS_PER_VESSEL = 400;
export const LIVE_CAPACITY = MAX_VESSELS * MAX_POINTS_PER_VESSEL;

export interface GeoFrame {
  /** Centre of the scene in WGS84 — the origin the buffers are relative to. */
  centreLat: number;
  centreLon: number;
}

/**
 * Degrees → scene metres.
 *
 * A local tangent-plane approximation, calibrated at the AOI's own latitude. Over 11 × 18 km it
 * differs from the full UTM projection the offline builder uses by a few metres — well inside the
 * 16 m cell the coverage field is stored on, and the same approximation the horizon shell already
 * makes. Stated rather than hidden.
 */
export function projector(frame: GeoFrame) {
  const metresPerDegLat = 111_132.92 - 559.82 * Math.cos((2 * frame.centreLat * Math.PI) / 180);
  const metresPerDegLon = 111_412.84 * Math.cos((frame.centreLat * Math.PI) / 180);
  return (lat: number, lon: number) => ({
    // +z is south, so a latitude above the centre is a negative z.
    x: (lon - frame.centreLon) * metresPerDegLon,
    z: (frame.centreLat - lat) * metresPerDegLat,
  });
}

/** The modelled water, in WGS84 degrees. Vessels outside it are counted, not drawn. */
export interface LiveBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export interface FillOptions {
  bounds?: LiveBounds | null;
}

/**
 * Fold the relay's vessel list into the render buffers.
 *
 * Walks each vessel's history **backwards from its newest report**, which is what makes the two
 * caps meaningful: the tail is the most recent `LIVE_TRAIL_M` metres of track, not the oldest
 * reports that happen to still be in memory. Vertices are then written oldest-first so the drawn
 * line leads up to the ship rather than away from it.
 */
export function fill(
  vessels: Map<string, LiveVessel>,
  frame: GeoFrame,
  buffers: LiveBuffers,
  options: FillOptions = {},
): LiveBuffers {
  const project = projector(frame);
  const bounds = options.bounds ?? null;
  let cursor = 0;
  let drawn = 0;
  let outside = 0;
  // 🔴 Reset every fill. Leaving these to accumulate meant a feed that went quiet kept the last
  // picture on screen forever — the app would show yesterday's ships as if they were here now.
  buffers.segments.length = 0;
  buffers.heads.length = 0;

  for (const vessel of vessels.values()) {
    const points = vessel.points;
    if (!points.length) continue;

    // ⚠️ Judged on the CURRENT position, not on any point in the history. An inbound vessel spends
    // its first reports outside the area; excluding it for that would make ships pop into
    // existence at the boundary instead of steaming in.
    const newest = points[points.length - 1];
    if (bounds && !within(newest[0], newest[1], bounds)) {
      outside += 1;
      continue;
    }

    // Collect the tail backwards from the newest report, stopping at whichever limit bites first.
    const tail: [number, number, number, number][] = [newest];
    let metres = 0;
    let previous = project(newest[0], newest[1]);
    for (let i = points.length - 2; i >= 0; i -= 1) {
      if (tail.length >= LIVE_TRAIL_MAX_POINTS) break;
      const here = project(points[i][0], points[i][1]);
      const step = Math.hypot(here.x - previous.x, here.z - previous.z);
      // The unexplainable jump ends the track here rather than drawing a line across it.
      if (step > LIVE_MAX_STEP_M) break;
      if (metres + step > LIVE_TRAIL_M) break;
      metres += step;
      tail.push(points[i]);
      previous = here;
    }
    tail.reverse();

    if (cursor + tail.length > LIVE_CAPACITY) break;
    const start = cursor;
    for (const [lat, lon, epochMs, knots] of tail) {
      const { x, z } = project(lat, lon);
      buffers.x[cursor] = x;
      buffers.z[cursor] = z;
      buffers.t[cursor] = epochMs / 1000;
      buffers.speed[cursor] = knots;
      cursor += 1;
    }
    for (let k = 0; k < tail.length - 1; k += 1) {
      buffers.segments.push(start + k, start + k + 1);
    }
    // The newest report is the last vertex written, so the marker sits where the ship is now.
    buffers.heads.push(cursor - 1);
    drawn += 1;
  }

  buffers.count = cursor;
  buffers.vessels = drawn;
  buffers.outside = outside;
  return buffers;
}

function within(lat: number, lon: number, bounds: LiveBounds): boolean {
  return lon >= bounds.west && lon <= bounds.east
    && lat >= bounds.south && lat <= bounds.north;
}

export function createBuffers(): LiveBuffers {
  return {
    x: new Float32Array(LIVE_CAPACITY),
    z: new Float32Array(LIVE_CAPACITY),
    t: new Float32Array(LIVE_CAPACITY),
    speed: new Float32Array(LIVE_CAPACITY),
    segments: [],
    heads: [],
    count: 0,
    vessels: 0,
    outside: 0,
  };
}

export interface LiveSource {
  state(): LiveState;
  status(): LiveStatus | null;
  vessels(): Map<string, LiveVessel>;
  close(): void;
}

/**
 * Connect to the relay and keep a vessel map current.
 *
 * The relay sends a snapshot on connect and deltas thereafter, so a client that joins mid-stream
 * sees the whole picture immediately rather than watching it slowly accumulate.
 */
export function connectLive(
  baseUrl: string,
  onChange: (vessels: Map<string, LiveVessel>, status: LiveStatus | null) => void,
): LiveSource {
  const vessels = new Map<string, LiveVessel>();
  let status: LiveStatus | null = null;
  let state: LiveState = "connecting";
  let source: EventSource | null = null;

  try {
    source = new EventSource(`${baseUrl.replace(/\/$/, "")}/ais/stream`);
  } catch {
    state = "unavailable";
    return {
      state: () => state, status: () => null, vessels: () => vessels, close: () => {},
    };
  }

  source.addEventListener("open", () => {
    state = "open";
    onChange(vessels, status);
  });

  source.addEventListener("status", (event) => {
    try {
      status = JSON.parse((event as MessageEvent).data);
      onChange(vessels, status);
    } catch { /* a malformed status frame is not worth tearing the stream down for */ }
  });

  source.addEventListener("vessels", (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data);
      if (payload.type === "snapshot") vessels.clear();
      for (const vessel of payload.vessels as LiveVessel[]) {
        const existing = vessels.get(vessel.id);
        if (!existing || payload.type === "snapshot") {
          vessels.set(vessel.id, vessel);
        } else {
          existing.class = vessel.class;
          existing.lengthM = vessel.lengthM ?? existing.lengthM;
          existing.points.push(...vessel.points);
          if (existing.points.length > MAX_POINTS_PER_VESSEL) {
            existing.points.splice(0, existing.points.length - MAX_POINTS_PER_VESSEL);
          }
        }
      }
      state = "open";
      onChange(vessels, status);
    } catch { /* likewise */ }
  });

  source.addEventListener("error", () => {
    // EventSource retries by itself; this only reflects that in the UI. It is reported as
    // "unavailable" rather than as a failure, because no relay running is the normal case for a
    // static deployment and the app has a perfectly good fallback.
    if (state !== "open") state = "unavailable";
    onChange(vessels, status);
  });

  return {
    state: () => state,
    status: () => status,
    vessels: () => vessels,
    close: () => {
      source?.close();
      state = "idle";
    },
  };
}
