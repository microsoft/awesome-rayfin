/**
 * The OGN relay — PLAN §5.3 and phase 4.
 *
 * OGN speaks APRS-IS over a raw TCP socket, which a browser cannot open. Something has to sit in
 * the middle, and once something is in the middle it is also the only correct place to enforce the
 * privacy rules (§2.2.1) and to hold the shared trail state. Hence: one process that keeps a
 * single upstream connection no matter how many people are watching, and fans out over SSE.
 *
 * **SSE rather than WebSocket**, though PLAN §5.3 offers either. The traffic is strictly one-way,
 * `EventSource` reconnects on its own without a line of code, it survives proxies that mangle
 * upgrades, and it needs no dependency at all — this whole relay runs on Node's standard library.
 * A WebSocket would have bought a back-channel the app has no use for.
 *
 * Deliberately **not** part of the Vite build: the deployed app is static hosting, which cannot
 * run a socket client. If no relay is reachable the app falls back to Mode B and says so, which
 * decision 15 already made a first-class path rather than an error.
 *
 * Usage
 *   node server/ogn/relay.js
 *   node server/ogn/relay.js --port 8787 --aoi oberstdorf
 *   node server/ogn/relay.js --spool data/live     # also write NDJSON for the RTI uploader
 */

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { appendFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAprsLine } from './aprs.js';
import { DeviceDatabase } from './ddb.js';
import { Traffic } from './traffic.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const APRS_HOST = 'aprs.glidernet.org';
const APRS_PORT = 14580;

/** Upstream silence that means the connection has died rather than that nobody is flying. */
const APRS_SILENCE_S = 120;
/** How often clients hear about changes. See `broadcast` for why this is not per-message. */
const BROADCAST_MS = 1000;
const DDB_REFRESH_MS = 6 * 60 * 60 * 1000;

function parseArgs(argv) {
  // `PORT` and `ORIGIN` come from the environment so the same entrypoint works unchanged in a
  // container, where the platform chooses the port rather than the command line.
  const args = {
    port: Number(process.env.PORT ?? 8787),
    aoi: 'oberstdorf',
    world: process.env.OGN_WORLD ?? null,
    spool: null,
    origin: process.env.ORIGIN ?? '*',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'port') args.port = Number(value);
    else if (key === 'aoi') args.aoi = value;
    else if (key === 'world') args.world = value;
    else if (key === 'spool') args.spool = value;
    else if (key === 'origin') args.origin = value;
  }
  return args;
}

/**
 * The area worth relaying, taken from the AOI config rather than restated here.
 *
 * The **shell** bbox, not the core: the shell is what the app draws to the horizon, so an aircraft
 * anywhere in it has somewhere to be drawn. Anything further away would be relayed, stored and
 * then quietly discarded by the renderer.
 *
 * ⚠️ **A world, not a site, once the app shows a world — PLAN §8.** The browser's active site now
 * CHANGES as the camera flies, while a relay has exactly one upstream filter and announces exactly
 * one area. Started with `--aoi oberstdorf`, it would be correctly refused by the wrong-area guard
 * the moment the viewer flew to the Tegelberg — and its 23 km filter would not have covered that
 * mountain anyway. Started with `--world`, one filter spans both and the id it announces is the
 * world's.
 */
function areaFromConfig(configPath, id) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const bbox = config.shell ?? config.bbox;
  const centreLat = (bbox.south + bbox.north) / 2;
  const centreLon = (bbox.west + bbox.east) / 2;

  // APRS-IS filters by radius, so the box has to be turned into the circle that contains it.
  const latM = (bbox.north - centreLat) * 111_320;
  const lonM = (bbox.east - centreLon) * 111_320 * Math.cos((centreLat * Math.PI) / 180);
  const radiusKm = Math.ceil(Math.hypot(latM, lonM) / 1000);

  return {
    bbox,
    centreLat,
    centreLon,
    radiusKm,
    id: config.id ?? id,
    name: config.name?.de ?? config.site?.name?.de ?? id,
  };
}

