/**
 * Load the generated terrain assets.
 *
 * ⚠️ Every binary here is gzipped and **none of them is named `.gz`**. A dev server sets
 * `Content-Encoding: gzip` on that extension and the browser inflates it transparently, while a
 * static host sets nothing and hands over raw bytes — the same file, opposite behaviour, and the
 * app's own inflate then throws on one of them. So the extension is neutral (`.u16z`, `.u8z`,
 * `.binz`) and the magic bytes are checked instead.
 */

export interface HeightmapMeta {
  width: number;
  height: number;
  resolutionM: number;
  origin: { easting: number; northing: number };
  heightMinM: number;
  heightMaxM: number;
  heightScale: number;
  file: string;
  landMaskFile: string;
  seaLevelM: number;
  coverage: number;
  boundsWgs84: { west: number; south: number; east: number; north: number };
  attribution: string;
}

export interface BuildingsMeta {
  count: number;
  vertexCount: number;
  quantisation: { xzScaleM: number; yScaleM: number; yOffsetM: number };
  originUtm: { easting: number; northing: number };
  file: string;
  attribution: string;
}

export interface ShellMeta {
  width: number;
  height: number;
  /** Stored posting in metres — 90 m, not the 30 m source. See the builder's resolutionNote. */
  resolutionM: number;
  lonWest: number;
  lonEast: number;
  latNorth: number;
  latSouth: number;
  heightMinM: number;
  heightScale: number;
  file: string;
  seamOffsetM: number;
  coreUtm: { e0: number; n0: number; e1: number; n1: number };
  attribution: string;
}

export type Progress = (stage: string, loaded: number, total: number) => void;

/**
 * Where a site's built assets live.
 *
 * ⚠️ This used to be a module constant naming one site, which is exactly the hard-coded location
 * PLAN §4 forbids — the geodata pipeline had been AOI-parameterised from the first commit and the
 * browser quietly was not. It is now passed in, so adding a site is a data build plus one entry in
 * `src/config/aoi.ts`.
 */
function basePath(aoiId: string): string {
  return `terrain/${aoiId}`;
}

async function inflate(blob: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(blob);
  // Detect by content, never by extension.
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return blob;
  const stream = new Response(blob).body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

async function fetchBinary(
  base: string, name: string, onBytes?: (n: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const type = response.headers.get("Content-Type") ?? "";
  // 🔴 A static host answers a missing asset with index.html and HTTP 200, so the fetch
  // "succeeds" and only fails later, deep in a parser, as something unrelated.
  if (type.includes("text/html")) {
    throw new Error(`${name} came back as HTML — the terrain assets have not been built`);
  }
  const buffer = await response.arrayBuffer();
  onBytes?.(buffer.byteLength);
  return await inflate(buffer);
}

async function fetchJson<T>(base: string, name: string): Promise<T> {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`${name} came back as HTML — the terrain assets have not been built`);
  }
  return JSON.parse(text) as T;
}

export interface TracksMeta {
  date: string;
  trackCount: number;
  pointCount: number;
  timeStepS: number;
  speedStepKn: number;
  originUtm: { easting: number; northing: number };
  file: string;
  byType: Record<string, number>;
  /**
   * One entry per passage.
   *
   * `vessel` is the **MMSI** when the day was ingested with identity retained, and a per-day
   * salted pseudonym when it was not — `fetch_ais.py --identity` decides which, and the asset
   * records the choice in `identityNote`. The identity fields below are therefore optional in the
   * type as well as in the data: they are absent for an anonymised build, and absent for a vessel
   * that never transmitted a static report even in a fully identified one.
   */
  tracks: {
    vessel: string;
    type: string;
    start: number;
    count: number;
    fromS: number;
    toS: number;
    length?: number;
    width?: number;
    mmsi?: string;
    name?: string;
    callSign?: string;
    imo?: string;
    destination?: string;
    draughtM?: string;
  }[];
  /** How many passages carry a vessel name. Zero for an anonymised build. */
  namedTrackCount?: number;
  identityNote?: string;
  attribution: string;
}

export interface LosMeta {
  width: number;
  height: number;
  resolutionM: number;
  origin: { easting: number; northing: number };
  heightMinM: number;
  heightMaxM: number;
  heightScale: number;
  file: string;
  seaLevelM: number;
  includesBuildings: boolean;
  includesVegetation: boolean;
  vegetationNote: string;
  buildingStats: Record<string, number>;
  /**
   * What the measured surface top added, when it was built. Absent when it was not.
   *
   * ⚠️ Read this rather than writing the numbers into the UI. The panel used to state the first
   * AOI's figures as literals, so a second site — which at that moment had no surface top at all —
   * displayed a confident, precise and entirely false claim about its own vegetation.
   */
  vegetationStats?: {
    source?: string;
    cellsRaised: number;
    medianLiftM: number;
    p90LiftM: number;
    maxLiftM: number;
    droppedOverWater: number;
  } | null;
}

/**
 * A published piece of civil infrastructure worth protecting, resolved from OpenStreetMap by
 * tools/geodata/resolve_assets.py. The coordinates are real; the protection radius is a planning
 * value the user can move and cites no regulation.
 */
export interface ProtectedAsset {
  id: string;
  name: string;
  /**
   * What the object is. Open-ended on purpose: the resolver emits whatever civil classes the AOI
   * actually contains, and the second site turned out to have no airfield, no lock and no hospital
   * pad — its published infrastructure is two movable bridges. A closed union here would have
   * meant either a type error or, worse, silently dropping the only assets that site has.
   */
  kind: "aerodrome" | "lock" | "helipad" | "bridge" | (string & {});
  osm: string;
  icao?: string;
  iata?: string;
  lat: number;
  lon: number;
  protectionRadiusM: number;
  note?: string;
  runway?: {
    ref: string;
    lengthM: number;
    bearingDeg: number;
    ends: [number, number][];
  };
}

