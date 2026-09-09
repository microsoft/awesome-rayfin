import * as THREE from 'three';

import { StageTracker, type ProgressReporter } from './terrainLoader';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_GAIN, SUN_TINT } from './terrainMaterial';

/**
 * LoD2 buildings — real geometry from the Bavarian 3D-Gebäudemodell.
 *
 * Buildings are context, not subject. They are what makes the valley floor recognisable as
 * Oberstdorf and give the eye something of known size to judge 1400 m of relief against, so they
 * are drawn in one quiet colour and carry no data. Anything that varies per building would
 * compete with the flight layers that matter.
 */

/**
 * What the browser needs per building, which is deliberately less than the pipeline knows.
 *
 * Ground rings stay in `buildings_lod2_footprints.json` and never reach the client: they are most
 * of the bytes and nothing on screen uses them.
 */
export interface Lod2Building {
  village: string;
  groundElevM: number;
  vertexStart: number;
  vertexCount: number;
  /**
   * First roof vertex. Everything from `vertexStart` up to here is wall and ground; everything
   * from here to the end of the building is roof. Absent in builds made before the pipeline kept
   * the CityGML surface semantics.
   */
  roofVertexStart?: number;
  /**
   * Wall treatment, from the ALKIS `bldg:function` code and the survey's own footprint and
   * height — see `tools/geodata/building_class.py`. Absent in older builds, which fall back to
   * render.
   */
  wall?: number;
}

export interface Lod2Meta {
  count: number;
  vertexCount: number;
  perVillage: Record<string, number>;
  attribution: string;
  buildings: Lod2Building[];
  /** Absent in builds written before the vertices were quantised. */
  quantisation?: {
    xzScaleM: number;
    yScaleM: number;
    yOffsetM: number;
  };
  /** Present once roof colour has been sampled from the drape. */
  roofColour?: {
    file: string;
    measured: number;
    total: number;
    fallback: [number, number, number];
  };
}

