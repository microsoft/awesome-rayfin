import * as THREE from 'three';

export interface TerrainFocusPlace {
  id: string;
  name: string;
  u: number;
  v: number;
  groundM: number;
  /** 'launch' or 'landing' for a flying site; absent for a settlement or station. */
  kind?: string;
  /** An independently published elevation, where one exists. Reported, never rendered. */
  publishedEleM?: number;
}

export interface TerrainMeta {
  width: number;
  height: number;
  resolutionM: number;
  heightMinM: number;
  heightMaxM: number;
  heightScale: number;
  origin: { easting: number; northing: number };
  coveragePct: number;
  focusPlaces: TerrainFocusPlace[];
  /** Launch sites and landing zones, resolved from OpenStreetMap. May be absent in older builds. */
  flyingSites?: TerrainFocusPlace[];
  attribution: string;
  sourceAcquisition: string;
}

export interface LanduseMeta {
  /** Raster filename, taken from the descriptor so the resolution is not baked into the app. */
  file: string;
  /** Inflated size, which is also the number of cells: width × height, one byte per class id. */
  bytes: number;
  /** Size on the wire — the raster ships gzipped. */
  compressedBytes: number;
  width: number;
  height: number;
  resolutionM: number;
  classes: Record<string, string>;
  coveragePct: number;
}

export interface TerrainAssets {
  terrain: TerrainMeta;
  heightTexture: THREE.DataTexture;
  /** Surface colour only, and optional — a build without it still renders a mountain. */
  landuse: LanduseMeta | null;
  landuseTexture: THREE.DataTexture | null;
  /** The coarse horizon. Optional: the core alone is a valid, if boxed-in, scene. */
  shell: ShellMeta | null;
  shellTexture: THREE.DataTexture | null;
  /** The orthophoto drape. Optional, and by far the largest asset. */
  drape: DrapeMeta | null;
  drapeTexture: THREE.Texture | null;
}

/**
 * The DOP20 orthophoto covering the core — PLAN §7 phase 1 step 9.
 *
 * A photograph of the ground, not a measurement. Nothing is derived from it and nothing depends on
 * it: the app renders perfectly well without it, just cartographically rather than photoreally.
 */
export interface DrapeMeta {
  file: string;
  width: number;
  height: number;
  resolutionM: number;
  origin: { easting: number; northing: number };
  spanM: { east: number; north: number };
  attribution: string;
  resolutionNote: string;
}

/**
 * The coarse terrain shell that surrounds the core — PLAN §4.1.
 *
 * Carries the core's rectangle in the same UTM metres, because the renderer has to know where to
 * stop drawing the shell and where to blend its elevations into the core's.
 */
export interface ShellMeta {
  file: string;
  width: number;
  height: number;
  resolutionM: number;
  heightMinM: number;
  heightMaxM: number;
  heightScale: number;
  origin: { easting: number; northing: number };
  core: { easting: number; northing: number; widthM: number; heightM: number };
  /**
   * Every core this shell reconciles itself against — PLAN §8.
   *
   * A per-AOI shell has exactly one and it matches `core`. A world shell has one per site, and
   * that is the whole difference between the two.
   */
  cores?: {
    site: string;
    easting: number;
    northing: number;
    widthM: number;
    heightM: number;
  }[];
  transitionBandM: number;
  /** Metres the shell was shifted to sit on the core's vertical datum. Measured, not assumed. */
  seamOffsetM: number;
  attribution: string;
}

/**
 * Thrown when the generated terrain is missing.
 *
 * The pipeline output is tens of megabytes and is deliberately not committed, so a fresh clone
 * has no terrain until `npm run data:build` has run. That is a normal first-run state, not a
 * crash, and the UI treats it as such.
 */
export class TerrainNotBuiltError extends Error {
  constructor(public readonly missing: string) {
    super(`Terrain assets not built: ${missing}`);
    this.name = 'TerrainNotBuiltError';
  }
}

/** Which part of the scene is being fetched, and how far along it is. */
export interface LoadStageProgress {
  stage: 'terrain' | 'drape' | 'buildings' | 'vegetation';
  /** 1-based, for "step 2 of 4". */
  step: number;
  stepCount: number;
  loadedBytes: number;
  /** 0 when nothing has been declared yet — see the note on Content-Length in `StageTracker`. */
  totalBytes: number;
}

export type ProgressReporter = (progress: LoadStageProgress) => void;

export const LOAD_STEP_COUNT = 4;

