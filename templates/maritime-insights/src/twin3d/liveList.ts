import type { LiveStatus, LiveVessel } from "./liveSource";

/** One live vessel, reduced to what a list row needs. */
export interface LiveListEntry {
  id: string;
  class: string;
  lengthM: number | null;
  /** Identity as transmitted, when the relay is running in an identified mode. */
  mmsi?: string;
  name?: string;
  callSign?: string;
  destination?: string;
  lat: number;
  lon: number;
  knots: number;
  /** Epoch milliseconds of the most recent report. */
  atMs: number;
  /** Age of that report at the moment the list was built. */
  ageMs: number;
  /** Reports held for this vessel in the current window. */
  reports: number;
}

/**
 * How long a vessel stays in the list after its last report.
 *
 * 🔴 **Without this the list is a lie.** The client's vessel map only ever grows: `connectLive`
 * adds a vessel on first sight and nothing removes it, because the map's other consumer draws
 * *trails*, where keeping the whole track is exactly right. A list headed "live ships" is a
 * different promise — every row claims the vessel is out there now. Measured against the running
 * relay: twenty seconds after connecting the map held 33 vessels while the relay reported 6
 * present. The other 27 were ships that had passed through and left.
 *
 * Five minutes is set by the transmitters, not by taste. AIS Class A sends every 2–10 s under way
 * and up to every 3 min at anchor; Class B every 30 s to 3 min. Five minutes therefore clears a
 * vessel that has genuinely stopped reporting while never dropping a moored one that is simply
 * quiet — the failure that would matter, since a ship at a berth is still a ship.
 */
export const LIVE_STALE_MS = 5 * 60 * 1000;

/** The modelled area, in WGS84 degrees. */
export interface LiveBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LiveSummary {
  /** Vessels inside the modelled area, freshest report first among those under way. */
  entries: LiveListEntry[];
  /** Vessels currently reporting from outside it. */
  outsideCount: number;
}

/**
 * Is this position inside the modelled area?
 *
 * 🔴 **The list has to be scoped to the model, not to the feed.** The relay subscribes to the
 * *shell* bounding box — roughly 2.8° by 1.4° of the western Baltic — because the horizon tier is
 * drawn that wide. Measured against the running relay, that is ~300 vessels, while the modelled
 * water holds a handful. A row that cannot be flown to is worse than no row: every one of them
 * answers a click with "outside the model", and three hundred of them bury the ships that are
 * actually in the scene.
 */
export function withinBounds(lat: number, lon: number, bounds: LiveBounds): boolean {
  return lon >= bounds.west && lon <= bounds.east
    && lat >= bounds.south && lat <= bounds.north;
}

/**
 * Turn the live feed's map into a stable, ordered list.
 *
 * Vessels whose last report is older than `maxAgeMs` are left out: see `LIVE_STALE_MS`.
 *
 * 🔴 **Order is by speed, then by recency — never by the id.** The id is a *salted per-session
 * pseudonym*: it is deliberately meaningless and it changes every time the relay restarts.
 * Sorting by it would produce an order that looks stable, is arbitrary, and silently reshuffles
 * on reconnect. Under way first is also the useful order: a moving ship is the one worth looking
 * at, and the moored ones sink to the bottom on their own.
 *
 * ⚠️ Ties are broken by id purely so the sort is **total**. Without that last comparison two
 * vessels reporting the same speed at the same second can swap places between frames, and a list
 * that reorders under the pointer is unusable.
 */