const vertexShader = /* glsl */ `
precision highp float;

attribute float aGround;
attribute vec4 aColour;

out float vHeightAboveGround;
out vec3  vWorld;
out vec3  vAlbedo;
out float vIsRoof;

void main() {
  float heightAboveGround = position.y - aGround;
  vHeightAboveGround = heightAboveGround;

  // rgb is this face's own colour and w flags a roof. Both are filled per building on the client
  // from four bytes per building, not per vertex — see loadBuildings.
  vAlbedo = aColour.rgb;
  vIsRoof = aColour.a;

  // ⚠️ **True height. There is no multiplier here, and there used to be.**
  //
  // This carried "heightAboveGround * 1.35" — inherited from Flut-Insights, where the TERRAIN is
  // vertically exaggerated and buildings had to be stretched to keep up with it. Oberstdorf removed
  // the terrain lever as unnecessary; the building one survived the refactor with a comment
  // claiming LoD2 stores eaves heights, so a village would otherwise read as flat.
  //
  // That claim is false, and the source says so. Bavarian LoD2 carries explicit RoofSurface
  // geometry — 6545 roof surfaces across 2702 buildings in the Tegelberg tiles, 2160 of them
  // genuinely pitched — and build_lod2_mesh.py triangulates every one of them. Measured against
  // the survey's own bldg:measuredHeight attribute, the mesh matches to a MEDIAN DIFFERENCE OF
  // 0.00 m (max 0.83 m). The geometry was already at the full ridge height, so the 1.35 was not a
  // correction: it added 35% of invention on top of a measured value.
  //
  // What that looked like: the median house grew from 6.5 m to 8.7 m, and Neuschwanstein — a
  // castle with a published 65 m tower, modelled here at 88.8 m from the foot of its rock spur —
  // was drawn at 119.8 m. A demo whose whole claim is that every number comes from a survey cannot
  // silently render the survey 35% wrong.
  //
  // What that looked like: the median house grew from 6.5 m to 8.7 m, and Neuschwanstein — a
  // castle with a published 65 m tower, modelled here at 88.8 m from the foot of its rock spur —
  // was drawn at 119.8 m. A demo whose whole claim is that every number comes from a survey cannot
  // silently render the survey 35% wrong.
  vec3 p = position;
  vWorld = p;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec2 uLightRamp;

in float vHeightAboveGround;
in vec3  vWorld;
in vec3  vAlbedo;
in float vIsRoof;

out vec4 fragColor;

void main() {
  // ⚠️ **This was one constant for every building in the valley, and the constant is gone.**
  //
  // It used to be vec3(0.78, 0.68, 0.60) for all 5926 of them, brightened by height as a stand-in
  // for "roofs are lighter than walls". Both parts have been replaced by something the pipeline
  // actually knows:
  //
  //   * The colour is now this building's OWN roof, measured from the DOP20 orthophoto the app
  //     already ships — 99.3 % of Oberstdorf and 99.7 % of the Tegelberg were sampled
  //     successfully. See tools/geodata/roof_colour.py for why that is the only honest source:
  //     the LoD2 survey records no colour of any kind, and OpenStreetMap has building:colour on
  //     0.02 % of buildings here.
  //   * Roof and wall are now the CityGML's own bldg:RoofSurface / bldg:WallSurface classification
  //     rather than a guess from height. Every building in both AOIs carries it.
  //
  // The wall colour is NOT measured and the code should not pretend otherwise — a wall is not
  // visible in a vertical aerial photograph. It is a regional render palette, picked per building
  // on the client.
  vec3 colour = vAlbedo;

  // Contact shading at the base. This is what is left of the old height ramp, and it is kept for a
  // different reason: not to fake a roof, but because the join between a wall and the ground is
  // genuinely darker than the middle of the wall, and without it the buildings read as pasted onto
  // the terrain rather than standing on it. Half a metre of it, on walls only.
  colour *= mix(0.72, 1.0, clamp(vHeightAboveGround / 2.5, 0.0, 1.0)) + 0.28 * vIsRoof;

  // Per-face normal from screen-space derivatives of the world position.
  //
  // The mesh carries positions only — the pipeline fan-triangulates CityGML polygons and never
  // computes normals, and adding them would inflate the download by half. Derivatives give exact
  // flat-shaded normals for free, which is all a LoD2 building needs: its faces ARE flat. Without
  // this the buildings are unlit blocks of constant colour, which looked acceptable against grey
  // terrain and looks pasted-on against sunlit terrain.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lambert = clamp(abs(dot(normal, normalize(uSunDirection))), 0.0, 1.0);
  colour *= mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);

  fragColor = vec4(colour, 1.0);
}
`;

export interface BuildingLayer {
  mesh: THREE.Mesh;
  meta: Lod2Meta;
  dispose(): void;
}

/**
 * Wall treatments, mirroring `tools/geodata/building_class.py`. The pipeline decides which one a
 * building gets from its ALKIS function code and its measured size; this side only paints it.
 */
export const WALL_RENDER = 0;
export const WALL_TIMBER = 1;
export const WALL_WHITEWASH = 2;
export const WALL_CIVIC = 3;
export const WALL_CONCRETE = 4;

/** Bytes per record in `buildings_roof_spans.bin`: uint32 vertexStart + uint8 r,g,b. */
export const SPAN_STRIDE = 7;

/**
 * ⚠️ **A missing optional file does NOT 404 here, and assuming it would was a real bug.**
 *
 * The app is served as a single-page app, so an unknown path returns index.html with HTTP 200.
 * `response.ok` is therefore true for a file that does not exist, and the bytes handed on are HTML
 * — which, read as little-endian vertex offsets, would repaint scattered triangles across the
 * valley in colours taken from `<!doctype html>`. It would look like a rendering glitch rather
 * than a missing file, which is the worst kind of bug to inherit.
 *
 * Caught by probing the live deployment, which reported the spans file as present months before it
 * existed. So a payload has to prove it is the right shape before it is believed.
 */
export function plausiblePayload(
  bytes: Uint8Array | null,
  expectedLength: (length: number) => boolean
): Uint8Array | null {
  if (!bytes || bytes.byteLength === 0) return null;
  return expectedLength(bytes.byteLength) ? bytes : null;
}

