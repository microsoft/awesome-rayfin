/**
 * The facts the assistant is allowed to state.
 *
 * 🔴 **Every tool answer comes from the shipped asset the browser downloads, not from a second
 * copy of the truth.** PLAN §3.2 rule 6 forbids invented data, and an assistant is the easiest
 * place in an app to break that rule convincingly: a model asked "how many ferries were there?"
 * will produce a number whether or not it has one. It can only be held to the data if the data is
 * what it is given.
 *
 * ⚠️ Read once at start-up and cached. The assets are versioned with the image, so `/healthz`
 * reports the track date and counts it holds — a backend answering about a day the deployed app no
 * longer shows is the drift that would be hardest to notice from the outside.
 */

import { gunzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 🔴 Matches `TRANSIT_MIN_KM` in the app. One definition of "transit" or the figures disagree —
 * and they would disagree in the worst possible way: the app saying 137 and the assistant 261,
 * each correct under its own rule, in the same conversation.
 */
export const TRANSIT_MIN_KM = 0.5;

const areas = new Map();

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = String(Math.floor(s / 3600) % 24).padStart(2, "0");
  const m = String(Math.floor(s / 60) % 60).padStart(2, "0");
  return `${h}:${m}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Decode `tracks.binz`: planar int16 x, int16 z, uint16 t, uint8 speed — 7 bytes per position.
 *
 * ⚠️ **Planar, not interleaved**: all the x values, then all the z, and so on. Reading it as
 * interleaved records yields plausible-looking coordinates in the wrong place, which is exactly
 * the kind of wrong that survives a glance.
 */
export function decodeTracks(blob, pointCount) {
  const raw = gunzipSync(blob);
  const expected = pointCount * 7;
  if (raw.length !== expected) {
    throw new Error(`tracks.binz is ${raw.length} bytes, expected ${expected} for `
      + `${pointCount} positions`);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const xs = new Int16Array(pointCount);
  const zs = new Int16Array(pointCount);
  let offset = 0;
  for (let i = 0; i < pointCount; i += 1, offset += 2) xs[i] = view.getInt16(offset, true);
  for (let i = 0; i < pointCount; i += 1, offset += 2) zs[i] = view.getInt16(offset, true);
  return { xs, zs };
}

/** Ground distance travelled by one passage, in km, from the planar metres the app renders. */
function passageKm(xs, zs, start, count) {
  let metres = 0;
  for (let i = start + 1; i < start + count; i += 1) {
    metres += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  return metres / 1000;
}

async function loadArea(dir, id) {
  const meta = await readJson(join(dir, "tracks.json"));
  const optional = async (name) => {
    try {
      return await readJson(join(dir, name));
    } catch {
      // An AOI without a vegetation layer is a real state the app handles and reports. Refusing to
      // start over one missing optional descriptor would be worse than answering what we have.
      return null;
    }
  };
  const heightmap = await optional("heightmap_4m.json");
  const los = await optional("los_16m.json");

  let xs = null;
  let zs = null;
  try {
    const decoded = decodeTracks(
      await readFile(join(dir, meta.file ?? "tracks.binz")), meta.pointCount);
    xs = decoded.xs;
    zs = decoded.zs;
  } catch (error) {
    // Without the binary there are no distances, so no transit classification. Recorded on the
    // area so a tool can say "not available" rather than quietly quoting passages as transits.
    console.error(`assistant: ${id} has no usable tracks.binz (${error.message})`);
  }

  const tracks = meta.tracks.map((track, index) => {
    const km = xs ? passageKm(xs, zs, track.start, track.count) : null;
    return {
      index,
      vessel: track.vessel,
      name: track.name ?? null,
      mmsi: track.mmsi ?? null,
      callSign: track.callSign ?? null,
      imo: track.imo ?? null,
      destination: track.destination ?? null,
      type: track.type || "Undefined",
      lengthM: track.length ?? null,
      beamM: track.width ?? null,
      draughtM: track.draughtM ?? null,
      fromUtc: clock(track.fromS),
      toUtc: clock(track.toS),
      minutesInArea: Math.max(1, Math.round((track.toS - track.fromS) / 60)),
      reports: track.count,
      distanceKm: km === null ? null : Number(km.toFixed(2)),
      isTransit: km === null ? null : km >= TRANSIT_MIN_KM,
    };
  });

  return {
    id,
    date: meta.date,
    attribution: meta.attribution,
    identityNote: meta.identityNote ?? null,
    trackCount: meta.trackCount,
    pointCount: meta.pointCount,
    vesselCount: meta.vesselCount,
    namedTrackCount: meta.namedTrackCount ?? tracks.filter((t) => t.name).length,
    transitCount: xs ? tracks.filter((t) => t.isTransit).length : null,
    byType: meta.byType ?? {},
    boundsWgs84: heightmap?.boundsWgs84 ?? null,
    terrainResolutionM: heightmap?.resolutionM ?? null,
    heightRangeM: heightmap ? [heightmap.heightMinM, heightmap.heightMaxM] : null,
    los: los
      ? {
          resolutionM: los.resolutionM,
          includesBuildings: los.includesBuildings ?? null,
          includesVegetation: los.includesVegetation ?? null,
          vegetationStats: los.vegetationStats ?? null,
        }
      : null,
    distancesAvailable: Boolean(xs),
    tracks,
  };
}

/** Load every AOI under `dir`. Called once at start-up. */
export async function loadAreas(dir) {
  areas.clear();
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return areas;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      areas.set(entry.name, await loadArea(join(dir, entry.name), entry.name));
    } catch (error) {
      console.error(`assistant: could not load area ${entry.name}: ${error.message}`);
    }
  }
  return areas;
}

export function areaIds() {
  return [...areas.keys()];
}

/** The named area, or the first loaded one. Null when nothing loaded at all. */
export function getArea(id) {
  if (id && areas.has(id)) return areas.get(id);
  return areas.get(areaIds()[0]) ?? null;
}

export { clock };