/**
 * Byte-level progress for one loading stage.
 *
 * Stage-level progress is not enough here. One binary can be most of the total, so a three-step
 * indicator would sit motionless on a single stage for most of the wait — which is the exact
 * impression this is meant to remove.
 *
 * ⚠️ The total does **not** come from Content-Length. The Fabric static host answers these assets
 * with `Transfer-Encoding: chunked` and no length at all, so a header-driven bar renders perfectly
 * against the Vite dev server and is permanently indeterminate once deployed — the one place it
 * matters. It would also be wrong behind gzip, where the declared length describes the compressed
 * body while the stream delivers decompressed bytes.
 *
 * Instead each stage declares what it is about to fetch, computed from metadata that has already
 * arrived: width × height × bytes-per-cell for the rasters, vertices × 6 for the quantised mesh,
 * count × stride for the trees.
 */
export class StageTracker {
  private loaded = 0;
  private expected = 0;
  private lastEmitMs = 0;

  constructor(
    private readonly stage: LoadStageProgress['stage'],
    private readonly step: number,
    private readonly report?: ProgressReporter
  ) {}

  /** Declare bytes this stage will fetch, derived from metadata rather than from headers. */
  addExpected(bytes: number): void {
    if (bytes > 0) this.expected += bytes;
    this.emit(true);
  }

  /** Read a response to completion, reporting as the bytes arrive. */
  async read(response: Response): Promise<ArrayBuffer> {
    if (!this.report || !response.body) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      this.loaded += value.byteLength;
      this.emit();
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.emit(true);
    return merged.buffer;
  }

  /** Throttled: a large body arrives in hundreds of chunks, and each one would re-render React. */
  private emit(force = false): void {
    if (!this.report) return;
    const now = Date.now();
    if (!force && now - this.lastEmitMs < 100) return;
    this.lastEmitMs = now;
    this.report({
      stage: this.stage,
      step: this.step,
      stepCount: LOAD_STEP_COUNT,
      loadedBytes: this.loaded,
      totalBytes: this.expected,
    });
  }
}

async function fetchBinary(url: string, tracker?: StageTracker): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new TerrainNotBuiltError(url);
  return tracker ? tracker.read(response) : response.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new TerrainNotBuiltError(url);
  // A dev server with SPA fallback answers a missing asset with index.html and a 200, so the
  // status code alone does not tell us the file exists.
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new TerrainNotBuiltError(url);
  return response.json() as Promise<T>;
}

/**
 * Load the precomputed terrain for an AOI.
 *
 * Everything here is generated offline by tools/geodata/build_terrain.py. The browser does no
 * resampling and no reprojection — it receives a quantised uint16 height grid and displaces a
 * plane by it.
 */
export async function loadTerrain(
  aoiId: string,
  base = '/terrain',
  report?: ProgressReporter,
  /**
   * Where the shell comes from — PLAN §8.
   *
   * Defaults to this AOI's own shell. A world passes its union shell id instead, so every site
   * shares one horizon; `null` skips the shell entirely, which is what the SECOND core of a world
   * wants — it is joining a scene that already has one.
   */
  shellFrom: string | null = aoiId
): Promise<TerrainAssets> {
  const root = `${base}/${aoiId}`;
  const shellRoot = shellFrom === null ? null : `${base}/${shellFrom}`;
  const tracker = new StageTracker('terrain', 1, report);

  // Both descriptors first, so every size is declared before a single byte of payload is fetched.
  // Reading the land-cover descriptor lazily instead made the stage total grow partway through,
  // which showed up as the progress bar falling back from 100 % to 90 % — a bar that runs
  // backwards is worse than no bar at all.
  const [terrain, landuse, shell, drape] = await Promise.all([
    fetchJson<TerrainMeta>(`${root}/heightmap_4m.json`),
    // Decoration, and a terrain-only build predates it, so its absence must not fail the load.
    fetchJson<LanduseMeta>(`${root}/landuse.json`).catch(() => null),
    // The horizon. Also optional: without it the core still renders, it just ends in a cliff.
    shellRoot
      ? fetchJson<ShellMeta>(`${shellRoot}/shell_30m.json`).catch(() => null)
      : Promise.resolve(null),
    // The orthophoto. Optional, and the app is fully usable without it.
    fetchJson<DrapeMeta>(`${root}/drape.json`).catch(() => null),
  ]);

  // The uint16 heightmap, plus the gzipped land-cover raster and the shell. The land-cover figure
  // is its *compressed* size, because that is what actually crosses the wire; counting the size it
  // inflates to would stall the bar at a number the network never has to deliver.
  tracker.addExpected(terrain.width * terrain.height * 2);
  if (landuse) tracker.addExpected(landuse.compressedBytes);
  if (shell) tracker.addExpected(shell.width * shell.height * 2);

  const heightBuffer = await fetchBinary(`${root}/heightmap_4m.u16`, tracker);

  // Integer texture, sampled with texelFetch: the height grid is quantised data, not an image,
  // and any filtering of it would invent elevations that the survey never measured.
  const heightTexture = heightTextureFrom(
    new Uint16Array(heightBuffer),
    terrain.width,
    terrain.height
  );

  const landuseTexture = await loadLanduse(root, landuse, tracker);

  let shellTexture: THREE.DataTexture | null = null;
  if (shell && shellRoot) {
    const shellBuffer = await fetchBinary(`${shellRoot}/${shell.file}`, tracker);
    shellTexture = heightTextureFrom(new Uint16Array(shellBuffer), shell.width, shell.height);
  }

  const drapeTexture = drape ? await loadDrape(root, drape, report) : null;

  return {
    terrain,
    heightTexture,
    landuse,
    landuseTexture,
    shell,
    shellTexture,
    drape,
    drapeTexture,
  };
}