export function summariseLiveVessels(
  vessels: Map<string, LiveVessel>,
  nowMs: number = Date.now(),
  bounds: LiveBounds | null = null,
  maxAgeMs: number = LIVE_STALE_MS,
): LiveSummary {
  const out: LiveListEntry[] = [];
  let outsideCount = 0;
  for (const vessel of vessels.values()) {
    const points = vessel.points;
    if (!points.length) continue;
    // The feed appends, so the freshest report is the last one — but it is not worth trusting
    // that: a relay that ever reorders would put the vessel in the wrong place with no symptom.
    let latest = points[0];
    for (const point of points) if (point[2] > latest[2]) latest = point;
    // A clock skew that puts a report in the future is not a reason to hide a vessel, so the age
    // is floored at zero rather than compared signed.
    const ageMs = Math.max(0, nowMs - latest[2]);
    if (ageMs > maxAgeMs) continue;
    // Counted before it is dropped: "12 weitere außerhalb" is the difference between a list that
    // looks broken and one that explains its own scope.
    if (bounds && !withinBounds(latest[0], latest[1], bounds)) {
      outsideCount += 1;
      continue;
    }
    out.push({
      id: vessel.id,
      class: vessel.class,
      lengthM: vessel.lengthM,
      // Spread rather than assign, so an anonymised relay leaves these undefined instead of
      // producing empty strings a row would have to tell apart from "not transmitted".
      ...(vessel.mmsi ? { mmsi: vessel.mmsi } : {}),
      ...(vessel.name ? { name: vessel.name } : {}),
      ...(vessel.callSign ? { callSign: vessel.callSign } : {}),
      ...(vessel.destination ? { destination: vessel.destination } : {}),
      lat: latest[0],
      lon: latest[1],
      atMs: latest[2],
      ageMs,
      knots: latest[3],
      reports: points.length,
    });
  }
  out.sort((a, b) =>
    b.knots - a.knots || b.atMs - a.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { entries: out, outsideCount };
}

/** Under way, by the same 0.5 kn rule the rest of the app uses to call a vessel stationary. */
export function isUnderWay(entry: LiveListEntry): boolean {
  return entry.knots >= 0.5;
}

/**
 * How old a row's position is, in words.
 *
 * ⚠️ Shown on every row on purpose. A live list invites the reader to believe the marker is where
 * the ship *is*; it is only where the ship last *said* it was. At 15 kn a report two minutes old
 * is already about a kilometre out of date, which is the difference between inside and outside a
 * sensor's coverage — the very thing this app is used to judge.
 */
export function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 10) return "gerade eben";
  if (seconds < 90) return `vor ${seconds} s`;
  return `vor ${Math.round(seconds / 60)} min`;
}

/**
 * A public AIS map, centred on where this app last saw the vessel.
 *
 * ⚠️ **Positional, not per-vessel.** Use this when the feed carries no MMSI — an anonymised relay,
 * or a vessel that has not yet sent a static report. It opens the same water at the same moment
 * and lets the reader identify what is there on a service that holds identity.
 *
 * Zoom 13 is about a kilometre across the screen — close enough that one vessel is unambiguous,
 * wide enough to still contain it if it has moved during the seconds since the last report.
 */
export function verificationUrl(lat: number, lon: number, zoom = 13): string {
  const centre = `centerx:${lon.toFixed(5)}/centery:${lat.toFixed(5)}/zoom:${zoom}`;
  return `https://www.marinetraffic.com/en/ais/home/${centre}`;
}

/**
 * The vessel itself on a public AIS service, addressed by MMSI.
 *
 * 🔴 This is the link the app could not previously offer, and the reason was never technical: the
 * MMSI was discarded at ingest, so there was no key to look anything up with. Every public AIS
 * service addresses a vessel by MMSI, so keeping it is what makes an independent check of *this
 * ship* — rather than of this patch of water — possible at all.
 *
 * ⚠️ **VesselFinder, not MarineTraffic, and that was measured rather than preferred.** The
 * MarineTraffic search endpoint this used to call now answers **404** for every query — verified
 * in a browser on 2026-08-10 for both `?keyword=` and `?mmsi=`, so every per-vessel link the app
 * had shipped was dead. `vesselfinder.com/vessels/details/<mmsi>` returns the vessel page (200,
 * checked against MMSI 211476060). MarineTraffic's *area* view still works and is still what
 * `verificationUrl` uses; it is only the search that went.
 */
export function vesselUrl(mmsi: string): string {
  return `https://www.vesselfinder.com/vessels/details/${encodeURIComponent(mmsi)}`;
}

/**
 * The best available external check: the ship when it is identified, the place when it is not.
 *
 * 🔴 `synthetic` exists for the recorded-day fallback, which emits invented MMSIs (900000000 + n).
 * Handing one to a public service produces a confident lookup for a ship that does not exist, and
 * a verification link that fails is worse than no link at all — it withdraws the offer the panel
 * is making. The *place* is real even when the identity is not, so the fallback still gets a map.
 */
export function checkUrl(entry: LiveListEntry, synthetic = false): string {
  if (synthetic || !entry.mmsi) return verificationUrl(entry.lat, entry.lon);
  return vesselUrl(entry.mmsi);
}

/**
 * What the live bar should say, and whether it should worry.
 *
 * 🔴 **The defect this exists for: the bar read "0 Schiffe" while the upstream had said nothing at
 * all.** Measured on the deployed relay — socket open, subscription accepted, `messages: 0` after
 * ten minutes. The subscribed box is the whole western Baltic, where traffic never stops, so zero
 * was not merely unhelpful, it was false. This is the same rule the coverage field already obeys
 * in three states: *we did not observe this* must never render as *there is nothing there*.
 *
 * The count passed in is the app's own figure for the modelled water, **not** `status.vessels` —
 * the relay counts its whole coarse shell box, which is several hundred vessels wide.
 */