/**
 * Wall colour — the one part of a building here that is NOT measured, said plainly.
 *
 * A vertical aerial photograph sees roofs and not walls, so the trick that gives every roof its
 * real colour has nothing to offer the walls. The other candidate was OpenStreetMap, and it was
 * measured rather than assumed: `building:colour` is present on 1 of 4295 buildings at Oberstdorf
 * and 136 of 4242 at the Tegelberg. Too sparse to build a valley on.
 *
 * ⚠️ **But WHAT a building is can be measured, and that turned out to matter far more than
 * expected.** Wall is 68–71 % of a building's 3D surface area in every height band — so the
 * photograph governs barely a third of what the eye sees, and a church at 68 % wall or a 38 m mast
 * at 97 % wall is hardly touched by a roof sample at all. The survey classifies every building
 * (ALKIS `bldg:function`) and measures its footprint and height, and `building_class.py` turns
 * those into a wall class with every code confirmed against the survey's own `gml:name` values.
 *
 * The largest group in the valley is 3341 buildings at a median of 43 m² and 4.2 m — sheds, hay
 * barns and alpine huts like the *Wankhütte* — and they were all wearing the same cream render as
 * the houses. They are boarded now.
 *
 * **So: the class is measured; the colour each class is painted is a convention**, exactly like
 * the tree silhouettes in NOTICE.md. Variation within a class is a stable hash of the building
 * index, never a random number, so the same house is the same colour on every load.
 */
function wallColour(index: number, wallClass: number): [number, number, number] {
  // Stable per-index unit value — the same trick vegetation.ts uses for tree size and hue.
  const noise = (salt: number) => {
    const x = Math.sin(index * 12.9898 + salt) * 43758.5453;
    return x - Math.floor(x);
  };

  switch (wallClass) {
    // Timber: sheds, hay barns, alpine huts, carports. Weathered board goes grey-brown, and the
    // spread is wide because a new larch shed and a century-old barn are not the same thing.
    case WALL_TIMBER: {
      const shade = 0.74 + noise(3.71) * 0.42;
      const grey = noise(9.13) * 0.25;
      return [
        (0.50 + grey * 0.1) * shade,
        (0.39 + grey * 0.12) * shade,
        (0.29 + grey * 0.16) * shade,
      ];
    }
    // Whitewash: a church or chapel, deliberately brighter and cooler than the houses around it,
    // which is how they are built and how they read from a distance.
    case WALL_WHITEWASH: {
      const value = 0.93 + noise(11.5) * 0.05;
      return [value, value * 0.985, value * 0.955];
    }
    // Civic: schools, clinics, the Rathaus. Rendered, but flatter and cooler than a farmhouse.
    case WALL_CIVIC: {
      const value = 0.84 + noise(17.9) * 0.08;
      return [value * 0.985, value * 0.985, value * 0.97];
    }
    // Concrete: galleries, retaining structures, transport works. Not a house colour.
    case WALL_CONCRETE: {
      const value = 0.62 + noise(23.3) * 0.12;
      return [value, value * 0.995, value * 0.97];
    }
    default: {
      // Render: warm off-white lime, drifting a little toward cream or grey.
      const warmth = noise(21.17);
      const value = 0.86 + noise(45.9) * 0.11;
      return [
        value * (0.98 + warmth * 0.02),
        value * (0.955 + warmth * 0.015),
        value * (0.93 - warmth * 0.06),
      ];
    }
  }
}

/**
 * Expand a few bytes per building into a colour per vertex.
 *
 * Split out of the loader so it can be tested, because every way this can go wrong is silent. An
 * off-by-one on the roof split paints a wall with roof colour; a mismatch between the byte order
 * and the `buildings` order gives every house its neighbour's roof. Neither throws, neither looks
 * broken, and both would survive any amount of looking at the screen — which is precisely the bug
 * class that made every aircraft click miss earlier in this project.
 *
 * Three passes, each one allowed to overpaint the last, so that every input is independently
 * optional and a missing file degrades rather than breaks:
 *
 *   1. walls, from the measured building class;
 *   2. roofs, from the building's own pooled orthophoto sample;
 *   3. individual roof surfaces that are demonstrably a different material from the rest of their
 *      own roof — a copper spire on a tiled nave, a solar array on one pitch of a hall.
 *
 * @param roofBytes RGBA per building: rgb is the measured roof colour, a is 255 when it really was
 *   measured and 0 when the building fell back. Null when the pipeline has not sampled yet.
 * @param spanBytes Optional per-surface overrides: uint32 vertexStart + uint8 r,g,b, ascending.
 */
