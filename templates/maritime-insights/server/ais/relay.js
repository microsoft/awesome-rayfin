/**
 * The live AIS relay — PLAN §8, Phase 5.
 *
 * 🔴 **A relay is mandatory here, not a design preference.** aisstream.io explicitly does not
 * support cross-origin connections from a browser, and says why: an API key put into a web page is
 * an API key published to the internet. Their stated pattern is to consume the socket on a backend
 * and deliver the data to clients over a connection you control. That is exactly what this is.
 *
 * Once something sits in the middle it is also the only correct place to enforce the privacy rules
 * (§3.2 rule 4) and to hold the shared trail state — so it does both. The relay is the only process
 * that ever sees an MMSI.
 *
 * **SSE rather than WebSocket downstream.** The traffic is strictly one-way, `EventSource`
 * reconnects on its own without a line of code, it survives proxies that mangle upgrades, and it
 * needs no dependency. A WebSocket would buy a back-channel the app has no use for. Upstream is a
 * WebSocket because aisstream.io only speaks one — using Node's built-in client, so this whole
 * relay runs on the standard library.
 *
 * Deliberately **not** part of the Vite build: the deployed app is static hosting, which cannot
 * hold a socket open. If no relay is reachable the app stays in replay and says so — a first-class
 * path, not an error.
 *
 * Usage
 *   AISSTREAM_KEY=... node server/ais/relay.js
 *   node server/ais/relay.js --port 8788 --aoi kieler-foerde
 *   node server/ais/relay.js --replay public/terrain/kieler-foerde   # no key needed
 *   node server/ais/relay.js --spool data/live                       # NDJSON for the RTI uploader
 */

import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSalt, IDENTITY_MODES, leaksIdentity, sanitise } from "./privacy.js";
import { Vessels } from "./vessels.js";
import { advanceReplay, REPLAY_TICK_MS, startReplayState } from "./replayClock.js";
import { nextSilenceBackoffMs, shouldStandIn, silenceSince, upstreamState } from "./upstreamState.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const UPSTREAM = "wss://stream.aisstream.io/v0/stream";

/**
 * Upstream silence that means something is wrong rather than that nobody is sailing.
 *
 * The subscribed area is the whole western Baltic, where traffic never actually stops, so two
 * minutes without a single frame is not a quiet sea — it is a dead or muted connection.
 */
const SILENCE_MS = 120_000;

/**
 * 🔴 How long the watchdog waits before forcing another reconnect, once the upstream has already
 * proved silent. It doubles up to this cap.
 *
 * The first version reconnected every ~150 s **forever**, because `backoffMs` was reset on `open`
 * and the socket always opened — aisstream accepts the subscription and then sends nothing. Over a
 * multi-hour outage that is hundreds of reconnects against a service that throttles per API key
 * and per IP, and whose own issue tracker contains a user apologising for exactly this retry storm
 * after being rate-limited. Reconnecting cannot fix an upstream that has nothing to send, so the
 * honest behaviour is to hold the open socket and wait: if data resumes it arrives on the socket
 * we already have, and we notice in the same second.
 */
const SILENCE_BACKOFF_MAX_MS = 900_000;

/**
 * How long the live upstream may say nothing before the recorded day stands in for it.
 *
 * 🔴 Why this exists: the live source is a **free beta with no SLA and no second supplier**, and it
 * has already been mute for a whole day — subscription accepted, zero frames, no error. When live
 * traffic is the thing that makes the app worth showing, "the provider is down" cannot be allowed to
 * mean "there is nothing on the screen".
 *
 * ⚠️ This is a **stand-in, not a disguise.** The recorded day goes through the identical pipeline,
 * the status says plainly that it is a substitute, and the app labels it. The one thing that must
 * never happen is recorded traffic being presented as live — so `source` follows reality, and the
 * moment a real frame arrives the substitute is dropped and its vessels are cleared.
 *
 * Three minutes: longer than any plausible gap in a feed covering the whole western Baltic (where
 * traffic never stops), short enough that a presenter opening the app does not sit in front of an
 * empty sea.
 */
const FALLBACK_AFTER_MS = Number(process.env.AIS_FALLBACK_AFTER_MS ?? 180_000);