export type LiveFeedKind = "live" | "quiet" | "silent" | "down" | "replay" | "fallback";

export interface LiveFeed {
  kind: LiveFeedKind;
  headline: string;
  detail: string;
  /** Whether the bar should draw attention to itself. */
  warn: boolean;
}

export function describeLiveFeed(status: LiveStatus | null, vesselsInArea: number): LiveFeed {
  if (!status) {
    return {
      kind: "down",
      headline: "Live-Feed nicht verbunden",
      detail: "Es liegt noch kein Status vom Relay vor; über das Modellgebiet sagt das nichts aus.",
      warn: true,
    };
  }

  // ⚠️ Checked before anything else. The stand-in puts real ships on screen, so reporting "the
  // source is not sending" over a moving picture would be its own kind of wrong — and a silent
  // upstream is exactly the condition that turns the fallback on.
  if (status.fallback) {
    return {
      kind: "fallback",
      headline: `${vesselsInArea} Schiffe (Aufzeichnung)`,
      detail: "Die Live-Quelle sendet derzeit nicht; das Relay hat automatisch umgeschaltet und "
        + "zeigt den aufgezeichneten Tag. Das sind keine Echtzeitdaten.",
      warn: true,
    };
  }

  if (status.mode === "replay") {
    return {
      kind: "replay",
      headline: `${vesselsInArea} Schiffe (Wiedergabe)`,
      detail: "Das Relay läuft im Wiedergabemodus und zeigt einen aufgezeichneten Tag, "
        + "keine Echtzeitdaten.",
      warn: true,
    };
  }

  if (status.upstream === "down") {
    return {
      kind: "down",
      headline: "Live-Quelle nicht verbunden",
      detail: "Das Relay hat keine Verbindung zur AIS-Quelle. Über das Modellgebiet sagt das "
        + "nichts aus — es ist keine Aussage über den Verkehr, sondern über die Verbindung.",
      warn: true,
    };
  }

  // 🔴 The heart of it. A feed that has never delivered a message, or has gone mute, cannot be
  // quoted as a ship count — no matter how confidently the socket reports itself connected.
  //
  // ⚠️ `everReceived === false` is required, not merely falsy: an older relay omits the field
  // entirely, and the absence of evidence is not evidence of silence. Treating `undefined` as
  // "never received" would put every client into a permanent fault state mid-rollout.
  const mute = status.everReceived === false || status.upstream === "silent";
  if (mute) {
    const since = status.silentForMs != null && status.silentForMs >= 60_000
      ? ` seit ${formatSilence(status.silentForMs)}`
      : "";
    return {
      kind: "silent",
      headline: `Live-Quelle sendet nicht${since}`,
      detail: "Das ist eine Störung der Quelle, keine Aussage über das Modellgebiet: das "
        + "abonnierte Gebiet umfasst die westliche Ostsee, in der immer Verkehr liegt. "
        + "„0 Schiffe“ wäre hier die falsche Antwort.",
      warn: true,
    };
  }

  if (vesselsInArea === 0) {
    // Earned: the source is demonstrably sending, so this really is a statement about the water.
    return {
      kind: "quiet",
      headline: "Keine Schiffe im Modellgebiet",
      detail: "Die Quelle sendet; im modellierten Wasser liegt derzeit kein Schiff. "
        + "Außerhalb des Modellgebiets kann trotzdem Verkehr sein.",
      warn: false,
    };
  }

  return {
    kind: "live",
    headline: `${vesselsInArea} Schiffe`,
    detail: "Live-Positionen aus dem Modellgebiet.",
    warn: false,
  };
}

/**
 * How long the source has been mute, in the coarsest unit that is still honest.
 *
 * Rounded down to the unit rather than up: claiming "3 h" after 2 h 50 min overstates the outage,
 * and this figure ends up in a sentence someone may repeat.
 */
export function formatSilence(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "unter einer Minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/**
 * Does this feed state carry invented identities?
 *
 * Both the replay mode and the automatic fallback synthesise MMSIs, and an external lookup for one
 * of those is a link that cannot resolve. Callers use this to fall back to the positional link.
 */
export function hasSyntheticIdentity(status: LiveStatus | null): boolean {
  if (!status) return false;
  return Boolean(status.fallback) || status.mode === "replay";
}