export function buildColourAttribute(
  meta: Pick<Lod2Meta, 'buildings' | 'roofColour'>,
  vertexCount: number,
  roofBytes: Uint8Array | null,
  spanBytes: Uint8Array | null = null
): { colours: Uint8Array; measured: number; surfaces: number } {
  const colours = new Uint8Array(vertexCount * 4);
  const fallback = meta.roofColour?.fallback ?? [199, 174, 153];
  let measured = 0;

  meta.buildings.forEach((building, index) => {
    const end = building.vertexStart + building.vertexCount;
    // ⚠️ Without the split the client cannot know which faces are roofs, so it does not guess:
    // everything becomes wall and the building simply looks plainer than it should. Defaulting the
    // other way — treating an unsplit building as all roof — would smear one sampled colour over
    // the walls too and look confidently wrong.
    const roofStart = building.roofVertexStart ?? end;

    const hasSample = roofBytes !== null && roofBytes[index * 4 + 3] === 255;
    if (hasSample) measured += 1;
    const roofRgb: [number, number, number] = roofBytes
      ? [roofBytes[index * 4], roofBytes[index * 4 + 1], roofBytes[index * 4 + 2]]
      : [fallback[0], fallback[1], fallback[2]];

    const wall = wallColour(index, building.wall ?? WALL_RENDER);
    const wallRgb: [number, number, number] = [
      Math.round(wall[0] * 255),
      Math.round(wall[1] * 255),
      Math.round(wall[2] * 255),
    ];

    for (let v = building.vertexStart; v < end; v++) {
      const isRoof = v >= roofStart;
      const rgb = isRoof ? roofRgb : wallRgb;
      colours[v * 4] = rgb[0];
      colours[v * 4 + 1] = rgb[1];
      colours[v * 4 + 2] = rgb[2];
      colours[v * 4 + 3] = isRoof ? 255 : 0;
    }
  });

  // Pass three: roof surfaces with a material of their own. Each record starts at a vertex and
  // runs until the next record's start or the end of that building's roof, whichever comes first —
  // the "whichever comes first" matters, because a run must never bleed past its own building.
  let surfaces = 0;
  if (spanBytes && spanBytes.byteLength >= SPAN_STRIDE) {
    const view = new DataView(spanBytes.buffer, spanBytes.byteOffset, spanBytes.byteLength);
    const count = Math.floor(spanBytes.byteLength / SPAN_STRIDE);
    // Building ends, sorted, so a span can be clipped to the building it belongs to.
    const ends = meta.buildings
      .map((b) => b.vertexStart + b.vertexCount)
      .sort((a, b) => a - b);

    for (let i = 0; i < count; i++) {
      const offset = i * SPAN_STRIDE;
      const start = view.getUint32(offset, true);
      const r = spanBytes[offset + 4];
      const g = spanBytes[offset + 5];
      const b = spanBytes[offset + 6];

      let stop = i + 1 < count ? view.getUint32((i + 1) * SPAN_STRIDE, true) : vertexCount;
      // First building end strictly greater than start — binary search, since this runs over
      // thousands of spans against thousands of buildings.
      let lo = 0;
      let hi = ends.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > start) hi = mid;
        else lo = mid + 1;
      }
      if (lo < ends.length) stop = Math.min(stop, ends[lo]);
      stop = Math.min(stop, vertexCount);
      if (stop <= start) continue;

      for (let v = start; v < stop; v++) {
        colours[v * 4] = r;
        colours[v * 4 + 1] = g;
        colours[v * 4 + 2] = b;
        colours[v * 4 + 3] = 255;
      }
      surfaces += 1;
    }
  }

  return { colours, measured, surfaces };
}