export interface AssetsMeta {
  aoi: string;
  queriedUtc: string;
  source: string;
  licence: string;
  attribution: string;
  radiusNote: string;
  excluded: string;
  assets: ProtectedAsset[];
}

export interface TerrainData {
  meta: HeightmapMeta;
  elevation: Float32Array;
  land: Uint8Array;
  drape: ImageBitmap;
  shell: { meta: ShellMeta; elevation: Float32Array } | null;
  los: { meta: LosMeta; surfaceM: Float32Array } | null;
  assets: AssetsMeta | null;
  tracks: {
    meta: TracksMeta;
    x: Int16Array;
    z: Int16Array;
    t: Uint16Array;
    speed: Uint8Array;
  } | null;
  buildings: {
    meta: BuildingsMeta;
    x: Int16Array;
    y: Uint16Array;
    z: Int16Array;
  } | null;
  /** Milliseconds spent per stage. Measured because the first frame is a budget item, not a feel. */
  timings: Record<string, number>;
}

export async function loadTerrain(aoiId: string, onProgress: Progress): Promise<TerrainData> {
  const BASE = basePath(aoiId);
  const timings: Record<string, number> = {};
  const mark = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    const value = await work();
    timings[name] = Math.round(performance.now() - started);
    return value;
  };

  onProgress("Gelände", 0, 5);
  const meta = await fetchJson<HeightmapMeta>(BASE, "heightmap_4m.json");

  const elevation = await mark("heightmap", async () => {
    const raw = await fetchBinary(BASE, meta.file);
    const quantised = new Uint16Array(raw);
    const expected = meta.width * meta.height;
    if (quantised.length !== expected) {
      throw new Error(`heightmap is ${quantised.length} cells, expected ${expected}`);
    }
    const out = new Float32Array(expected);
    for (let i = 0; i < expected; i += 1) {
      out[i] = meta.heightMinM + quantised[i] * meta.heightScale;
    }
    return out;
  });
  onProgress("Gelände", 1, 5);

  const land = await mark("landmask", async () =>
    new Uint8Array(await fetchBinary(BASE, meta.landMaskFile)));
  onProgress("Horizont", 2, 5);

  const shell = await mark("shell", async () => {
    try {
      const sMeta = await fetchJson<ShellMeta>(BASE, "shell_90m.json");
      const raw = new Uint16Array(await fetchBinary(BASE, sMeta.file));
      const out = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) {
        out[i] = sMeta.heightMinM + raw[i] * sMeta.heightScale;
      }
      return { meta: sMeta, elevation: out };
    } catch (error) {
      console.warn("shell not loaded:", error);
      return null;
    }
  });
  onProgress("Luftbild", 3, 5);

  const drape = await mark("drape", async () => {
    const blob = await (await fetch(`${BASE}/drape.jpg`)).blob();
    return await createImageBitmap(blob);
  });
  onProgress("Gebäude", 4, 5);

  const buildings = await mark("buildings", async (): Promise<TerrainData["buildings"]> => {
    try {
      const bMeta = await fetchJson<BuildingsMeta>(BASE, "buildings_lod2.json");
      const bin = await fetchBinary(BASE, bMeta.file);
      const n = bMeta.vertexCount;
      return {
        meta: bMeta,
        x: new Int16Array(bin, 0, n),
        y: new Uint16Array(bin, 2 * n, n),
        z: new Int16Array(bin, 4 * n, n),
      };
    } catch (error) {
      // Buildings are optional: the terrain is still worth showing without them, and a partial
      // pipeline run is a normal state on a fresh clone.
      console.warn("buildings not loaded:", error);
      return null;
    }
  });
  onProgress("fertig", 5, 5);

  const los = await mark("los", async (): Promise<TerrainData["los"]> => {
    try {
      const lMeta = await fetchJson<LosMeta>(BASE, "los_16m.json");
      const raw = await fetchBinary(BASE, lMeta.file);
      const quantised = new Uint16Array(raw);
      const surfaceM = new Float32Array(quantised.length);
      for (let i = 0; i < quantised.length; i += 1) {
        surfaceM[i] = quantised[i] * lMeta.heightScale + lMeta.heightMinM;
      }
      return { meta: lMeta, surfaceM };
    } catch (error) {
      console.warn("line-of-sight surface not loaded:", error);
      return null;
    }
  });

  const tracks = await mark("tracks", async (): Promise<TerrainData["tracks"]> => {
    try {
      const tMeta = await fetchJson<TracksMeta>(BASE, "tracks.json");
      const bin = await fetchBinary(BASE, tMeta.file);
      const n = tMeta.pointCount;
      return {
        meta: tMeta,
        x: new Int16Array(bin, 0, n),
        z: new Int16Array(bin, 2 * n, n),
        t: new Uint16Array(bin, 4 * n, n),
        speed: new Uint8Array(bin, 6 * n, n),
      };
    } catch (error) {
      console.warn("tracks not loaded:", error);
      return null;
    }
  });

  const assets = await mark("assets", async (): Promise<TerrainData["assets"]> => {
    try {
      return await fetchJson<AssetsMeta>(BASE, "assets.json");
    } catch (error) {
      // Optional, like the other layers: without it the counter-UAS scenario simply has nothing
      // to point at, and the app says so rather than inventing an object.
      console.warn("protected assets not loaded:", error);
      return null;
    }
  });

  return { meta, elevation, land, drape, shell, los, assets, tracks, buildings, timings };
}
