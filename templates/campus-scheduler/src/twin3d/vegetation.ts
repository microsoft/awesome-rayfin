import * as THREE from 'three';

import { StageTracker, type ProgressReporter } from './terrainLoader';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_GAIN, SUN_TINT } from './terrainMaterial';

/**
 * Vegetation layer — real trees, from the measured surface model.
 *
 * Every instance stands where the difference between DOM1 and DGM1 says a tree stands, is as tall
 * as that difference measured it, and is as wide as the canopy around it measured. Nothing is
 * scattered to look good: it all comes out of `tools/geodata/build_vegetation.py`.
 *
 * There are two crown forms, and which one a tree gets is also measured. The pipeline records how
 * high the canopy still stands a short way out from each apex: a conifer has already fallen away,
 * a broadleaf has not. That separates a spire from a dome. It is a statement about crown *form*,
 * which correlates with conifer against broadleaf without being a species identification — and it
 * holds up, because the conical trees come out in patches at more than twice the background rate,
 * the way planted stands actually sit on a hillside.
 *
 * Three things make ~390 000 trees affordable:
 *
 * * **Chunking.** One instanced mesh per kilometre cell and crown form, each with its own bounding
 *   sphere, so the frustum discards most of the wood before it reaches the GPU. A single mesh for
 *   the whole AOI would submit every tree on every frame no matter where the camera pointed.
 * * **Small crowns.** 24 triangles for a conifer, 30 for a broadleaf, including a three-sided
 *   trunk. The trunk was left out originally as invisible, which was true of the opening shot and
 *   wrong everywhere else: the camera comes down to 250 m, and at that range a floating crown is
 *   exactly what looks unreal.
 * * **A random turn about the vertical.** Free, and without it six-sided crowns all face the same
 *   way and the wood looks stamped rather than grown.
 *
 * The scene has no lights — terrain and buildings each bake their own shading — so this shades
 * itself from the same low north-west sun. Without that the wood would sit on the hillside looking
 * lit from somewhere else.
 */

export interface VegetationMeta {
  count: number;
  stride: number;
  attribution: string;
  minHeightM: number;
  note: string;
  /** Crown taper below which the measured form is conical. Absent in builds before it existed. */
  coniferShapeMax?: number;
  conicalShare?: number;
  /**
   * Whether the source distinguishes species at all.
   *
   * False for the Bavarian cadastre, which records position and height only. When it is false the
   * renderer draws one neutral crown rather than inventing a distinction.
   */
  formKnown?: boolean;
}