/**
 * The orthophoto, as a GPU texture.
 *
 * Given its own progress stage because it is the largest single download in the app by a wide
 * margin — folding twelve megabytes into the terrain stage would make that bar crawl for no
 * visible reason.
 */
async function loadDrape(
  root: string,
  drape: DrapeMeta,
  report?: ProgressReporter
): Promise<THREE.Texture | null> {
  try {
    const tracker = new StageTracker('drape', 2, report);
    const response = await fetch(`${root}/${drape.file}`);
    if (!response.ok) return null;

    // A JPEG's size is genuinely unknown until it arrives — unlike the rasters, it is not
    // width x height x bytes-per-cell. Content-Length is used here and only here, and only as a
    // hint: if the host does not send one the bar falls back to counting bytes with no total,
    // which is still more informative than a spinner.
    const declared = Number(response.headers.get('Content-Length') ?? 0);
    if (declared > 0) tracker.addExpected(declared);

    const buffer = await tracker.read(response);
    const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/jpeg' }));

    const texture = new THREE.Texture(bitmap);
    // ⚠️ NoColorSpace, deliberately. Every colour in these shaders — the hypsometric ramp, the land
    // cover, the sun and shadow tints — is a hand-picked sRGB value written straight to the
    // framebuffer, because the materials are raw ShaderMaterials and three does no colour
    // management for them. Tagging the photo as sRGB would have the GPU linearise it on sample,
    // and it alone would come out dark and desaturated against everything else.
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  } catch {
    // The drape is the one layer whose absence costs nothing but photorealism.
    return null;
  }
}

/**
 * A quantised height grid as an integer texture.
 *
 * Integer, and sampled with texelFetch rather than filtered: the grid is measured data, not an
 * image, and interpolating it in hardware would invent elevations the survey never recorded.
 */
function heightTextureFrom(data: Uint16Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RedIntegerFormat,
    THREE.UnsignedShortType
  );
  texture.internalFormat = 'R16UI';
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Land cover classes, for surface colour.
 *
 * Deliberately non-fatal: the raster is decoration, so a build made before this step existed
 * should still render a mountain rather than an error. The shader falls back to the elevation
 * palette wherever it is absent.
 */
async function loadLanduse(
  root: string,
  landuse: LanduseMeta | null,
  tracker?: StageTracker
): Promise<THREE.DataTexture | null> {
  if (!landuse) return null;
  try {
    const response = await fetch(`${root}/${landuse.file}`);
    if (!response.ok) throw new TerrainNotBuiltError(landuse.file);
    const delivered = tracker ? await tracker.read(response) : await response.arrayBuffer();

    // The raster ships gzipped — class ids compress extremely well — because the static host
    // compresses nothing itself. Whether it still *arrives* gzipped depends on the server:
    // anything that decides to set Content-Encoding will have inflated it already. So the test is
    // on the content rather than on a header or a filename: 1f 8b is the gzip magic number.
    const head = new Uint8Array(delivered, 0, Math.min(2, delivered.byteLength));
    const stillCompressed = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
    const buffer = stillCompressed
      ? await new Response(
          new Blob([delivered]).stream().pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer()
      : delivered;

    // A truncated or half-written raster would otherwise reach the GPU and paint the slopes with
    // whatever happened to follow it in memory.
    if (buffer.byteLength !== landuse.width * landuse.height) {
      throw new Error(
        `land cover is ${buffer.byteLength} bytes, expected ${landuse.width * landuse.height}`
      );
    }

    const landuseTexture = new THREE.DataTexture(
      new Uint8Array(buffer),
      landuse.width,
      landuse.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedByteType
    );
    landuseTexture.internalFormat = 'R8UI';
    // Class ids must never be interpolated — the average of scree and forest is a road.
    landuseTexture.minFilter = THREE.NearestFilter;
    landuseTexture.magFilter = THREE.NearestFilter;
    landuseTexture.needsUpdate = true;

    return landuseTexture;
  } catch {
    return null;
  }
}
