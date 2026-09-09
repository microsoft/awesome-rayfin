import * as THREE from 'three';

/**
 * Campus Flow ribbons — PLAN Phase 8.
 *
 * Draws the pedestrian load derived in `tools/geodata/build_flows.py`: real cohorts, from real
 * TUMonline bookings, routed on the real OSM footpath graph. Only the head counts are invented.
 *
 * Three decisions worth stating, because each has an obvious wrong alternative:
 *
 * **Ribbons, not lines.** WebGL's `lineWidth` is stuck at 1 px on every desktop driver worth
 * targeting, so a line-based flow map cannot show volume at all — which is the entire quantity
 * being visualised. Each edge is therefore a quad whose width is its load.
 *
 * **Load lives in a texture, not in the geometry.** The width and colour of every edge change on
 * every slot of the scrubber. Rebuilding the vertex buffer 280 times would make the scrubber
 * stutter; uploading a few hundred floats does not, so the geometry is built once and the vertex
 * shader reads the current slot's load per edge.
 *
 * **The dash moves with the flow.** A static ribbon shows where load is; a moving one shows that
 * it is people going somewhere. It is the cheapest possible animation — a scrolling sawtooth along
 * the edge — and it is the difference between a heat map and a crowd.
 */

const VERTEX = /* glsl */ `
in vec3 position;
// WARNING: RawShaderMaterial declares NOTHING for you, not even the built-ins that
// ShaderMaterial injects. Omitting this line does not warn: the shader fails to compile,
// the mesh draws nothing, and mesh.visible stays cheerfully true, so a test asserting on
// visibility passes while the screen is empty. It cost exactly that once already.
in vec3 normal;
in float aEdge;
in float aSide;
in float aAlong;
in float aLength;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uLoad;
uniform float uEdgeCount;
uniform float uMaxLoad;
uniform float uWidthM;

out float vLoad;
out float vDist;
out float vSide;

void main() {
  // Per-edge load for the slot currently on screen. Vertex texture fetch is core in WebGL2.
  float load = texelFetch(uLoad, ivec2(int(aEdge), 0), 0).r;
  vLoad = load / max(uMaxLoad, 1.0);
  // Distance in METRES along the segment, not a 0..1 fraction. The OSM footpath graph splits
  // paths wherever it likes — mean edge length here is 9.4 m, against ribbons up to 20 m wide —
  // so a dash defined per edge puts six rungs across every short segment and the flow reads as a
  // ladder. Metres make the dash the same length everywhere.
  vDist = aAlong * aLength;
  vSide = aSide;

  // A quiet edge should not vanish entirely — it is still a path someone walked.
  float width = uWidthM * (0.28 + 0.72 * sqrt(clamp(vLoad, 0.0, 1.0)));

  // position.xz is the segment point; the perpendicular is packed in the normal slot.
  vec3 p = position;
  p.x += normal.x * aSide * width;
  p.z += normal.z * aSide * width;

  // Each edge is its own quad, and the footpath graph is a chain of short straight ones. At every
  // bend the outer corner leaves a wedge-shaped gap; with edges averaging 9.4 m against a ribbon
  // this wide, those gaps read as a row of separate tiles rather than as a path. Extending each
  // quad along its own direction past both ends makes consecutive quads overlap and closes them.
  // The extension is symmetric, so the sign of the tangent does not matter.
  vec2 tangent = vec2(normal.z, -normal.x);
  float endward = aAlong * 2.0 - 1.0;
  p.x += tangent.x * endward * width;
  p.z += tangent.y * endward * width;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in float vLoad;
in float vDist;
in float vSide;
out vec4 outColour;

uniform float uTime;
uniform float uOpacity;

void main() {
  if (vLoad <= 0.001) discard;

  // Cool where it is quiet, hot where it is not. Deliberately not the condition ramp — these are
  // different quantities and sharing a palette would invite reading one as the other.
  vec3 quiet = vec3(0.35, 0.62, 0.86);
  vec3 busy  = vec3(0.98, 0.45, 0.20);
  vec3 colour = mix(quiet, busy, clamp(vLoad, 0.0, 1.0));

  // The moving dash, on a fixed 16 m pitch. Faster where it is busier, which reads as urgency
  // without being a claim — the note under the panel says this is not a simulation of people.
  float dash = fract(vDist / 16.0 - uTime * (0.22 + vLoad * 0.45));
  float pulse = smoothstep(0.15, 0.55, dash) * 0.45 + 0.55;

  // A ribbon that merely fades out at its edges loses to the ground it is drawn on: a 20 cm
  // orthophoto is high-contrast everywhere, so a translucent wash over it reads as haze rather
  // than as a quantity. Instead the ribbon gets a cartographic casing — an almost-black rim
  // around a solid coloured core — which is what makes a road legible on any printed map.
  // The rim also separates ribbons that overlap at a junction.
  float across = 1.0 - abs(vSide);
  float body = smoothstep(0.0, 0.10, across);   // the whole quad bar the outermost sliver
  float core = smoothstep(0.16, 0.50, across);  // the coloured middle
  vec3 rgb = mix(vec3(0.04, 0.05, 0.09), colour * pulse, core);

  // Load is already carried by width and hue. Opacity carries only a little of it, so that a
  // quiet path stays clearly visible instead of being encoded three times over and vanishing.
  outColour = vec4(rgb, uOpacity * body * (0.66 + 0.34 * clamp(vLoad, 0.0, 1.0)));
}
`;