export async function loadBuildings(
  aoiId: string,
  base = '/terrain',
  report?: ProgressReporter
): Promise<BuildingLayer> {
  const root = `${base}/${aoiId}`;
  const [metaResponse, binResponse, colourResponse, spanResponse] = await Promise.all([
    fetch(`${root}/buildings_lod2.json`),
    fetch(`${root}/buildings_lod2.bin`),
    // Optional. The drape is fetched after the buildings in the default pipeline order, so a first
    // run has no roof colours to sample and this 404s — the app then draws the fallback rather
    // than failing.
    fetch(`${root}/buildings_colour.bin`).catch(() => null),
    // Also optional, and empty for an AOI whose roofs are all one material each.
    fetch(`${root}/buildings_roof_spans.bin`).catch(() => null),
  ]);
  if (!metaResponse.ok || !binResponse.ok) throw new Error('buildings not available');

  const meta: Lod2Meta = await metaResponse.json();
  // By far the largest single download in the app, so it is read as a stream: this is the stretch
  // of the wait where a static indicator looks like a hang. The size is derived from the mesh
  // itself — quantised vertices are int16 x, uint16 y, int16 z, so six bytes each; older builds
  // without a `quantisation` block wrote interleaved float32 at twelve.
  const tracker = new StageTracker('buildings', 3, report);
  const vertexCount = meta.buildings.reduce(
    (highest, b) => Math.max(highest, b.vertexStart + b.vertexCount),
    0
  );
  tracker.addExpected(vertexCount * (meta.quantisation ? 6 : 12));
  const buffer = await tracker.read(binResponse);

  // Vertices arrive quantised and planar: int16 x, uint16 y, int16 z, each in its own block.
  // float32 was more precision than a cadastral building corner carries, and at valley scale the
  // difference was tens of megabytes. Older builds wrote interleaved float32 and carry no
  // `quantisation` block, so they are still read the old way.
  let positions: Float32Array;
  if (meta.quantisation) {
    const { xzScaleM, yScaleM, yOffsetM } = meta.quantisation;
    const n = meta.vertexCount;
    const qx = new Int16Array(buffer, 0, n);
    const qy = new Uint16Array(buffer, n * 2, n);
    const qz = new Int16Array(buffer, n * 4, n);
    positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = qx[i] * xzScaleM;
      positions[i * 3 + 1] = yOffsetM + qy[i] * yScaleM;
      positions[i * 3 + 2] = qz[i] * xzScaleM;
    }
  } else {
    positions = new Float32Array(buffer);
  }

  // Ground elevation per vertex, so the shader can lift the building onto the terrain without
  // stretching the building itself.
  const groundElev = new Float32Array(positions.length / 3);
  meta.buildings.forEach((building) => {
    groundElev.fill(
      building.groundElevM,
      building.vertexStart,
      building.vertexStart + building.vertexCount
    );
  });

  // Colour per vertex, expanded on the client from four bytes per BUILDING.
  //
  // ⚠️ The cheap version of this ships a colour per vertex, and for Oberstdorf that would have
  // been 759 438 × 4 bytes — three megabytes to say 5926 things. Instead the pipeline writes one
  // RGBA quad per building and orders the triangles walls-then-roofs with a single split index, so
  // the whole of the colour data is 23 KB and the expansion happens here in one pass.
  // Optional payloads are validated by shape, not by status — see `plausiblePayload`.
  const readOptional = async (response: Response | null): Promise<Uint8Array | null> =>
    response && response.ok ? new Uint8Array(await response.arrayBuffer()) : null;

  const roofBytes = plausiblePayload(
    await readOptional(colourResponse),
    (length) => length === meta.buildings.length * 4
  );
  const spanBytes = plausiblePayload(
    await readOptional(spanResponse),
    (length) => length % SPAN_STRIDE === 0
  );
  const { colours, measured, surfaces } = buildColourAttribute(
    meta,
    positions.length / 3,
    roofBytes,
    spanBytes
  );

  if (import.meta.env.DEV) {
    console.info(
      `buildings: ${meta.buildings.length}, roof colour measured for ${measured} ` +
        `(${((measured / Math.max(meta.buildings.length, 1)) * 100).toFixed(1)}%), ` +
        `${surfaces} roof surfaces with their own material`
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aGround', new THREE.BufferAttribute(groundElev, 1));
  geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 4, true));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    meta,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
