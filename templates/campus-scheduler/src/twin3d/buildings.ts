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
  easting: number;
  northing: number;
  /**
   * Where this building's ROOF triangles begin. Walls and ground are emitted first, so one index
   * per building replaces a roof flag per vertex. Absent in builds made before the split.
   */
  roofVertexStart?: number;
  /** Wall treatment from `building_class.py` — index into `WALL_COLOURS`. */
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
}

const vertexShader = /* glsl */ `
precision highp float;

attribute float aGround;
/** Zustandsnote 1..5, or 0 where no condition model exists. Synthetic — see build_condition.py. */
attribute float aGrade;
/** Year this building is renovated under the active scenario, or 0 for never. */
attribute float aRenovation;
/**
 * Measured roof colour and conventional wall colour, plus a roof flag in w.
 *
 * One vec4 of bytes per vertex, built on the client from four bytes per BUILDING — the mesh
 * emits walls and ground first, then roofs, and roofVertexStart says where the split is. Sending
 * a colour per vertex instead would have cost megabytes for the same picture.
 */
attribute vec4 aColour;

uniform float uYear;

out float vHeightAboveGround;
out vec3  vWorld;
out float vGrade;
out vec3  vAlbedo;
out float vIsRoof;

void main() {
  float heightAboveGround = position.y - aGround;
  vHeightAboveGround = heightAboveGround;
  vAlbedo = aColour.rgb;
  vIsRoof = aColour.a;

  // A renovated building is a grade 1 building from the year the money lands. Doing this on the
  // GPU from a uniform is what lets the year slider scrub at 60 fps across 6 417 buildings —
  // rewriting a 2.6 million-vertex attribute buffer per frame would not.
  vGrade = (aRenovation > 0.5 && uYear >= aRenovation) ? 1.0 : aGrade;

  vec3 p = position;
  // ⚠️ **True height. There is no multiplier here, and there used to be.**
  //
  // This carried "heightAboveGround * 1.35", inherited through Campus-Insights from
  // Flut-Insights, where the TERRAIN is vertically exaggerated and buildings had to be stretched
  // to keep up. Both later apps dropped the terrain lever; the building one survived the
  // refactors behind a comment claiming LoD2 stores eaves heights, so a settlement would
  // otherwise read as flat against 1 400 m of Alpine relief.
  //
  // That claim is false, and Gleitschirm-Insights already disproved it on the same data product
  // and the same builder: Bavarian LoD2 carries explicit RoofSurface geometry, build_lod2_mesh.py
  // triangulates every one of it, and the result matched the survey's own bldg:measuredHeight to
  // a median difference of 0.00 m. The 1.35 was not a correction — it added 35% of invention on
  // top of a measured value.
  //
  // VERIFIED AGAIN HERE before deleting it, because "it was true in the Alps" is exactly the kind
  // of assumption this project keeps catching. Against the 10 937 surveyed buildings inside this
  // AOI, the mesh sits at 1.09x the surveyed median and the shader was putting 1.47x on screen.
  // The residual 9% is a POPULATION artefact, not a height error: build_lod2_mesh.py drops
  // buildings below --min_footprint, so the mesh holds 9 105 of those 10 937 and the small ones
  // it omits are what would pull the median down.
  //
  // A twin whose entire claim is that the geometry comes from a survey cannot render the survey
  // half again too tall. Regensburg is a UNESCO old town on the skyline here; getting this wrong
  // is visible from the first screenshot.
  p.y = position.y;
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
uniform float uOpacity;
uniform float uConditionMix;

in float vHeightAboveGround;
in vec3  vWorld;
in float vGrade;
in vec3  vAlbedo;
in float vIsRoof;

out vec4 fragColor;

/** Zustandsnote 1..5 as colour. Green is fine, red is a building you cannot keep using. */
vec3 gradeColour(float grade) {
  if (grade < 1.5) return vec3(0.30, 0.62, 0.36);
  if (grade < 2.5) return vec3(0.62, 0.73, 0.32);
  if (grade < 3.5) return vec3(0.90, 0.74, 0.28);
  if (grade < 4.5) return vec3(0.87, 0.47, 0.22);
  return vec3(0.76, 0.24, 0.24);
}

void main() {
  // ⚠️ EACH BUILDING'S OWN COLOUR, not one warm beige for the whole city.
  //
  // This was a single vec3(0.78, 0.68, 0.60) for every building on both campuses, with roofs faked
  // as "lighter the higher you are" — which is not what a roof is, and made a flat-roofed
  // institute read as a wall. The roof colour is now MEASURED from the same DOP20 orthophoto the
  // app already drapes over the terrain (98% of Regensburg's buildings), and the wall colour comes
  // from what the cadastre says the building IS. See tools/geodata/roof_colour.py and
  // tools/geodata/building_class.py.
  vec3 colour = vAlbedo;

  // Contact shading: a wall darkens towards the ground where light does not reach, and roofs sit
  // a step brighter than walls because they face the sky. Driven by the semantic roof flag rather
  // than by height, so a low flat roof is still a roof.
  colour *= mix(0.72, 1.0, clamp(vHeightAboveGround / 2.5, 0.0, 1.0)) + 0.28 * vIsRoof;

  // A building with no condition model keeps its neutral colour even with the lens open. Grey
  // means "not modelled", never "fine" — the same rule the room layer uses for missing calendars.
  if (uConditionMix > 0.0 && vGrade > 0.5) {
    colour = mix(colour, gradeColour(vGrade), uConditionMix);
  }

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

  fragColor = vec4(colour, uOpacity);
}
`;