export interface VegetationLayer {
  group: THREE.Group;
  meta: VegetationMeta;
  /** Instances actually uploaded, which is what the renderer is paying for. */
  drawn: number;
  chunks: number;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const CHUNK_M = 1000;

/** A ring of the crown's silhouette: radius as a fraction of the crown, height as a fraction. */
interface Ring {
  y: number;
  r: number;
}

/**
 * Build a surface of revolution from a silhouette, six-sided.
 *
 * A radius of zero closes the shape into a point, so a profile can start and end in an apex and
 * everything between is a band. Both crown forms and the trunk come out of this, which keeps the
 * two trees genuinely comparable rather than two unrelated models.
 */
function lathe(profile: Ring[], sides: number, into: { positions: number[]; normals: number[] }) {
  const { positions, normals } = into;
  const cos: number[] = [];
  const sin: number[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    cos.push(Math.cos(a));
    sin.push(Math.sin(a));
  }

  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    for (const v of [a, b, c]) {
      positions.push(v.x, v.y, v.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  };

  for (let s = 0; s < profile.length - 1; s++) {
    const low = profile[s];
    const high = profile[s + 1];
    for (let i = 0; i < sides; i++) {
      const a0 = new THREE.Vector3(cos[i] * low.r, low.y, sin[i] * low.r);
      const a1 = new THREE.Vector3(cos[i + 1] * low.r, low.y, sin[i + 1] * low.r);
      const b0 = new THREE.Vector3(cos[i] * high.r, high.y, sin[i] * high.r);
      const b1 = new THREE.Vector3(cos[i + 1] * high.r, high.y, sin[i + 1] * high.r);

      if (low.r === 0) {
        push(a0, b0, b1);
      } else if (high.r === 0) {
        push(a0, b0, a1);
      } else {
        push(a0, b0, b1);
        push(a0, b1, a1);
      }
    }
  }
}

function finish(into: { positions: number[]; normals: number[] }): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(into.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(into.normals, 3));
  return geometry;
}

/** A trunk, three-sided because at these ranges it is a line with a width. */
const TRUNK: Ring[] = [
  { y: 0, r: 0.075 },
  { y: 0.3, r: 0.055 },
];

/**
 * Conifer: a narrow spire in tiers. 24 triangles.
 *
 * Drawn for the trees whose measured canopy falls away like a cone within a few metres of the
 * apex — see `crown_from_profile` in build_vegetation.py. The tiering is a drawing convention;
 * what the data supports is the taper, and that is what the silhouette carries.
 */
function coniferGeometry(): THREE.BufferGeometry {
  const into = { positions: [] as number[], normals: [] as number[] };
  lathe(TRUNK, 3, into);
  lathe([{ y: 0.16, r: 1.0 }, { y: 0.58, r: 0 }], 6, into);
  lathe([{ y: 0.42, r: 0.72 }, { y: 0.8, r: 0 }], 6, into);
  lathe([{ y: 0.68, r: 0.44 }, { y: 1.0, r: 0 }], 6, into);
  return finish(into);
}

/**
 * Broadleaf: a rounded crown on a short bole. 30 triangles.
 *
 * The extra ring over the old bicone is what reads as "round" rather than "pointed" once the
 * camera comes down into the valley, which is where these are actually looked at.
 */
function broadleafGeometry(): THREE.BufferGeometry {  const into = { positions: [] as number[], normals: [] as number[] };
  lathe(TRUNK, 3, into);
  lathe(
    [
      { y: 0.26, r: 0 },
      { y: 0.52, r: 1.0 },
      { y: 0.78, r: 0.82 },
      { y: 1.0, r: 0 },
    ],
    6,
    into
  );
  return finish(into);
}

/**
 * Neutral crown, for a source that records no species.
 *
 * ⚠️ Used whenever `formKnown` is false, which is the case for the Bavarian `einzelbaeume`
 * cadastre: it gives position, ground height and tree height, and nothing about what kind of tree
 * it is. The Allgäu Bergwald is overwhelmingly spruce, so drawing every tree as a conifer would
 * *look* right — and would be a species claim the data cannot support, on a hillside where larch,
 * beech and mixed stands all occur.
 *
 * So the silhouette sits deliberately between the two: tapered enough not to read as an orchard,
 * rounded enough not to read as a spruce plantation. It says "a tree", which is exactly what the
 * source says.
 */
function neutralGeometry(): THREE.BufferGeometry {
  const into = { positions: [] as number[], normals: [] as number[] };
  lathe(TRUNK, 3, into);
  lathe(
    [
      { y: 0.2, r: 0 },
      { y: 0.42, r: 1.0 },
      { y: 0.72, r: 0.66 },
      { y: 1.0, r: 0 },
    ],
    6,
    into
  );
  return finish(into);
}

/**
 * Shading matched to the terrain: the same sun direction, the same warm/cool tints and the same
 * exposure, so the wood belongs to the hillside it stands on.
 *
 * ⚠️ These come from the shared constants rather than being written out again. They were literals
 * here once, and when the terrain palette was brightened for a sunny day this layer kept the old
 * grey ramp — a forest lit for different weather than the mountain under it.
 */
function crownMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
    vertexShader: /* glsl */ `
      in float aGround;

      out vec3 vColour;
      out vec3 vNormalW;

      void main() {
        vColour = instanceColor;
        vNormalW = normalize(mat3(instanceMatrix) * normal);
        vec4 world = instanceMatrix * vec4(position, 1.0);
        // Ground height is added here rather than baked into the instance matrix, which keeps the
        // per-chunk bounding spheres computable without walking 388,000 matrices.
        world.y += aGround;
        gl_Position = projectionMatrix * modelViewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform vec3 uSunDirection;
      uniform vec3 uSunTint;
      uniform vec3 uShadowTint;
      uniform vec2 uLightRamp;

      in vec3 vColour;
      in vec3 vNormalW;
      out vec4 fragColor;

      void main() {
        float lambert = clamp(dot(normalize(vNormalW), normalize(uSunDirection)), 0.0, 1.0);
        vec3 light = mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);
        fragColor = vec4(vColour * light, 1.0);
      }
    `,
    glslVersion: THREE.GLSL3,
  });
}