/**
 * How often clients hear about changes.
 *
 * Not per message: a busy hour in Phase 3 had ~50 vessels reporting every few seconds, and pushing
 * each one straight through would be a frame per vessel per report to move a ship a few metres.
 * The renderer interpolates between updates anyway.
 */
const BROADCAST_MS = 1000;

/** Re-send the feed's status at least this often, so "silent for …" does not go stale. */
const STATUS_REFRESH_MS = 10_000;

const PRUNE_MS = 30_000;

function parseArgs(argv) {
  // PORT comes from the hosting platform (Container Apps injects it); the flag still wins so a
  // local run is unaffected. Without this the container listens on 8788 while the ingress probes
  // whatever it assigned, and the revision never goes healthy.
  const args = {
    port: Number(process.env.PORT) || 8788,
    aoi: process.env.AIS_AOI || "kieler-foerde",
    spool: null,
    origin: process.env.AIS_ALLOW_ORIGIN || "*",
    replay: process.env.AIS_REPLAY || null,
    identity: process.env.AIS_IDENTITY || "full",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key === "port") args.port = Number(value);
    else if (key === "aoi") args.aoi = value;
    else if (key === "spool") args.spool = value;
    else if (key === "origin") args.origin = value;
    else if (key === "replay") args.replay = value;
    else if (key === "identity") args.identity = value;
  }
  // Fail loudly rather than silently falling back: a typo that quietly relayed identity when the
  // operator asked for anonymity is the one mistake this flag must not make.
  if (!IDENTITY_MODES.has(args.identity)) {
    throw new Error(`--identity must be one of ${[...IDENTITY_MODES].join(", ")}, `
      + `got "${args.identity}"`);
  }
  return args;
}

/**
 * The area worth relaying, taken from the AOI config rather than restated here.
 *
 * The **shell** bbox, not the core: the shell is what the app draws to the horizon, so a vessel
 * anywhere in it has somewhere to be drawn. A margin beyond that would be relayed, stored and then
 * quietly discarded by the renderer.
 */
function areaFromAoi(aoiId) {
  const config = JSON.parse(
    readFileSync(join(ROOT, "config", "aoi", `${aoiId}.json`), "utf8"),
  );
  const bbox = config.shell ?? config.bbox;
  return { west: bbox.west, south: bbox.south, east: bbox.east, north: bbox.north };
}

class Relay {
  constructor(args) {
    this.args = args;
    this.bbox = areaFromAoi(args.aoi);
    this.salt = createSalt();
    this.staticData = new Map();
    this.identity = args.identity;
    this.vessels = new Vessels(this.bbox);
    this.clients = new Set();
    this.changed = new Set();
    this.socket = null;
    this.connected = false;
    this.backoffMs = 1000;
    this.lastMessageMs = 0;
    /** When the current socket opened. The silence clock runs from the later of the two. */
    this.openedAtMs = 0;
    /**
     * When this process started.
     *
     * 🔴 The stand-in decision is measured from **the last time live data actually arrived**, not
     * from the last socket opening — and this is the floor for "never". A rejected key produces a
     * fast close/reopen cycle, so a socket-scoped clock resets every couple of seconds and would
     * never reach the threshold: the one case where the source is definitively refusing us is the
     * case where the recording would never come on. Caught by running the relay against a
     * deliberately invalid key.
     */
    this.startedAtMs = Date.now();
    /**
     * Has a single frame EVER arrived on this process?
     *
     * The one bit that separates "the sea is quiet" from "the source is not sending". Without it a
     * mute upstream and an empty bay are the same zero, and the app cheerfully reports the second
     * while the first is true.
     */
    this.everReceived = false;
    this.lastStatusSignature = "";
    this.lastStatusMs = 0;
    /** Grows while the upstream stays mute, so a long outage is not answered with a retry storm. */
    this.silenceBackoffMs = SILENCE_MS;
    /**
     * The recorded day standing in for a mute live source. Null when live is being used, or when
     * the relay was started in replay mode to begin with (then it IS the mode, not a substitute).
     */
    this.fallbackTimer = null;
    this.stats = {
      messages: 0, accepted: 0, replayed: 0, dropped: 0, unreadable: 0,
      since: new Date().toISOString(),
      reconnects: 0, upstreamErrors: 0, lastUpstreamError: null,
      mode: args.replay ? "replay" : "live",
    };
  }

