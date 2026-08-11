/**
 * Client for the OGN relay — PLAN §7 phase 4, Mode C.
 *
 * Talks to `server/ogn/relay.js` over Server-Sent Events. Everything sensitive has already been
 * decided upstream: aircraft whose pilots opted out never appear in this stream, and anonymous
 * ones arrive under a rotating hash rather than their hardware address. This module therefore has
 * no privacy logic of its own, which is the point — there is nothing here to get wrong.
 *
 * The relay is **optional infrastructure**. The deployed app is static hosting and cannot run a
 * socket client, so in most situations — including, quite likely, a demo — no relay is reachable.
 * That is not an error state: decision 15 makes the fall back to replay a first-class path, so
 * this module's job when it cannot connect is to say so quickly and clearly rather than to retry
 * forever in silence.
 */

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'unavailable' | 'wrong-area';

/** One aircraft, exactly as the relay is willing to describe it. */
export interface LiveAircraft {
  /** Either a real device id, or `anon-…` for a pilot who has not consented to being identified. */
  id: string;
  /** OGN aircraft type: `paraglider`, `hangglider`, `glider`, `jet`, … */
  type: string;
  lat: number;
  lon: number;
  /** Metres above sea level. */
  altM: number;
  /** Metres per second, positive up. Reported by the instrument, not derived here. */
  climbMs: number | null;
  groundMs: number | null;
  courseDeg: number | null;
  /** Unix seconds of the last fix. */
  t: number;
  registration: string | null;
  model: string | null;
  cn: string | null;
  /** `[t, lat, lon, altM]` per point, oldest first, covering the last 20 minutes. */
  trail: [number, number, number, number][];
}

/** The types this app is actually about. Airliners are traffic, not free flight. */
export const FREE_FLIGHT_TYPES = new Set(['paraglider', 'hangglider', 'glider']);

export interface LiveTrafficHandle {
  close(): void;
}

interface Handlers {
  /** The AOI the browser is showing, so traffic from a relay watching a different one is refused. */
  aoiId: string;
  /**
   * The world that AOI belongs to, if any — PLAN §8.
   *
   * A relay serving a whole world announces the WORLD's id, not a site's, because its filter spans
   * every site in it. Without this the guard would refuse the correct relay the moment the camera
   * flew to the second site.
   */
  worldId?: string | null;
  onStatus(status: LiveStatus): void;
  /** Called at the relay's broadcast rate — about once a second — with the full current list. */
  onTraffic(aircraft: LiveAircraft[]): void;
}

interface WireAircraft extends Omit<LiveAircraft, 'trail'> {
  trail?: [number, number, number, number][];
}

/**
 * Connect, and keep a live picture of what is flying.
 *
 * The relay sends a `snapshot` on connect and `update` deltas thereafter, so a viewer who arrives
 * at four o'clock immediately sees the gliders that took off at twenty to, trails and all, instead
 * of an empty sky that fills in over the next twenty minutes.
 */
export function connectLiveTraffic(url: string, handlers: Handlers): LiveTrafficHandle {
  const aircraft = new Map<string, LiveAircraft>();
  let closed = false;
  let everConnected = false;
  let failures = 0;
  let wrongArea = false;

  handlers.onStatus('connecting');
  const source = new EventSource(url);

  const emit = () => handlers.onTraffic([...aircraft.values()]);

  /**
   * Refuse a relay that is watching a different mountain.
   *
   * ⚠️ The relay takes its own area on the command line and has no idea which site the browser is
   * showing. Nothing about the failure looks like one: the aircraft are real, the positions are
   * correctly decoded, the trails move — they are simply 35 km away, so the renderer clamps them
   * onto the edge of the terrain and the viewer sees live traffic over the wrong valley. Silence is
   * the only honest response, because a plausible wrong answer is the worst outcome this app has.
   *
   * Two ids are therefore acceptable: **this site**, from a relay started for one site, and **this
   * site's world**, from a relay whose filter spans every site in it. The second is what the hosted
   * relay uses, because the browser's active site changes as the camera flies and a relay cannot
   * follow it.
   */
  source.addEventListener('status', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as { area?: { id?: string } };
    const relayArea = payload.area?.id;
    // An older relay that does not announce its area gets the benefit of the doubt; a relay that
    // announces a different one does not.
    if (!relayArea || relayArea === handlers.aoiId || relayArea === handlers.worldId) return;

    wrongArea = true;
    aircraft.clear();
    emit();
    handlers.onStatus('wrong-area');
    source.close();
  });

  const adopt = (wire: WireAircraft) => {
    const existing = aircraft.get(wire.id);
    // Updates carry no trail — the client already has the history and appends to it. Re-sending
    // twenty minutes of points for every aircraft every second would be nearly all of the
    // bandwidth and none of the news.
    const trail = wire.trail ?? existing?.trail ?? [];
    if (!wire.trail) trail.push([wire.t, wire.lat, wire.lon, wire.altM]);
    aircraft.set(wire.id, { ...wire, trail });
  };

  source.addEventListener('snapshot', (event) => {
    if (wrongArea) return;
    const payload = JSON.parse((event as MessageEvent).data) as { aircraft: WireAircraft[] };
    aircraft.clear();
    for (const wire of payload.aircraft) adopt(wire);
    everConnected = true;
    failures = 0;
    handlers.onStatus('live');
    emit();
  });

  source.addEventListener('update', (event) => {
    if (wrongArea) return;
    const payload = JSON.parse((event as MessageEvent).data) as {
      aircraft: WireAircraft[];
      removed: string[];
    };
    for (const wire of payload.aircraft) adopt(wire);
    for (const id of payload.removed) aircraft.delete(id);
    emit();
  });

  source.addEventListener('error', () => {
    if (closed || wrongArea) return;
    failures += 1;
    handlers.onStatus('unavailable');

    // EventSource retries on its own, indefinitely and silently. That is right for a relay that
    // exists and is restarting, and wrong for one that was never there: on static hosting there is
    // no relay at all, and the default behaviour is a 404 every few seconds for as long as the tab
    // is open. So a connection that has never once succeeded is given two attempts and then
    // dropped, while a connection that has worked before is left to recover on its own.
    if (!everConnected && failures >= 2) source.close();
  });

  return {
    close() {
      closed = true;
      source.close();
      handlers.onStatus('idle');
    },
  };
}