/**
 * Deterministic pseudo-random in [0,1) from an index, so the same tree always gets the same tint.
 * Without a stable choice the whole wood would change colour on every reload.
 */
function stableUnit(index: number): number {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface Tree {
  x: number;
  z: number;
  y: number;
  radius: number;
  height: number;
  colour: THREE.Color;
  conifer: boolean;
  /** False when the source records no species, in which case `conifer` means nothing. */
  formKnown: boolean;
  turn: number;
}

export async function loadVegetation(
  aoiId: string,
  base = '/terrain',
  report?: ProgressReporter
): Promise<VegetationLayer | null> {
  const root = `${base}/${aoiId}`;

  const metaResponse = await fetch(`${root}/vegetation.json`);
  if (!metaResponse.ok) return null;
  if (!(metaResponse.headers.get('content-type') ?? '').includes('json')) return null;
  const meta = (await metaResponse.json()) as VegetationMeta;

  const binaryResponse = await fetch(`${root}/vegetation.bin`);
  if (!binaryResponse.ok) return null;
  const tracker = new StageTracker('vegetation', 4, report);
  tracker.addExpected(meta.count * meta.stride); // one fixed-width record per tree
  const view = new DataView(await tracker.read(binaryResponse));
  const count = Math.min(meta.count, Math.floor(view.byteLength / meta.stride));

  // A wood is never one green. Two ends of a range keep it from reading as plastic. Conifers sit
  // at the colder, darker end and broadleaves at the warmer, lighter one, which is how the two
  // read on a hillside and reinforces a distinction the geometry already makes.
  //
  // Brightened along with the terrain: a spring hillside in full sun, not a dark plantation. These
  // are albedos, and the shared warm/cool light in `crownMaterial` does the rest.
  const conifer = { dark: new THREE.Color(0.2, 0.33, 0.24), light: new THREE.Color(0.36, 0.5, 0.34) };
  const broadleaf = { dark: new THREE.Color(0.33, 0.44, 0.23), light: new THREE.Color(0.58, 0.66, 0.37) };
  // Used when the source records no species: the middle of the same range, so a wood of unknown
  // trees still has depth without implying which kind they are.
  const unknown = { dark: new THREE.Color(0.26, 0.38, 0.24), light: new THREE.Color(0.48, 0.58, 0.36) };

  // ⚠️ Three states, not two. A build can measure the form (Rhineland-Palatinate, from DOM1 minus
  // DGM1), predate the field entirely (8-byte stride), or come from a source that simply does not
  // record species — which is the Bavarian cadastre. The third case must not silently fall into
  // one of the first two, because both of them draw a species.
  const formKnown = meta.formKnown !== false && meta.stride >= 9;
  const coniferMax = (meta.coniferShapeMax ?? 0.62) * 255;

  const buckets = new Map<string, Tree[]>();

  for (let i = 0; i < count; i++) {
    const offset = i * meta.stride;
    const x = view.getInt16(offset, true);
    const z = view.getInt16(offset + 2, true);
    const ground = view.getUint16(offset + 4, true) / 10;
    const height = view.getUint8(offset + 6) * 0.2;
    const radius = view.getUint8(offset + 7) / 10;
    const isConifer = formKnown && view.getUint8(offset + 8) < coniferMax;

    const palette = formKnown ? (isConifer ? conifer : broadleaf) : unknown;
    const tint = palette.dark.clone().lerp(palette.light, stableUnit(i));
    // Taller trees read slightly darker, which is what a closed canopy looks like from above.
    tint.multiplyScalar(1.08 - Math.min(height, 40) / 140);

    // Species first, then chunk: the frustum still gets a per-kilometre bound to cull against, but
    // each draw call carries a single crown form.
    const form = formKnown ? (isConifer ? 'c' : 'b') : 'u';
    const key = `${form}:${Math.floor(x / CHUNK_M)}:${Math.floor(z / CHUNK_M)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    // A tree keeps close to its own height — the 1.15 is a crown allowance, not a terrain factor.
    // The ground height is carried separately from the matrix so the per-chunk bounding spheres
    // can be computed without walking every instance.
    bucket.push({
      x,
      z,
      y: ground,
      radius,
      height: height * 1.15,
      colour: tint,
      conifer: isConifer,
      formKnown,
      turn: stableUnit(i + 991) * Math.PI * 2,
    });
  }

  const coniferGeom = coniferGeometry();
  const broadleafGeom = broadleafGeometry();
  const neutralGeom = neutralGeometry();
  const material = crownMaterial();
  const group = new THREE.Group();

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /** Per-chunk bounds at zero ground offset, corrected below for the offset the shader adds. */
  const chunkBounds: { mesh: THREE.InstancedMesh; radius: number; low: number; high: number }[] = [];

  for (const trees of buckets.values()) {
    const first = trees[0];
    const source = !first.formKnown ? neutralGeom : first.conifer ? coniferGeom : broadleafGeom;
    const mesh = new THREE.InstancedMesh(source, material, trees.length);
    const ground = new Float32Array(trees.length);
    let low = Infinity;
    let high = -Infinity;

    trees.forEach((tree, index) => {
      position.set(tree.x, 0, tree.z);
      scale.set(tree.radius, tree.height, tree.radius);
      // A random turn about the vertical. Six-sided crowns all facing the same way make a wood
      // look stamped; this costs nothing and removes the pattern.
      quaternion.setFromAxisAngle(up, tree.turn);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tree.colour);
      ground[index] = tree.y;
      if (tree.y < low) low = tree.y;
      if (tree.y > high) high = tree.y;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Only the ground height is an instanced attribute; everything else stays in the matrix, which
    // keeps the per-chunk bounding spheres cheap to correct below.
    mesh.geometry = source.clone();
    mesh.geometry.setAttribute('aGround', new THREE.InstancedBufferAttribute(ground, 1));

    // Per-chunk bounds are what let the frustum throw most of the wood away. They have to account
    // for the ground offset the shader adds, which the matrices no longer carry — otherwise the
    // sphere is wrong and whole hillsides of trees blink out at the edge of the view.
    mesh.computeBoundingSphere();
    chunkBounds.push({
      mesh,
      radius: mesh.boundingSphere?.radius ?? 0,
      low: Number.isFinite(low) ? low : 0,
      high: Number.isFinite(high) ? high : 0,
    });
    group.add(mesh);
  }

  // The frustum culls against these spheres, and they have to account for the ground offset the
  // shader adds after the matrix — otherwise the sphere sits at y=0 and whole hillsides of trees
  // blink out at the edge of the view.
  for (const chunk of chunkBounds) {
    const sphere = chunk.mesh.boundingSphere;
    if (!sphere) continue;
    sphere.center.y = (chunk.low + chunk.high) / 2;
    sphere.radius = chunk.radius + (chunk.high - chunk.low) / 2;
  }

  return {
    group,
    meta,
    drawn: count,
    chunks: buckets.size,
    setVisible(visible: boolean) {
      group.visible = visible;
    },
    dispose() {
      coniferGeom.dispose();
      broadleafGeom.dispose();
      material.dispose();
      for (const chunk of chunkBounds) chunk.mesh.geometry.dispose();
      group.clear();
    },
  };
}