  // ── upstream ────────────────────────────────────────────────────────────
  connect() {
    const key = process.env.AISSTREAM_KEY;
    if (!key) {
      console.error(
        "AISSTREAM_KEY is not set.\n"
        + "  A key is free from https://aisstream.io/apikeys (GitHub sign-in) and must never be\n"
        + "  put in the browser bundle — that is the whole reason this relay exists.\n"
        + "  To exercise the live path without one, run with --replay <terrain dir>.",
      );
      process.exit(2);
    }

    const socket = new WebSocket(UPSTREAM);
    // ⚠️ aisstream sends its JSON in **binary** frames, and Node's built-in WebSocket hands a
    // binary frame over as a Blob unless told otherwise. `JSON.parse(blob)` throws, so without
    // this line every message is received and silently discarded: the health endpoint reports a
    // connected upstream and a rising message count with nothing ever accepted.
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.connected = true;
      // 🔴 `backoffMs` is deliberately NOT reset here. An open socket is not a working feed: this
      // upstream accepts the subscription and can then send nothing at all, so treating `open` as
      // success made every reconnect look like a recovery and kept the retry interval at 1 s
      // forever. It is reset when a frame actually arrives — see the message handler.
      this.openedAtMs = Date.now();
      // The subscription must arrive within 3 seconds or the connection is closed.
      socket.send(JSON.stringify({
        APIKey: key,
        BoundingBoxes: [[[this.bbox.south, this.bbox.west], [this.bbox.north, this.bbox.east]]],
      }));
      console.log(`upstream connected, subscribed to ${JSON.stringify(this.bbox)}`);
    });

    socket.addEventListener("message", (event) => {
      this.lastMessageMs = Date.now();
      this.stats.messages += 1;
      // A frame arrived, so this connection is genuinely working: only now is it safe to go back
      // to a fast retry and a short silence window.
      this.everReceived = true;
      this.backoffMs = 1000;
      this.silenceBackoffMs = SILENCE_MS;
      // 🔴 And the substitute has to go immediately. Recorded and live vessels in the same list at
      // the same time would be indistinguishable to every consumer downstream, which is exactly
      // the confusion the stand-in exists to avoid.
      this.stopFallback();
      const text = typeof event.data === "string"
        ? event.data
        : new TextDecoder().decode(event.data);
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        // Counted, not swallowed. A frame this end cannot read is the difference between "the sea
        // is quiet" and "the relay is broken", and the two must not look alike.
        this.stats.unreadable += 1;
        if (this.stats.unreadable === 1) {
          console.error(`unreadable upstream frame (${typeof event.data}): ${text.slice(0, 120)}`);
        }
        return;
      }
      if (message.error) {
        // Kept, not just logged. `{"error": "Api Key Is Not Valid"}` is the documented shape, and
        // it is the difference between "they are not sending" and "they are refusing us" — a
        // distinction nobody can make from a container log after the fact.
        this.stats.upstreamErrors += 1;
        this.stats.lastUpstreamError = String(message.error).slice(0, 200);
        console.error(`upstream error: ${message.error}`);
        return;
      }
      this.ingest(message);
    });

    socket.addEventListener("close", () => {
      this.connected = false;
      this.stats.reconnects += 1;
      console.warn(`upstream closed, reconnecting in ${this.backoffMs} ms`);
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    });

    socket.addEventListener("error", () => {
      // 'close' always follows, and it owns the reconnect.
    });
  }

  ingest(message, fromReplay = false) {
    const report = sanitise(message, this.salt, this.staticData, this.identity);
    if (!report) {
      this.stats.dropped += 1;
      return;
    }
    if (this.vessels.add(report)) {
      // 🔴 Replay-injected reports are counted apart from upstream ones. They used to share
      // `accepted`/`messages`, which made `/ais/health` contradict itself the moment the stand-in
      // came on: `everReceived: false` next to `messages: 19896840`. Those counters are the only
      // way to tell "the source is refusing us" from "the sea is quiet" after the fact, and a
      // substitute quietly inflating them destroys the one diagnostic that matters here.
      if (fromReplay) this.stats.replayed += 1;
      else this.stats.accepted += 1;
      this.changed.add(report.id);
      if (this.args.spool) void this.spool(report);
    }
  }

  /**
   * NDJSON on disk, one sanitised report per line.
   *
   * This is the seam to the Fabric Real-Time Intelligence path: the same records go to Eventstream
   * and on into an Eventhouse. It is a file rather than a direct push so the relay never needs
   * Fabric credentials, and so an outage upstream of Fabric cannot lose data that was already
   * received. It is also, as PLAN §5 notes, how a replay window would be recorded — the fallback
   * building the primary.
   */
  async spool(report) {
    const dir = join(ROOT, this.args.spool);
    if (!this.spoolReady) {
      await mkdir(dir, { recursive: true });
      this.spoolReady = true;
    }
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(join(dir, `ais-${day}.ndjson`), `${JSON.stringify(report)}\n`);
  }

  // ── replay mode ─────────────────────────────────────────────────────────
  /**
   * 🔴 Feed the recorded day through the identical pipeline, as if it were arriving now.
   *
   * This is what makes the phase gate testable. "Live and replay use the same render path" is easy
   * to claim and hard to prove when the live half needs a key, a network and somebody else's beta
   * service to be up. In this mode the bytes come from the Phase 3 asset, are turned back into
   * aisstream-shaped messages, and then go through `sanitise` → `Vessels` → SSE exactly as live
   * traffic does. If anything in that chain only works for live data, this mode breaks.
   *
   * It is not a mock: nothing downstream of this function knows or can know which mode it is in.
   */
  startReplay(replayDir = this.args.replay) {
    const dir = join(ROOT, replayDir);
    const meta = JSON.parse(readFileSync(join(dir, "tracks.json"), "utf8"));
    const raw = gunzipSync(readFileSync(join(dir, meta.file)));
    const n = meta.pointCount;
    const xs = new Int16Array(raw.buffer, raw.byteOffset, n);
    const zs = new Int16Array(raw.buffer, raw.byteOffset + 2 * n, n);
    const ts = new Uint16Array(raw.buffer, raw.byteOffset + 4 * n, n);
    const speeds = new Uint8Array(raw.buffer, raw.byteOffset + 6 * n, n);

    // The asset stores metres from the AOI centre; the wire format is degrees, because that is
    // what a real feed carries. Going back through lat/lon rather than short-circuiting is the
    // point: the live path's projection code gets exercised too.
    //
    // ⚠️ The centre comes from the asset. It used to be two literals — 54.383/10.175, the first
    // AOI's centre — read alongside a `meta.originUtm` that was then never used. Pointed at a
    // second AOI's tracks, that projected the whole day about 30 km away into the wrong inlet,
    // silently and with the right number of vessels.
    const centre = meta.originLonLat;
    if (!centre) {
      throw new Error(
        `${replayDir}/tracks.json has no originLonLat — rebuild it with `
        + "tools/ais/build_tracks.py. Refusing to guess a centre: the old default silently "
        + "placed a second AOI's vessels tens of kilometres from where they sailed.",
      );
    }
    const latPerM = 1 / 111_320;
    const lonPerM = 1 / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
    const centreLat = centre.lat;
    const centreLon = centre.lon;

    const points = [];
    meta.tracks.forEach((track, index) => {
      for (let k = 0; k < track.count; k += 1) {
        const i = track.start + k;
        points.push({
          index,
          type: track.type,
          lat: centreLat - zs[i] * latPerM,
          lon: centreLon + xs[i] * lonPerM,
          s: ts[i] * meta.timeStepS,
          speed: speeds[i] * meta.speedStepKn,
        });
      }
    });
    points.sort((a, b) => a.s - b.s);
    console.log(`replay: ${meta.trackCount} passages, ${points.length} positions from ${meta.date}`
      + `  (origin ${centreLat.toFixed(4)} N / ${centreLon.toFixed(4)} E)`);

    // Start at the busiest hour rather than at midnight, so a demo has something to show at once.
    // The clock itself lives in `replayClock.js` and is unit-tested there — it used to be inline
    // here, where it could not be, and it ran away after the first wrap for exactly that long.
    const times = points.map((p) => p.s);
    let state = startReplayState(times, 19 * 3600, Date.now());

    const timer = setInterval(() => {
      const step = advanceReplay(times, state, Date.now());
      for (let index = step.from; index < step.to; index += 1) {
        const p = points[index];
        this.stats.replayed += 1;
        // A real aisstream message, so `sanitise` does real work rather than being bypassed.
        this.ingest({
          MessageType: "PositionReport",
          MetaData: {
            // A synthetic MMSI: the replay asset has no real one, and inventing a plausible
            // identifier that could collide with a real vessel would be worse than an obvious one.
            MMSI: 900_000_000 + p.index,
            time_utc: new Date(Date.now()).toISOString(),
          },
          Message: {
            PositionReport: {
              Latitude: p.lat, Longitude: p.lon, Sog: p.speed, Cog: 0, Valid: true,
              Type: replayTypeCode(p.type),
            },
          },
        }, true);
      }
      state = step.state;
      if (step.wrapped) console.log("replay wrapped");
    }, REPLAY_TICK_MS);
    timer.unref();
    return timer;
  }

  /**
   * Put the recorded day on air because the live source is sending nothing.
   *
   * ⚠️ Idempotent, and it never fires in replay mode — there the recording is not a substitute for
   * anything, it *is* the source.
   */
  startFallback() {
    if (this.fallbackTimer || this.stats.mode !== "live") return;
    const dir = `public/terrain/${this.args.aoi}`;
    try {
      this.fallbackTimer = this.startReplay(dir);
      console.warn(`no live data for ${Math.round((this.noLiveDataForMs() ?? 0) / 1000)} s — `
        + `standing in with the recorded day from ${dir}. This is labelled as a substitute `
        + "everywhere it surfaces; it is dropped the moment a real frame arrives.");
    } catch (error) {
      // A missing recording is not a reason to take the relay down: live may still recover.
      console.error(`cannot stand in with a recording: ${error.message}`);
      this.fallbackTimer = null;
    }
  }

  /** Hand back to the live source, and take the substitute's vessels with it. */
  stopFallback() {
    if (!this.fallbackTimer) return;
    clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    // 🔴 The recorded vessels must go. Leaving them in the map would mix a recording into a live
    // picture with nothing downstream able to tell them apart — the precise failure this whole
    // feature exists to avoid.
    this.vessels = new Vessels(this.bbox);
    this.changed.clear();
    console.log("live data resumed — recorded stand-in dropped and its vessels cleared");
  }

  // ── downstream ──────────────────────────────────────────────────────────
  /**
   * Tell connected clients what the feed has become.
   *
   * 🔴 **Status used to be sent once, when a client connected, and never again.** Everything else
   * about the feed was pushed continuously, so the omission was invisible — until the stand-in
   * came on for a browser that had connected while the source was merely quiet. The list filled
   * with 47 recorded ships while the bar above it went on saying *"Quelle sendet nicht"*, because
   * that bar was rendering a status frame from before the switch.
   *
   * That is precisely the failure §13.11 was built to prevent: the count and the caveat have to
   * agree, and here they contradicted each other on the same screen. A stale caveat is worse than
   * a missing one, because it is evidence the app does not know what it is showing.
   *
   * Pushed when the *meaning* changes, and every {@link STATUS_REFRESH_MS} regardless so the
   * "silent for …" wording keeps up. Deliberately not every tick: the durations in the payload
   * change constantly and would defeat any change detection.
   */
  pushStatus(force = false) {
    if (!this.clients.size) return;
    const status = this.status();
    // Only the fields that change what the UI *says*. The durations are excluded on purpose.
    const signature = JSON.stringify([
      status.mode, status.upstream, status.source, status.fallback,
      status.everReceived, status.identity,
    ]);
    const due = Date.now() - this.lastStatusMs >= STATUS_REFRESH_MS;
    if (!force && !due && signature === this.lastStatusSignature) return;
    this.lastStatusSignature = signature;
    this.lastStatusMs = Date.now();
    const frame = `event: status\ndata: ${JSON.stringify(status)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  broadcast() {
    // Before the early returns below: a feed that has gone quiet is exactly when the client most
    // needs to hear about it, and there are no vessel deltas to ride along with.
    this.pushStatus();
    if (!this.clients.size) {
      this.changed.clear();
      return;
    }
    if (!this.changed.size) return;
    const payload = this.vessels.delta(this.changed);
    this.changed.clear();

    // A cheap standing assertion rather than a comment claiming the boundary holds. It costs a
    // string scan per second and it is the one bug in this file that would actually matter.
    //
    // ⚠️ Only in `anonymous` mode. In the identified modes an MMSI in the payload is the whole
    // point, and running this there would refuse to send every frame — the guard has to follow
    // the promise the relay is actually making, not a promise it used to make.
    if (this.identity === "anonymous") {
      const leaks = leaksIdentity(payload);
      if (leaks.length) {
        console.error(`REFUSING TO SEND: payload carries ${leaks.join(", ")}`);
        return;
      }
    }

    const frame = `event: vessels\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  /**
   * How long the upstream has said nothing, measured from the later of the last frame and the
   * current socket opening. Null in replay, where the question is meaningless.
   */
  silentForMs() {
    if (this.stats.mode === "replay") return null;
    return silenceSince({
      lastMessageMs: this.lastMessageMs,
      openedAtMs: this.openedAtMs,
      nowMs: Date.now(),
    });
  }

  /**
   * How long since live data last arrived at all — across reconnects, from process start.
   *
   * ⚠️ Deliberately NOT `silentForMs()`. That one is scoped to the current socket, which is right
   * for deciding whether to reconnect and wrong for deciding whether the source is usable: a
   * refused key reopens every few seconds and would keep resetting it forever.
   */
  noLiveDataForMs() {
    if (this.stats.mode === "replay") return null;
    return Math.max(0, Date.now() - Math.max(this.lastMessageMs, this.startedAtMs));
  }

  /** Is the recorded day currently deputising for a mute live source? */
  onFallback() {
    return this.fallbackTimer !== null;
  }

  status() {
    const silentForMs = this.silentForMs();
    /**
     * 🔴 Three upstream states, not two, for the same reason the coverage field has three:
     * "down" (no socket), "silent" (subscribed and receiving nothing) and "connected" (data is
     * flowing). Collapsing silent into connected is what let the app report **0 Schiffe** — an
     * assertion about the sea — while the truth was that the source had sent nothing at all.
     */
    const upstream = upstreamState({
      mode: this.stats.mode,
      connected: this.connected,
      silentForMs,
      silenceMs: SILENCE_MS,
    });
    return {
      mode: this.stats.mode,
      upstream,
      // Who the data came from, as distinct from whether the socket is up. The app has to credit a
      // provider on a permanent notice, and "connected" is not a provider.
      //
      // 🔴 It follows what is ACTUALLY on the wire. While the recorded day is standing in for a
      // mute live source, the provider is the recording — crediting aisstream for vessels it did
      // not send would be a false attribution on a permanent notice.
      source: (this.stats.mode === "replay" || this.onFallback()) ? "replay" : "aisstream.io",
      /**
       * True when the recording is deputising for a live source that has gone quiet. Distinct from
       * `mode === "replay"`, where the recording is not a substitute for anything.
       */
      fallback: this.onFallback(),
      /** Time since live data last arrived, across reconnects. What the stand-in decision uses. */
      noLiveDataForMs: this.noLiveDataForMs(),
      vessels: this.vessels.size,
      clients: this.clients.size,
      aoi: this.args.aoi,
      bbox: this.bbox,
      messages: this.stats.messages,
      accepted: this.stats.accepted,
      replayed: this.stats.replayed,
      dropped: this.stats.dropped,
      unreadable: this.stats.unreadable,
      outOfArea: this.vessels.stats.outOfArea,
      since: this.stats.since,
      // The three fields a reader needs to tell "quiet" from "broken" without reading a log.
      everReceived: this.stats.mode === "replay" ? true : this.everReceived,
      silentForMs,
      reconnects: this.stats.reconnects,
      upstreamErrors: this.stats.upstreamErrors,
      lastUpstreamError: this.stats.lastUpstreamError,
      identity: this.identity,
      identityNote: this.identity === "anonymous"
        ? "MMSI, name, call sign, IMO and destination are dropped at ingest and never leave this "
          + "process. Vessel ids are salted per session and meaningless outside it."
        : this.identity === "commercial"
          ? "Commercial traffic is relayed with its transmitted identity; pleasure and sailing "
            + "craft carry a per-session salted pseudonym instead."
          : "Vessel identity is relayed as transmitted — MMSI, name, call sign, IMO, destination "
            + "and dimensions are broadcast in clear under SOLAS. Set AIS_IDENTITY=commercial to "
            + "pseudonymise pleasure craft, or anonymous for no identity at all.",
    };
  }

  serve() {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", this.args.origin);
      const url = new URL(req.url, `http://${req.headers.host}`);

      // 🔴 Private Network Access. A page served from a public https origin is not allowed to
      // reach a loopback address unless the loopback server opts in — Chrome answers such a
      // request with "Permission was denied for this request to access the `loopback` address
      // space" and no amount of ordinary CORS fixes it. Opting in is correct and standards-based,
      // but it is NOT a guarantee: newer Chrome gates this behind a user permission as well.
      //
      // The dependable arrangement is therefore a relay on a real origin, not on localhost. This
      // header makes the local case work wherever policy still allows it.
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "content-type");
        res.setHeader("Access-Control-Max-Age", "600");
        if (req.headers["access-control-request-private-network"]) {
          res.setHeader("Access-Control-Allow-Private-Network", "true");
        }
        res.writeHead(204).end();
        return;
      }

      if (url.pathname === "/ais/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.status(), null, 2));
        return;
      }

      if (url.pathname !== "/ais/stream") {
        res.writeHead(404).end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(`event: status\ndata: ${JSON.stringify(this.status())}\n\n`);
      res.write(`event: vessels\ndata: ${JSON.stringify(this.vessels.snapshot())}\n\n`);
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
    });

    server.listen(this.args.port, () => {
      console.log(`relay on http://127.0.0.1:${this.args.port}/ais/stream  (${this.stats.mode})`);
    });

    setInterval(() => this.broadcast(), BROADCAST_MS).unref();
    setInterval(() => this.vessels.prune(), PRUNE_MS).unref();
    // SSE through a proxy dies silently if nothing crosses it; a comment line is ignored by
    // EventSource and keeps the pipe warm.
    setInterval(() => {
      for (const client of this.clients) client.write(": keepalive\n\n");
    }, 15_000).unref();

    if (this.stats.mode === "live") {
      setInterval(() => {
        // Put the recording on air well before giving up on the socket: a presenter should not be
        // looking at an empty sea while we wait out a backoff measured in quarter-hours. Measured
        // from the last real DATA, so a refused key reaches the threshold like a mute one does.
        if (shouldStandIn({
          mode: this.stats.mode,
          silentForMs: this.noLiveDataForMs(),
          alreadyStandingIn: this.onFallback(),
          afterMs: FALLBACK_AFTER_MS,
        })) this.startFallback();

        const silent = this.silentForMs();
        if (silent === null) return;
        if (!this.connected) return;
        if (silent <= this.silenceBackoffMs) return;
        // ⚠️ Reconnecting cannot make a mute upstream speak. This exists for the case the socket
        // is genuinely dead but the OS has not noticed; when the source is simply not sending,
        // the window doubles so a multi-hour outage costs a handful of reconnects rather than one
        // every two minutes against a service that throttles per key.
        console.warn(`upstream silent for ${Math.round(silent / 1000)} s, forcing a reconnect `
          + `(next check in ${Math.round(this.silenceBackoffMs / 1000)} s)`);
        this.silenceBackoffMs = nextSilenceBackoffMs(this.silenceBackoffMs,
                                                     SILENCE_BACKOFF_MAX_MS);
        this.socket?.close();
      }, 30_000).unref();
    }
  }
}

/** Coarse class name → a representative AIS type code, so replay exercises the real classifier. */
function replayTypeCode(name) {
  const codes = {
    Passenger: 60, Cargo: 70, Tanker: 80, Fishing: 30, Tug: 52, Dredging: 33,
    Military: 35, Pilot: 50, SAR: 51, "Law enforcement": 55, Sailing: 36, Pleasure: 37,
    Other: 40,
  };
  return codes[name] ?? 0;
}

const args = parseArgs(process.argv.slice(2));
const relay = new Relay(args);
relay.serve();
if (args.replay) relay.startReplay();
else relay.connect();