export interface BuildingLayer {
  mesh: THREE.Mesh;
  meta: Lod2Meta;
  /**
   * How varied the paint on this layer actually is, counted off the built attribute.
   *
   * ⚠️ THE METADATA IS NOT THE PICTURE. `meta.roofColour.measured` is what the PIPELINE claims;
   * this counts the distinct colours that reached the buffer the shader reads. The two come apart
   * exactly when it matters — a colour file rejected by the shape check (see
   * `buildColourAttribute`) leaves every roof wearing its wall colour while the JSON still says
   * 99.9 % measured. One flat city is the failure this layer exists to end, so it is the failure
   * worth being able to see from a test.
   */
  colourSpread(): { roofColours: number; wallColours: number };
  /** Fade the shell so the rooms inside it become the subject. 1 = solid, 0 = hidden. */
  setOpacity(opacity: number): void;
  /**
   * Attach a condition model. Both arrays are indexed by building, in `meta.buildings` order.
   * Expanding them to per-vertex attributes costs one pass and is what lets the year slider be a
   * uniform afterwards.
   */
  setCondition(grade: ArrayLike<number>, renovationYear: ArrayLike<number>): void;
  /** Scrub the scenario year. Free — it is a uniform. */
  setConditionYear(year: number): void;
  /** Cross-fade between the neutral colour and the condition tint, 0..1. */
  setConditionMix(mix: number): void;
  dispose(): void;
}

/**
 * Wall colours, one per class from `building_class.py`.
 *
 * ⚠️ THESE ARE A CONVENTION AND THE ONLY PART OF THIS LAYER THAT IS. A wall is not visible in a
 * vertical aerial photograph, so unlike the roofs it cannot be measured; what IS measured is what
 * the building is — its ALKIS function code, its own footprint and height, and for the
 * university's own buildings the operator tag. These are chosen to match Bavarian urban practice
 * and are not a claim about any individual wall. Indexed by the integer the pipeline writes.
 */
export const WALL_COLOURS: readonly [number, number, number][] = [
  [209, 199, 183], // render — warm off-white, the urban default
  [158, 156, 150], // utility — grey blockwork: bin stores, garages, substations
  [231, 228, 220], // whitewash — church, chapel, synagogue, monastery
  [193, 190, 184], // civic — institutional render, flatter and cooler
  [148, 148, 146], // concrete — parking decks and transport works
];

/**
 * Per-vertex colour, expanded on the client from per-building bytes.
 *
 * Three passes, each allowed to overpaint the last: every vertex starts as its building's wall
 * class, roof vertices take the building's measured roof colour, and the few roof SURFACES that
 * are a different material to the rest of their own roof take theirs.
 *
 * ⚠️ VALIDATE THE OPTIONAL FILES BY SHAPE, NOT BY `response.ok`. A static host that falls back to
 * index.html for a missing file answers 200 with HTML, and HTML parsed as vertex offsets repaints
 * random triangles somewhere in the city.
 */