function areaFor(args) {
  return args.world
    ? areaFromConfig(join(ROOT, 'config', 'world', `${args.world}.json`), args.world)
    : areaFromConfig(join(ROOT, 'config', 'aoi', `${args.aoi}.json`), args.aoi);
}

class Relay {
  constructor(args) {
    this.args = args;
    this.area = areaFor(args);
    this.ddb = new DeviceDatabase();
    this.traffic = new Traffic(this.area.bbox);
    this.clients = new Set();
    this.changed = new Map();
    this.socket = null;
    this.connected = false;
    this.backoffMs = 1000;
    this.lastLineAt = 0;
    this.stats = { lines: 0, positions: 0, suppressed: 0, outOfArea: 0, since: new Date().toISOString() };
  }

  // ── Upstream ────────────────────────────────────────────────────────────────

  connect() {
    const socket = createConnection({ host: APRS_HOST, port: APRS_PORT });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(0);

    let buffer = '';

    socket.on('connect', () => {
      this.connected = true;
      this.backoffMs = 1000;
      this.lastLineAt = Date.now();
      // Read-only login. `pass -1` is the documented anonymous form; the server-side filter means
      // the bandwidth and the parsing cost scale with the AOI rather than with Europe.
      socket.write(
        `user GSINS pass -1 vers Gleitschirm-Insights 0.1 ` +
          `filter r/${this.area.centreLat.toFixed(4)}/${this.area.centreLon.toFixed(4)}/${this.area.radiusKm}\r\n`
      );
      console.log(
        `[aprs] connected · filter r/${this.area.centreLat.toFixed(4)}/` +
          `${this.area.centreLon.toFixed(4)}/${this.area.radiusKm}`
      );
      this.announceStatus();
    });

    socket.on('data', (chunk) => {
      this.lastLineAt = Date.now();
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        this.handleLine(line);
      }
    });

    const drop = (why) => {
      if (!this.connected && this.socket !== socket) return;
      this.connected = false;
      socket.destroy();
      this.announceStatus();
      console.warn(`[aprs] disconnected (${why}), retrying in ${this.backoffMs} ms`);
      setTimeout(() => this.connect(), this.backoffMs);
      // Capped exponential backoff: a network blip should recover in a second, but a sustained
      // outage must not turn into a reconnect storm against someone else's free service.
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    };

