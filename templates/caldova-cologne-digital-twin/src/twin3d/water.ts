import * as THREE from 'three';

/**
 * The water surface — PLAN Phase 6.
 *
 * A river is the one genuinely flat thing in the scene, and that is why leaving it to the terrain
 * looks wrong: DGM1 is a bare-earth model, so the Neckar arrives as a shallow trough with a few
 * centimetres of noise in it and renders like wet tarmac under the same hillshade as the hills.
 *
 * This draws it as what it is. The geometry is measured — OpenStreetMap extent, DGM1 elevation —
 * and only the *appearance* is modelled:
 *
 * **Two crossed wave trains, not a noise texture.** Real water at this scale reads as directional
 * ripple, and two sine trains at an angle give that for four lines of GLSL and no texture fetch.
 * They perturb the normal only; the surface stays geometrically flat, because it is flat.
 *
 * **Fresnel, because it is most of what water looks like.** Head-on, you see through to a dark
 * green-brown bed; at a grazing angle you see sky. Without it the river reads as coloured plastic,
 * and the Neckarfront view is almost entirely grazing angle.
 *
 * ⚠️ **No reflection pass.** A planar reflection would mean rendering the scene twice, and at
 * 6 417 buildings that is a real cost for something the Fresnel sky term already suggests. The
 * specular highlight moves with the sun, which is the part people actually read as "water".
 */

const VERTEX = /* glsl */ `
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCameraPos;

out vec3 vWorld;
out vec3 vToCamera;

void main() {
  vWorld = position;
  vToCamera = uCameraPos - position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in vec3 vWorld;
in vec3 vToCamera;
out vec4 outColour;

uniform vec3  uSun;
uniform vec3  uSkyColour;
uniform float uTime;
uniform float uOpacity;

// Shallow river water over a silt bed: green-brown, not tropical blue.
const vec3 DEEP    = vec3(0.086, 0.152, 0.141);
const vec3 SHALLOW = vec3(0.184, 0.271, 0.243);

void main() {
  vec3 toCamera = normalize(vToCamera);
  float distance = length(vToCamera);

  // ⚠️ Fade the ripple with distance, or it ALIASES into moiré stripes.
  //
  // The wave trains are ~1.3 and ~2.1 m long, which is honest for river chop. Past a few hundred
  // metres a screen pixel covers more ground than that, the sine is undersampled, and the surface
  // breaks into a fixed herringbone that reads as a texture bug — made far worse by the tight
  // specular exponent, which turns a tiny normal change into a bright one. Ripples you cannot
  // resolve should not be drawn, which is also what real water does.
  float ripple = 1.0 / (1.0 + distance * 0.010);

  // Two crossed wave trains. Metres, so the wavelengths are real: ~2.1 m and ~1.3 m.
  float a = sin(vWorld.x * 2.99 + uTime * 1.1) * 0.5 + sin(vWorld.z * 2.31 - uTime * 0.8) * 0.5;
  float b = sin((vWorld.x * 0.71 + vWorld.z * 0.71) * 4.83 + uTime * 1.7);
  vec3 normal = normalize(
    vec3((a * 0.045 + b * 0.02) * ripple, 1.0, (b * 0.045 - a * 0.02) * ripple)
  );

  // Fresnel: transparent head-on, mirror at a grazing angle. Schlick, with water's F0 of 0.02.
  float facing = clamp(dot(normal, toCamera), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

  vec3 body = mix(DEEP, SHALLOW, facing);
  vec3 colour = mix(body, uSkyColour, fresnel * 0.85);

  // Sun glitter. Tight and bright, because that is what sells a moving surface — but it fades with
  // the ripple that produces it, for the same sampling reason.
  vec3 halfway = normalize(uSun + toCamera);
  float specular = pow(max(dot(normal, halfway), 0.0), 220.0);
  colour += vec3(1.0, 0.97, 0.90) * specular * 0.75 * ripple;

  // Slightly more opaque at grazing angles, matching the Fresnel story.
  outColour = vec4(colour, clamp(uOpacity * (0.72 + fresnel * 0.28), 0.0, 1.0));
}
`;

/**
 * How far the drawn surface sits above its measured level, in metres.
 *
 * ⚠️ **Not cosmetic — without it the river renders as a checkerboard.** Each body is levelled to the
 * MEDIAN bed elevation, which by definition puts about half its cells a few centimetres above the
 * water plane. Those cells win the depth test, the rest lose it, and the result is a 2 m chequer of
 * river and riverbed that looks like a texture bug.
 *
 * 25 cm clears the DGM1's noise over water without visibly flooding the banks — the Neckar's
 * embankment walls here are metres high. The measured level in `water.json` is left untouched,
 * because that is the number anyone would quote; this is a rendering bias and lives with the
 * renderer.
 */
const RENDER_LIFT_M = 0.25;

interface WaterBody {
  id: number;
  levelM: number;
  areaM2: number;
  cells: number;
}

interface WaterMeta {
  aoi: string;
  vertexCount: number;
  triangleCount: number;
  bodyCount: number;
  quantisation: { xzScaleM: number; yScaleM: number; yOffsetM: number };
  bodies: WaterBody[];
}

export interface WaterLayer {
  mesh: THREE.Mesh;
  meta: WaterMeta;
  /** Advance the ripple. `elapsed` is seconds since the scene started. */
  update(elapsed: number, cameraPosition: THREE.Vector3): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export async function loadWater(
  aoiId: string,
  base = '/terrain',
  sunDirection: THREE.Vector3,
  skyColour: THREE.Color
): Promise<WaterLayer | null> {
  const root = `${base}/${aoiId}`;
  const metaResponse = await fetch(`${root}/water.json`);
  // No water is a normal fact about a site — Garching has none worth drawing.
  if (!metaResponse.ok) return null;

  const meta: WaterMeta = await metaResponse.json();
  const binResponse = await fetch(`${root}/water.bin`);
  if (!binResponse.ok) return null;
  const buffer = await binResponse.arrayBuffer();

  const { xzScaleM, yScaleM, yOffsetM } = meta.quantisation;
  const n = meta.vertexCount;
  const qx = new Int16Array(buffer, 0, n);
  const qy = new Uint16Array(buffer, n * 2, n);
  const qz = new Int16Array(buffer, n * 4, n);

  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = qx[i] * xzScaleM;
    positions[i * 3 + 1] = yOffsetM + qy[i] * yScaleM + RENDER_LIFT_M;
    positions[i * 3 + 2] = qz[i] * xzScaleM;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uSun: { value: sunDirection.clone().normalize() },
      uSkyColour: { value: new THREE.Vector3(skyColour.r, skyColour.g, skyColour.b) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uCameraPos: { value: new THREE.Vector3() },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  // The surface sits within centimetres of the bed it replaces, so let it win the depth test
  // rather than fight it. renderOrder keeps it above the terrain but below the room prisms.
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  return {
    mesh,
    meta,
    update(elapsed, cameraPosition) {
      material.uniforms.uTime.value = elapsed;
      (material.uniforms.uCameraPos.value as THREE.Vector3).copy(cameraPosition);
    },
    setVisible(visible) {
      mesh.visible = visible;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