function buildColourAttribute(
  meta: Lod2Meta,
  vertexCount: number,
  roofBytes: ArrayBuffer | null,
  spanBytes: ArrayBuffer | null
): THREE.BufferAttribute {
  const colours = new Uint8Array(vertexCount * 4);
  const roofs = roofBytes && roofBytes.byteLength === meta.buildings.length * 4
    ? new Uint8Array(roofBytes)
    : null;

  meta.buildings.forEach((building, index) => {
    const wall = WALL_COLOURS[building.wall ?? 0] ?? WALL_COLOURS[0];
    const end = building.vertexStart + building.vertexCount;
    const roofStart = building.roofVertexStart ?? end;
    // With no colour file the roof simply takes the wall colour — the building still renders, and
    // the pipeline's own metadata says how many roofs were measured.
    const roof: readonly [number, number, number] = roofs
      ? [roofs[index * 4], roofs[index * 4 + 1], roofs[index * 4 + 2]]
      : wall;

    for (let v = building.vertexStart; v < end; v++) {
      const isRoof = v >= roofStart;
      const source = isRoof ? roof : wall;
      colours[v * 4] = source[0];
      colours[v * 4 + 1] = source[1];
      colours[v * 4 + 2] = source[2];
      // The alpha channel is a roof FLAG, not opacity — the shader shades roofs differently.
      colours[v * 4 + 3] = isRoof ? 255 : 0;
    }
  });

  if (spanBytes && spanBytes.byteLength % 7 === 0 && spanBytes.byteLength > 0) {
    const view = new DataView(spanBytes);
    // Each span runs to the end of its own building, never past it. Binary search for the first
    // building ending STRICTLY after the span starts: `>=` silently drops a span that begins
    // exactly on a boundary.
    const ends = meta.buildings.map((b) => b.vertexStart + b.vertexCount);
    for (let i = 0; i < spanBytes.byteLength; i += 7) {
      const start = view.getUint32(i, true);
      let lo = 0;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > start) hi = mid;
        else lo = mid + 1;
      }
      const limit = Math.min(ends[lo] ?? vertexCount, i + 7 < spanBytes.byteLength ? view.getUint32(i + 7, true) : vertexCount);
      const r = view.getUint8(i + 4);
      const g = view.getUint8(i + 5);
      const b = view.getUint8(i + 6);
      for (let v = start; v < limit; v++) {
        colours[v * 4] = r;
        colours[v * 4 + 1] = g;
        colours[v * 4 + 2] = b;
      }
    }
  }

  return new THREE.BufferAttribute(colours, 4, true);
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
    // Optional: a build made before the colour pass, or one run before the drape was fetched,
    // simply has no colour and falls back to the wall class alone.
    fetch(`${root}/buildings_colour.bin`).catch(() => null),
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

  // Optional colour payloads. Read only when the response is real and the right shape — a static
  // host answering a missing file with index.html returns 200 and HTML.
  const readOptional = async (response: Response | null): Promise<ArrayBuffer | null> => {
    if (!response?.ok) return null;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null;
    return response.arrayBuffer();
  };
  const [roofBytes, spanBytes] = await Promise.all([
    readOptional(colourResponse),
    readOptional(spanResponse),
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aGround', new THREE.BufferAttribute(groundElev, 1));
  const colourAttribute = buildColourAttribute(meta, positions.length / 3, roofBytes, spanBytes);
  geometry.setAttribute('aColour', colourAttribute);
  // Zero until a condition model is attached, which the shader reads as "not modelled" and leaves
  // in the neutral colour. Allocated up front so the attribute always exists.
  const gradeAttribute = new THREE.BufferAttribute(new Float32Array(meta.vertexCount), 1);
  const renovationAttribute = new THREE.BufferAttribute(new Float32Array(meta.vertexCount), 1);
  geometry.setAttribute('aGrade', gradeAttribute);
  geometry.setAttribute('aRenovation', renovationAttribute);
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    // Needed so the shell can step back when a building is opened up. Depth writing stays on at
    // full opacity and is turned off as it fades, or the half-transparent shell would still
    // occlude the rooms standing inside it.
    transparent: true,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
      uOpacity: { value: 1 },
      uConditionMix: { value: 0 },
      uYear: { value: 0 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    meta,
    colourSpread() {
      // Counted off the attribute the shader reads, one sample per building rather than per
      // vertex: a building is one wall colour and one roof colour, so walking 1.6 M vertices to
      // learn 6 417 answers would only make the test slow.
      const bytes = colourAttribute.array as Uint8Array;
      const roofColours = new Set<number>();
      const wallColours = new Set<number>();
      const key = (v: number) =>
        (bytes[v * 4] << 16) | (bytes[v * 4 + 1] << 8) | bytes[v * 4 + 2];
      for (const building of meta.buildings) {
        const end = building.vertexStart + building.vertexCount;
        if (end <= building.vertexStart) continue;
        wallColours.add(key(building.vertexStart));
        const roofStart = building.roofVertexStart;
        if (roofStart !== undefined && roofStart < end) roofColours.add(key(roofStart));
      }
      return { roofColours: roofColours.size, wallColours: wallColours.size };
    },
    setOpacity(opacity: number) {
      material.uniforms.uOpacity.value = opacity;
      // Below full opacity the shell must stop writing depth, or rooms inside it are hidden by a
      // surface you can see through.
      material.depthWrite = opacity > 0.99;
      mesh.visible = opacity > 0.01;
    },
    setCondition(grade, renovationYear) {
      const grades = gradeAttribute.array as Float32Array;
      const years = renovationAttribute.array as Float32Array;
      meta.buildings.forEach((building, index) => {
        grades.fill(grade[index] ?? 0, building.vertexStart, building.vertexStart + building.vertexCount);
        years.fill(
          renovationYear[index] ?? 0,
          building.vertexStart,
          building.vertexStart + building.vertexCount
        );
      });
      gradeAttribute.needsUpdate = true;
      renovationAttribute.needsUpdate = true;
    },
    setConditionYear(year: number) {
      material.uniforms.uYear.value = year;
    },
    setConditionMix(mix: number) {
      material.uniforms.uConditionMix.value = mix;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