export interface FlowMeta {
  aoi: string;
  provenance: 'derived';
  syntheticNote: string;
  edgeCount: number;
  slots: number;
  slotMinutes: number;
  firstHour: number;
  days: number;
  quantisation: { xzScaleM: number };
  transitions: number;
  courses: number;
  peakSlot: number;
  slotTotals: number[];
  bottlenecks: { edge: number; load: number }[];
  /** Sparse [edge, slot, load]. */
  load: [number, number, number][];
}

export interface FlowLayer {
  mesh: THREE.Mesh;
  meta: FlowMeta;
  /**
   * Centre and bounding radius of the routed network, in world metres.
   *
   * The flow covers about 500 m of a 2.5 km site — the lecture halls people actually walk
   * between are a small part of a research campus that also contains car parks, fields and a
   * reactor. Framed to the whole AOI the ribbons are a thread a few pixels wide, which reads as
   * "the lens is broken" rather than as "the walking happens here".
   */
  bounds: { centre: THREE.Vector3; radiusM: number };
  /** Show one 15-minute slot, or the whole week when null. */
  setSlot(slot: number | null): void;
  update(elapsed: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export async function loadFlows(
  aoiId: string,
  base = '/terrain',
  groundAt: (x: number, z: number) => number | null
): Promise<FlowLayer | null> {
  const root = `${base}/${aoiId}`;
  const metaResponse = await fetch(`${root}/flows.json`);
  // Most sites have no timetable to derive flow from, and that is not an error.
  if (!metaResponse.ok) return null;
  const meta: FlowMeta = await metaResponse.json();

  const binResponse = await fetch(`${root}/flows.bin`);
  if (!binResponse.ok) return null;
  const raw = new Int16Array(await binResponse.arrayBuffer());
  const scale = meta.quantisation.xzScaleM;

  const edges = meta.edgeCount;
  const positions = new Float32Array(edges * 4 * 3);
  const normals = new Float32Array(edges * 4 * 3);
  const edgeIndex = new Float32Array(edges * 4);
  const side = new Float32Array(edges * 4);
  const along = new Float32Array(edges * 4);
  const lengths = new Float32Array(edges * 4);
  const indices = new Uint32Array(edges * 6);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumY = 0;

  /**
   * A walkable height, or the datum — never NaN.
   *
   * One unusable sample must not be able to poison a vertex buffer. A ribbon segment sitting on
   * the datum is visibly wrong in one place; a NaN makes the geometry's bounding sphere NaN, which
   * breaks frustum culling for the whole layer and can take the ribbon off screen entirely.
   */
  const groundHeight = (sample: number | null | undefined): number =>
    (Number.isFinite(sample) ? (sample as number) : 0) + 1.4;

  for (let e = 0; e < edges; e += 1) {
    const ax = raw[e * 4] * scale;
    const az = raw[e * 4 + 1] * scale;
    const bx = raw[e * 4 + 2] * scale;
    const bz = raw[e * 4 + 3] * scale;

    // Lift onto the terrain. A flow map floating at a constant height over a 127 m hill is a
    // diagram; one that follows the ground is a map of where people actually are.
    //
    // ⚠️ `?? 0` WAS NOT ENOUGH, AND THE GAP IS EXACTLY NaN. Nullish coalescing catches `null` and
    // `undefined` and passes NaN through untouched, so a height sampled at a nodata pixel — or
    // just outside the heightmap — became a NaN vertex position. Three.js then reported
    // "computeBoundingSphere(): Computed radius is NaN" and the ribbon silently misbehaved.
    //
    // It surfaces only on Garching because `flows.bin` ships for that AOI alone. ⚠️ AND IT CAME
    // BACK ONCE: porting the newer layer from Campus-Insights, which still has the `?? 0`,
    // re-introduced it. Re-check this line after any copy from that repo.
    const ay = groundHeight(groundAt(ax, az));
    const by = groundHeight(groundAt(bx, bz));

    minX = Math.min(minX, ax, bx);
    maxX = Math.max(maxX, ax, bx);
    minZ = Math.min(minZ, az, bz);
    maxZ = Math.max(maxZ, az, bz);
    sumY += ay + by;

    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;

    const corners = [
      [ax, ay, az, -1, 0],
      [ax, ay, az, 1, 0],
      [bx, by, bz, 1, 1],
      [bx, by, bz, -1, 1],
    ] as const;

    corners.forEach(([x, y, z, s, t], c) => {
      const v = e * 4 + c;
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = 0;
      normals[v * 3 + 2] = nz;
      edgeIndex[v] = e;
      side[v] = s;
      along[v] = t;
      lengths[v] = length;
    });

    const base4 = e * 4;
    indices.set([base4, base4 + 1, base4 + 2, base4, base4 + 2, base4 + 3], e * 6);
  }

  const bounds = {
    centre: new THREE.Vector3((minX + maxX) / 2, sumY / (edges * 2), (minZ + maxZ) / 2),
    radiusM: Math.hypot(maxX - minX, maxZ - minZ) / 2,
  };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edgeIndex, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Sparse load, expanded per slot once at load so scrubbing is a texture upload and nothing more.
  const perSlot: Float32Array[] = Array.from(
    { length: meta.slots },
    () => new Float32Array(edges)
  );
  const weekTotal = new Float32Array(edges);
  let maxSlotLoad = 1;
  for (const [edge, slot, value] of meta.load) {
    perSlot[slot][edge] = value;
    weekTotal[edge] += value;
    if (value > maxSlotLoad) maxSlotLoad = value;
  }
  const weekMax = weekTotal.reduce((m, v) => Math.max(m, v), 1);

  const texture = new THREE.DataTexture(
    new Float32Array(edges),
    edges,
    1,
    THREE.RedFormat,
    THREE.FloatType
  );
  texture.needsUpdate = true;

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uLoad: { value: texture },
      uEdgeCount: { value: edges },
      uMaxLoad: { value: weekMax },
      uWidthM: { value: 7 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;

  const apply = (values: Float32Array, max: number) => {
    (texture.image.data as Float32Array).set(values);
    texture.needsUpdate = true;
    material.uniforms.uMaxLoad.value = max;
  };
  apply(weekTotal, weekMax);

  return {
    mesh,
    meta,
    bounds,
    setSlot(slot) {
      if (slot === null) apply(weekTotal, weekMax);
      else apply(perSlot[slot] ?? new Float32Array(edges), maxSlotLoad);
    },
    update(elapsed) {
      material.uniforms.uTime.value = elapsed;
    },
    setVisible(visible) {
      mesh.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
