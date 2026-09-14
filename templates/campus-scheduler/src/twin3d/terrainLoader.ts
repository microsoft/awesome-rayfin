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
 * How long one chunk may take before the download is called dead.
 *
 * Generous on purpose: the largest asset here is 18.9 MB and a slow conference network delivers it
 * in chunks seconds apart, so a tight limit would abort loads that were going to succeed. Measured
 * healthy loads complete end to end in 8-13 s, so twenty seconds of TOTAL SILENCE is not slowness,
 * it is a dead stream.
 */
const STALL_TIMEOUT_MS = 20_000;

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

  /**
   * Read a response to completion, reporting as the bytes arrive.
   *
   * ⚠️ A STALLED STREAM USED TO HANG THE APP FOREVER, BEHIND A BAR THAT LOOKED FULL. This loop had
   * no timeout: if the body stopped delivering, `reader.read()` never settled and the campus never
   * appeared. Observed once on the live LMU build — the heaviest asset in the app at 18.9 MB —
   * sitting at "Schritt 3 von 4, 18,9 / 18,9 MB" indefinitely with the rest of the UI alive and no
   * console error. It looked like slow work rather than a dead fetch, and it is not reproducible:
   * eight further loads, including four of LMU straight after another AOI, all completed in 8-13 s.
   *
   * ⚠️ AND THE PROGRESS TEXT IS WHY IT LOOKED FINISHED. `totalBytes` is declared from METADATA, not
   * from Content-Length, so a stall at 18.87 of 18.90 MB rounds to "18,9 / 18,9" — the display
   * cannot distinguish "done" from "one chunk short" and the operator has no way to tell.
   *
   * So a stall now FAILS, loudly, naming the stage and how far it got. A visible error is worth
   * more than an indefinite wait: the first is a bug report, the second is a demo that never starts.
   */
  async read(response: Response): Promise<ArrayBuffer> {
    if (!this.report || !response.body) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await this.readOrStall(reader);
      if (done) break;
      chunks.push(value!);
      received += value!.byteLength;
      this.loaded += value!.byteLength;
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

  /** One `reader.read()`, but it gives up instead of waiting forever. */
  private readOrStall(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Cancel, or the dead reader keeps the connection and the memory.
        void reader.cancel().catch(() => undefined);
        const got = (this.loaded / 1e6).toFixed(1);
        const want = (this.expected / 1e6).toFixed(1);
        reject(
          new Error(
            `${this.stage}: the download stalled — no data for ${STALL_TIMEOUT_MS / 1000}s ` +
              `at ${got} of ${want} MB. Reload to retry.`
          )
        );
      }, STALL_TIMEOUT_MS);
      reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
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
  report?: ProgressReporter
): Promise<TerrainAssets> {
  const root = `${base}/${aoiId}`;
  const tracker = new StageTracker('terrain', 1, report);

  // Both descriptors first, so every size is declared before a single byte of payload is fetched.
  // Reading the land-cover descriptor lazily instead made the stage total grow partway through,
  // which showed up as the progress bar falling back from 100 % to 90 % — a bar that runs
  // backwards is worse than no bar at all.
  const [terrain, landuse, shell, drape] = await Promise.all([
    fetchJson<TerrainMeta>(`${root}/heightmap.json`),
    // Decoration, and a terrain-only build predates it, so its absence must not fail the load.
    fetchJson<LanduseMeta>(`${root}/landuse.json`).catch(() => null),
    // The horizon. Also optional: without it the core still renders, it just ends in a cliff.
    fetchJson<ShellMeta>(`${root}/shell.json`).catch(() => null),
    // The orthophoto. Optional, and the app is fully usable without it.
    fetchJson<DrapeMeta>(`${root}/drape.json`).catch(() => null),
  ]);

  // The uint16 heightmap, plus the gzipped land-cover raster and the shell. The land-cover figure
  // is its *compressed* size, because that is what actually crosses the wire; counting the size it
  // inflates to would stall the bar at a number the network never has to deliver.
  tracker.addExpected(terrain.width * terrain.height * 2);
  if (landuse) tracker.addExpected(landuse.compressedBytes);
  if (shell) tracker.addExpected(shell.width * shell.height * 2);

  const heightBuffer = await fetchBinary(`${root}/heightmap.u16`, tracker);

  // Integer texture, sampled with texelFetch: the height grid is quantised data, not an image,
  // and any filtering of it would invent elevations that the survey never measured.
  const heightTexture = heightTextureFrom(
    new Uint16Array(heightBuffer),
    terrain.width,
    terrain.height
  );

  const landuseTexture = await loadLanduse(root, landuse, tracker);

  let shellTexture: THREE.DataTexture | null = null;
  if (shell) {
    const shellBuffer = await fetchBinary(`${root}/${shell.file}`, tracker);
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

    // ⚠️ Decoded through an <img>, not `createImageBitmap`.
    //
    // The obvious implementation — `new THREE.Texture(await createImageBitmap(blob))` — renders
    // the drape BLACK as soon as mipmapping is switched on. The texture uploads without error and
    // nothing is logged; every sample simply returns zero, so the campus appears as a black
    // lozenge with correctly-lit buildings standing on it. Disabling mipmaps "fixes" it, at the
    // cost of a shimmering middle distance on the one surface that is always viewed at a grazing
    // angle. Sized down to 4096 px it still failed, so it is the ImageBitmap path itself and not
    // the texture budget.
    //
    // An HTMLImageElement source is the well-trodden path through three's texture upload and
    // mipmaps correctly. The bytes have already been streamed above for the progress bar, so
    // this decodes from a blob URL rather than fetching twice.
    const url = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
    let image: HTMLImageElement;
    try {
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('drape failed to decode'));
        element.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }

    const texture = new THREE.Texture(image);
    // ⚠️ NoColorSpace, deliberately. Every colour in these shaders — the hypsometric ramp, the land
    // cover, the sun and shadow tints — is a hand-picked sRGB value written straight to the
    // framebuffer, because the materials are raw ShaderMaterials and three does no colour
    // management for them. Tagging the photo as sRGB would have the GPU linearise it on sample,
    // and it alone would come out dark and desaturated against everything else.
    texture.colorSpace = THREE.NoColorSpace;
    // ⚠️ **NO MIPMAPS — sampling any generated level renders the drape BLACK.**
    //
    // Symptom: with `generateMipmaps` on and a mipmap min filter, the entire core renders black at
    // every camera distance, with correctly-lit buildings and trees standing on it. Nothing is
    // logged, no WebGL error is raised, and the texture reports as uploaded.
    //
    // Proven to be the mip chain and not the image: keeping generation on but forcing
    // `minFilter = LinearFilter` — which samples level 0 only — renders the photograph perfectly.
    // So level 0 uploads correctly and every generated level comes back empty.
    //
    // Ruled out, each by testing it:
    //   * texture budget      — 8192x6788 (~300 MB chain) and 4096x3394 (~75 MB) both fail
    //   * NPOT dimensions     — a square 4096x4096 raster fails identically
    //   * decode path         — `createImageBitmap` and `HTMLImageElement` both fail
    //   * a second upload     — setting anisotropy after load, forcing `needsUpdate` again
    //   * GPU limits          — MAX_TEXTURE_SIZE is 16384 here, and the JPEG decodes to a
    //                           mean channel value of 98/255, so the source is not dark
    //
    // COST of shipping without them: some aliasing on the ground in the far field, where a mipmap
    // chain would average texels the eye is only sampling one of. It is visible if looked for and
    // it is a great deal better than a black campus. Anisotropy is left unset for the same reason
    // — it only does anything in combination with mipmaps.
    //
    // If this is revisited: supplying a hand-built chain via `texture.mipmaps[]` with
    // `generateMipmaps = false` bypasses the driver call that appears to be failing.
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // ⚠️ **`flipY = false` — this is what puts the photograph on the right ground.**
    //
    // Every raster in this app is stored row 0 = north, and the terrain shader samples all of them
    // through one helper, `gridUv`, which flips V to match. That helper is correct for the
    // heightmap, the land cover and the shell because `THREE.DataTexture` sets `flipY = false`,
    // so their row 0 lands at t = 0.
    //
    // `THREE.Texture` does the opposite: `flipY` defaults to **true**, so the drape's row 0 was
    // uploaded to t = 1 and then flipped a second time in the shader. Two flips put the
    // orthophoto on the terrain mirrored north-south — the campus sits 0.589 of the way down the
    // AOI, so its reflection landed about 370 m too far north, and the buildings, which are
    // placed in world metres and never touched a UV, were left standing on the farmland south of
    // it. Nothing looked broken up close; it read as "the buildings are in the wrong place".
    //
    // Setting it false here gives every raster one convention, which is the assumption `gridUv`
    // was written against. Must be set before `needsUpdate`, or the upload has already happened.
    texture.flipY = false;
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