    socket.on('error', (error) => drop(error.message));
    socket.on('close', () => drop('closed'));
  }

  handleLine(line) {
    this.stats.lines += 1;
    const report = parseAprsLine(line);
    if (!report) return;
    this.stats.positions += 1;

    // Privacy first, before the report is stored anywhere at all.
    const identity = this.ddb.publicIdentity(report);
    if (!identity) {
      this.stats.suppressed += 1;
      return;
    }

    const craft = this.traffic.ingest(report, identity);
    if (!craft) {
      this.stats.outOfArea += 1;
      return;
    }

    this.changed.set(craft.id, craft);
    if (this.args.spool) this.spool(craft);
  }

  // ── Downstream ──────────────────────────────────────────────────────────────

  /**
   * Batched at 1 Hz rather than sent per message.
   *
   * The measured upstream rate over this AOI is ~6 reports/s. Forwarding each one individually
   * would mean six SSE frames per second per viewer to move a glider a few metres — below the
   * threshold at which anyone can see the difference, and above the threshold at which the browser
   * starts spending real time on JSON parsing.
   */
  broadcast() {
    const removed = this.traffic.prune();
    if (this.changed.size === 0 && removed.length === 0) return;

    const payload = {
      t: Math.round(Date.now() / 1000),
      aircraft: [...this.changed.values()].map((craft) => this.traffic.serialise(craft, false)),
      removed,
    };
    this.changed.clear();
    this.send('update', payload);
  }

  send(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) client.write(frame);
  }

  announceStatus() {
    this.send('status', this.status());
  }

  status() {
    return {
      upstream: this.connected ? 'connected' : 'disconnected',
      aircraft: this.traffic.aircraft.size,
      devicesKnown: this.ddb.size,
      ddbFetchedAt: this.ddb.fetchedAt,
      // ⚠️ The machine `id`, not just the display name. The relay is started with its own `--aoi`
      // and has no idea which site the browser is showing: point a Tegelberg page at a relay
      // filtering on Oberstdorf and you get real, live, correctly-decoded aircraft plotted onto
      // the wrong mountain. The client cannot detect that without something it can compare.
      area: { id: this.area.id, name: this.area.name, radiusKm: this.area.radiusKm },
      stats: this.stats,
    };
  }

  async spool(craft) {
    // NDJSON, one line per fix, for `tools/fabric/ingest_live.py`. The relay does not talk to
    // Fabric itself: that would mean an AAD token in a process whose whole job is to hold an
    // anonymous socket open, and it would couple the live map's uptime to a cloud credential.
    const day = new Date().toISOString().slice(0, 10);
    const file = join(ROOT, this.args.spool, `live-${day}.ndjson`);
    const row = {
      ts: new Date().toISOString(),
      id: craft.id,
      type: craft.type,
      lat: craft.lat,
      lon: craft.lon,
      alt_m: Math.round(craft.altM),
      climb_ms: craft.climbMs,
      ground_ms: craft.groundMs,
      course_deg: craft.courseDeg,
    };
    try {
      await appendFile(file, `${JSON.stringify(row)}\n`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(row)}\n`);
      } else {
        console.warn(`[spool] ${error.message}`);
      }
    }
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  serve() {
    const server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', this.args.origin);

      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/ogn/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.status(), null, 2));
        return;
      }

      if (url.pathname !== '/ogn/stream') {
        res.writeHead(404).end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });

      // A client that connects at 16:00 should see the aircraft that took off at 15:40, trails and
      // all, rather than an empty map that fills in over the next twenty minutes.
      res.write(`event: status\ndata: ${JSON.stringify(this.status())}\n\n`);
      res.write(
        `event: snapshot\ndata: ${JSON.stringify({
          t: Math.round(Date.now() / 1000),
          aircraft: this.traffic.snapshot(),
        })}\n\n`
      );

      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
    });

    server.listen(this.args.port, () => {
      console.log(`[http] http://localhost:${this.args.port}/ogn/stream`);
    });
    return server;
  }

  async start() {
    // ⚠️ The first DDB fetch is a hard prerequisite, not a nice-to-have. Without it there is no way
    // to know who has opted out, and relaying "everything except the in-band stealth flags" would
    // be a decision to publish positions the pilots asked to keep private. Refusing to start is the
    // honest failure: no live layer, and the app falls back to Mode B exactly as designed.
    const count = await this.ddb.refresh();
    console.log(`[ddb] ${count} devices`);

    setInterval(() => {
      // A *refresh* failure is different: the previous list is still a valid statement of who opted
      // out, so it is kept and the error is merely reported.
      this.ddb.refresh().then(
        (n) => console.log(`[ddb] refreshed, ${n} devices`),
        (error) => console.warn(`[ddb] refresh failed, keeping previous list: ${error.message}`)
      );
    }, DDB_REFRESH_MS).unref();

    this.serve();
    this.connect();

    setInterval(() => this.broadcast(), BROADCAST_MS).unref();

    // SSE through a proxy dies silently if nothing crosses it. A comment line is ignored by
    // EventSource and costs two bytes.
    setInterval(() => {
      for (const client of this.clients) client.write(': ping\n\n');
    }, 15_000).unref();

    setInterval(() => {
      if (this.connected && Date.now() - this.lastLineAt > APRS_SILENCE_S * 1000) {
        console.warn('[aprs] upstream silent, reconnecting');
        this.socket?.destroy();
      }
    }, 30_000).unref();
  }
}

const relay = new Relay(parseArgs(process.argv.slice(2)));
relay.start().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  console.error('The relay will not start without the device database — see the note in start().');
  process.exit(1);
});
