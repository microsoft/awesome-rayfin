import * as THREE from 'three';

import type { TerrainMeta } from './terrainLoader';

/**
 * The sky, and the light coming out of it — PLAN §2.1.
 *
 * The feeling to hit is "a good day in the Allägu": high pressure, thermals working by ten. This
 * app inherited its palette from a flood reconstruction, where muted, unsaturated, paper-like
 * colour was the *point* — it would have been glib to render that night in cheerful greens. Here
 * the opposite is true. A grey mountain says the weather was poor, which is a claim about the day,
 * and the day this is built around was a 1900 m climb to 2692 m in April.
 *
 * ⚠️ These constants are shared by the terrain, the shell and the sky, and they must stay shared.
 * A sky that fades to one colour while the ground hazes toward another draws a hard line along the
 * horizon, which is precisely the "model on a table" impression the shell exists to remove.
 */
export const SKY_ZENITH = 0x3f7fc4;
export const SKY_HORIZON = 0xd7e6f2;

/** Kept for the renderer's clear colour. Anything the sky dome misses should still read as sky. */
export const SKY_COLOUR = SKY_HORIZON;

/**
 * Direction the sun comes FROM, in world space.
 *
 * A single source of truth, passed as a uniform to every material that shades. It used to be a
 * literal repeated in each shader, which is fine right up until one of them is edited: the terrain
 * and the shell would then be lit from different directions and the boundary between them would
 * light up like a seam.
 *
 * North-west and fairly high — the cartographic hillshade convention, which the eye reads as
 * relief rather than as an odd time of day.
 */
export const SUN_DIRECTION: [number, number, number] = [-0.55, 0.62, -0.55];

/**
 * Warm direct sun, cool skylight fill.
 *
 * The cheapest change that makes a render read as a sunny day rather than an overcast one, and it
 * is what actually happens outdoors: direct sunlight is warm, and what fills the shadows is blue
 * light scattered down out of the sky. Shading with one neutral grey ramp — which is what this had
 * — produces a scene that is correctly *shaped* and unmistakably dull.
 *
 * ⚠️ Neither tint exceeds 1.0 in any channel. Combined with the ambient-plus-gain ramp below, the
 * total stays at or under 1.0, which is the rule that stops every sunlit slope clipping to white
 * (PLAN §8 — an earlier version peaked at 1.14 and made the terrain look like plaster).
 */
export const SUN_TINT: [number, number, number] = [1.0, 0.97, 0.89];
export const SHADOW_TINT: [number, number, number] = [0.83, 0.88, 0.99];

/**
 * Ambient floor and directional gain, in that order.
 *
 * The floor is high, and that is the whole trick. On a clear day the sky is an enormous light
 * source, so a slope facing away from the sun is not dark — it is bright and slightly blue. A low
 * ambient floor is what makes rendered mountains look like they were shot in bad weather.
 *
 * ⚠️ The two must sum to at most 1.0, and neither tint above may exceed 1.0 in any channel, or
 * sunlit slopes clip to white and the terrain turns to plaster (PLAN §8).
 */
export const AMBIENT = 0.68;
export const SUN_GAIN = 0.32;

/**
 * Aerial haze, shared between the core and the shell.
 *
 * Exported because the two materials MUST agree. Distant ground washing out toward the sky is a
 * real optical effect and the main cue the eye uses for depth over kilometres — but if the core
 * and the shell haze differently, the difference between them draws a line around the core, which
 * is the exact thing the haze is there to dissolve.
 *
 * The start distance keeps the core crisp: at 9 km across, almost all of it is nearer than this,
 * so the detail that was expensive to generate is not thrown away to produce an atmosphere.
 */
export const HAZE_COLOUR = SKY_HORIZON;
export const HAZE_DENSITY = 0.000028;
export const HAZE_START_M = 6000;

/**
 * Terrain material — PLAN §6.3.
 *
 * The vertex shader displaces a flat grid by the quantised heightmap; the fragment shader colours
 * it from elevation, land cover and a north-west hillshade. Nothing is animated and nothing is
 * simulated here — the terrain is the stage, not the subject.
 *
 * The subject is what moves above it: flight tracks, live gliders, the airspace. So the ground is
 * kept a step below them in contrast — but *bright*, not drab. Quiet and grey are not the same
 * thing, and only one of them looks like the Allgäu in April.
 */

const vertexShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D uHeight;
uniform vec2  uHeightSize;
uniform float uHeightMin;
uniform float uHeightScale;
uniform float uCellSizeM;

out vec2  vUv;
out float vTerrainZ;
out vec3  vNormal;
out vec3  vWorld;

// PlaneGeometry uv has v=0 at +Z, and after rotateX(-90deg) +Z is the SOUTH edge. Our rasters are
// image-ordered with row 0 = NORTH. Without this flip the terrain, the land cover and the places
// are all mirrored against each other, which is invisible on screen but wrong everywhere it
// matters.
vec2 gridUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

float sampleElevation(vec2 uv) {
  ivec2 texel = ivec2(clamp(gridUv(uv), 0.0, 1.0) * (uHeightSize - 1.0));
  return uHeightMin + float(texelFetch(uHeight, texel, 0).r) * uHeightScale;
}

void main() {
  vUv = uv;

  float elevation = sampleElevation(uv);
  vTerrainZ = elevation;

  // Central differences on the heightmap give a surface normal without needing normals in the
  // geometry, which keeps the buffer small.
  vec2 step = 1.0 / uHeightSize;
  float zx = sampleElevation(uv + vec2(step.x, 0.0)) - sampleElevation(uv - vec2(step.x, 0.0));
  float zy = sampleElevation(uv + vec2(0.0, step.y)) - sampleElevation(uv - vec2(0.0, step.y));
  vNormal = normalize(vec3(-zx, 2.0 * uCellSizeM, zy));

  vec3 displaced = position;
  displaced.y = elevation;
  vWorld = displaced;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D uLanduse;
uniform vec2  uLanduseSize;
uniform float uHasLanduse;
uniform float uShowLanduse;
uniform sampler2D uDrape;
uniform float uHasDrape;
uniform float uShowDrape;
uniform float uElevLowM;
uniform float uElevHighM;
uniform vec2  uCoreSizeM;
uniform float uBandM;
uniform vec3  uHazeColour;
uniform float uHazeDensity;
uniform float uHazeStartM;
uniform vec3  uCameraWorld;
uniform vec3  uSunDirection;
uniform vec3  uSunTint;
uniform vec3  uShadowTint;
uniform vec2  uLightRamp;

in vec2  vUv;
in float vTerrainZ;
in vec3  vNormal;
in vec3  vWorld;

out vec4 fragColor;

vec2 gridUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

// Hypsometric tint, in the register of a printed Alpenvereinskarte rather than a product
// dashboard — but a sunlit one, not a grey one.
//
// The band edges are relative, not absolute metres, and come from the AOI's own elevation range
// via uniforms. The previous fixed 90-510 m ramp described one specific valley; anything outside
// it clipped to a single flat grey, which is what happens to an Alpine AOI where the *floor* is
// already 800 m.
//
// The ramp gets PALER with height, not darker. Above roughly the treeline the Allgäu limestone is
// bare pale rock and scree, and for a large part of the year snow, so a darkening ramp fights
// both the place and the hillshade. Relief still comes almost entirely from the hillshade below.
vec3 terrainColour(float z) {
  vec3 pasture   = vec3(0.72, 0.79, 0.55);  // valley floor, spring meadow
  vec3 montane   = vec3(0.62, 0.72, 0.49);  // wooded flanks
  vec3 subalpine = vec3(0.80, 0.80, 0.66);  // above the trees
  vec3 rock      = vec3(0.94, 0.93, 0.89);  // summit limestone in full sun

  float span = max(uElevHighM - uElevLowM, 1.0);
  float t = clamp((z - uElevLowM) / span, 0.0, 1.0);

  vec3 colour = mix(pasture, montane, smoothstep(0.00, 0.28, t));
  colour = mix(colour, subalpine, smoothstep(0.30, 0.62, t));
  colour = mix(colour, rock, smoothstep(0.60, 0.92, t));
  return colour;
}

// Land cover, from OpenStreetMap. Class ids come from tools/geodata/build_landuse.py and are
// append-only.
//
// Sunlit, not satellite-flat: an Alpine pasture in spring really is that green, and rendering it
// olive to stay "tasteful" describes a different day. The range between the lightest and darkest
// cover is still kept narrow, because the flight overlays have to own the top of the contrast
// range and a slope that is already near-black leaves a dark track line nowhere to go.
vec3 landCoverColour(uint id) {
  if (id == 1u)  return vec3(0.68, 0.64, 0.44);  // vineyard — absent up here, kept for other AOIs
  if (id == 2u)  return vec3(0.64, 0.72, 0.44);  // orchard
  if (id == 3u)  return vec3(0.34, 0.50, 0.31);  // forest — spruce, the darkest natural cover
  if (id == 4u)  return vec3(0.84, 0.81, 0.55);  // farmland
  if (id == 5u)  return vec3(0.68, 0.81, 0.46);  // meadow and grass — the Alpine pasture
  if (id == 6u)  return vec3(0.66, 0.79, 0.47);  // park and garden
  if (id == 7u)  return vec3(0.76, 0.76, 0.50);  // allotments
  if (id == 8u)  return vec3(0.82, 0.76, 0.70);  // residential
  if (id == 9u)  return vec3(0.76, 0.74, 0.73);  // commercial and industrial
  if (id == 10u) return vec3(0.48, 0.60, 0.38);  // scrub and heath — Latschenkiefer above the trees
  if (id == 11u) return vec3(0.44, 0.66, 0.76);  // standing water
  if (id == 12u) return vec3(0.58, 0.70, 0.55);  // wetland
  if (id == 13u) return vec3(0.91, 0.90, 0.85);  // bare rock and scree
  // The network reads because the two surfaces go opposite ways: asphalt is darker than nearly
  // any ground here, gravel paler than nearly any. One shared grey made both disappear.
  if (id == 20u) return vec3(0.34, 0.33, 0.34);  // paved road, major
  if (id == 21u) return vec3(0.45, 0.44, 0.45);  // paved road, minor
  if (id == 22u) return vec3(0.88, 0.84, 0.74);  // unpaved track
  if (id == 23u) return vec3(0.29, 0.27, 0.27);  // railway
  return vec3(0.0);
}

// How far each class is allowed to pull the surface away from its elevation colour. Cover is
// mapped at 8 m from a source that is neither complete nor contemporaneous, so it tints the
// ground rather than replacing it — the relief has to stay readable through it.
float landCoverStrength(uint id) {
  if (id == 0u)  return 0.0;
  // Built lines are surveyed to the metre and are the one thing here with a hard edge, so they
  // are allowed to sit on top of the ground colour rather than be averaged into it.
  if (id >= 20u) return 0.94;
  // Treeline and rock line are the two boundaries a pilot actually reads off a mountain: where
  // the lift-generating forest ends, and where the sun-warmed rock begins. Both get to be legible.
  if (id == 3u)  return 0.74;  // forest
  if (id == 13u) return 0.72;  // rock and scree
  if (id == 10u) return 0.66;  // Latschen
  return 0.58;
}

// Cheap 2D hash, used to ragged the class boundaries.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 colour = terrainColour(vTerrainZ);

  // ⚠️ Land cover is faded out over the last uBandM metres before the core boundary.
  //
  // The core is tinted from OpenStreetMap; the shell beyond it is bare hypsometric terrain,
  // because mapping land cover across 30 x 34 km of two countries to decorate a backdrop is not a
  // sensible trade. Without this fade the two meet as a hard CHANGE OF COLOUR, and a colour
  // discontinuity in a straight line is exactly what makes a map read as two datasets stitched
  // together rather than as one mountain range. Fading the tint out lets the core arrive at the
  // boundary in the same plain elevation colour the shell starts from.
  vec2 fromEdgeM = min(vUv, 1.0 - vUv) * uCoreSizeM;
  float edgeFade = smoothstep(0.0, uBandM, min(fromEdgeM.x, fromEdgeM.y));

  if (uHasLanduse > 0.5 && uShowLanduse > 0.5 && edgeFade > 0.0) {
    // Jitter the lookup by up to half a cell. The raster is 8 m and the terrain is drawn far
    // finer, so a straight nearest lookup gives every stand of trees a staircase edge. Displacing
    // the sample by a hash of the position breaks the staircase into a ragged margin, which is
    // both closer to how a treeline actually looks and much cheaper than rasterising finer.
    //
    // Roads and rail are exempt in both directions. A treeline is genuinely vague and deserves a
    // ragged edge; a road is surveyed, mostly one cell wide, and ragging it either eats the line
    // or smears it sideways into ground that has no road on it.
    vec2 luUv = clamp(gridUv(vUv), 0.0, 1.0);
    vec2 texel = 1.0 / uLanduseSize;
    ivec2 exact = ivec2(luUv * (uLanduseSize - 1.0));
    uint direct = texelFetch(uLanduse, exact, 0).r;

    uint cover;
    if (direct >= 20u) {
      cover = direct;
    } else {
      vec2 jitter = (vec2(hash12(luUv * 4096.0), hash12(luUv * 4096.0 + 7.7)) - 0.5) * texel * 1.1;
      ivec2 luTexel = ivec2(clamp(luUv + jitter, 0.0, 1.0) * (uLanduseSize - 1.0));
      uint jittered = texelFetch(uLanduse, luTexel, 0).r;
      cover = jittered >= 20u ? direct : jittered;
    }

    vec3 tint = landCoverColour(cover);
    float strength = landCoverStrength(cover) * edgeFade;

    if (strength > 0.0) {
      // A little per-pixel variation so a large meadow does not read as a flat swatch.
      float grain = (hash12(luUv * 9000.0) - 0.5) * 0.045;
      colour = mix(colour, tint + grain, strength);
    }
  }

  // Hillshade from a low north-west sun, the cartographic convention. Without it the relief is
  // completely unreadable — a flat pale mass rather than a mountain.
  //
  // The light is TINTED rather than grey: warm where the sun reaches, blue where only skylight
  // does. The ambient floor is high (0.62) because on a clear day the sky is a huge light source
  // and real Alpine shadows are bright and blue, not black.
  //
  // ⚠️ ambient + gain must stay <= 1.0, and neither tint exceeds 1.0 in any channel, so nothing
  // can clip. An earlier version peaked at 1.14 and turned every sunlit slope to plaster.
  float lambert = clamp(dot(normalize(vNormal), normalize(uSunDirection)), 0.0, 1.0);
  vec3 light = mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);

  // The orthophoto, over the top of everything the procedural palette produced.
  //
  // It fades out towards the core boundary on exactly the same ring as the land cover, so the
  // photograph does not simply stop in a straight line against the coarse shell beyond it.
  float drapeMix = uHasDrape * uShowDrape * edgeFade;
  if (drapeMix > 0.0) {
    vec3 photo = texture(uDrape, gridUv(vUv)).rgb;
    colour = mix(colour, photo, drapeMix);

    // ⚠️ Shade the photograph far more gently than the synthetic surface.
    //
    // An orthophoto already contains the sun: it was taken on a real morning and carries that
    // day's highlights and shadows baked into the pixels. Multiplying our own hillshade over it
    // shades the terrain twice — north faces go almost black and the mountain reads as though it
    // were photographed at dusk. But dropping the shading entirely is worse, because then the
    // relief flattens out and a 3D scene looks like a paper map draped over nothing.
    //
    // Keeping about a third of the ramp preserves the sense of form without fighting the
    // photograph for the same job.
    light = mix(light, mix(vec3(1.0), light, 0.34), drapeMix);
  }

  colour *= light;

  // The same aerial haze the shell uses, with the same constants. Distance genuinely does wash
  // out contrast, so this is not decoration — and applying it to only one of the two tiers would
  // itself draw the boundary.
  float distance = length(vWorld - uCameraWorld);
  float haze = 1.0 - exp(-max(distance - uHazeStartM, 0.0) * uHazeDensity);
  colour = mix(colour, uHazeColour, clamp(haze, 0.0, 0.92));

  fragColor = vec4(colour, 1.0);
}
`;

export interface TerrainMaterialOptions {
  terrain: TerrainMeta;
  heightTexture: THREE.DataTexture;
  landuseTexture?: THREE.DataTexture | null;
  landuse?: { width: number; height: number } | null;
  drapeTexture?: THREE.Texture | null;
  /**
   * Elevation band the hypsometric tint is stretched across. Defaults to the terrain's own
   * measured range, which is almost always what you want — passing the AOI's declared range
   * instead keeps the colours identical between a core tile and the coarse shell around it.
   */
  elevationRangeM?: { min: number; max: number };
  /** Width of the ring in which land cover fades out, so the core meets the shell in one colour. */
  transitionBandM?: number;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): THREE.ShaderMaterial {
  const { terrain, landuse, landuseTexture } = options;

  // A usampler2D uniform still has to be bound to something when the raster is missing, or the
  // sampler reads as unit 0 and picks up whatever integer texture is there.
  const landuseFallback = new THREE.DataTexture(
    new Uint8Array(1),
    1,
    1,
    THREE.RedIntegerFormat,
    THREE.UnsignedByteType
  );
  landuseFallback.internalFormat = 'R8UI';
  landuseFallback.needsUpdate = true;

  // A sampler2D also has to be bound to something. A single white texel is the right stand-in:
  // if `uHasDrape` were ever wrong, the terrain would come out at full brightness rather than
  // black, which fails visibly instead of looking like a lighting bug.
  const drapeFallback = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  drapeFallback.needsUpdate = true;

  const range = options.elevationRangeM ?? { min: terrain.heightMinM, max: terrain.heightMaxM };

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uHeight: { value: options.heightTexture },
      uHeightSize: { value: new THREE.Vector2(terrain.width, terrain.height) },
      uHeightMin: { value: terrain.heightMinM },
      uHeightScale: { value: terrain.heightScale },
      uCellSizeM: { value: terrain.resolutionM },
      uLanduse: { value: landuseTexture ?? landuseFallback },
      uLanduseSize: { value: new THREE.Vector2(landuse?.width ?? 1, landuse?.height ?? 1) },
      uHasLanduse: { value: landuseTexture ? 1 : 0 },
      uShowLanduse: { value: 1 },
      uDrape: { value: options.drapeTexture ?? drapeFallback },
      uHasDrape: { value: options.drapeTexture ? 1 : 0 },
      uShowDrape: { value: 1 },
      uElevLowM: { value: range.min },
      uElevHighM: { value: range.max },
      uCoreSizeM: {
        value: new THREE.Vector2(
          terrain.width * terrain.resolutionM,
          terrain.height * terrain.resolutionM
        ),
      },
      uBandM: { value: options.transitionBandM ?? 0 },
      uHazeColour: { value: new THREE.Color(HAZE_COLOUR) },
      uHazeDensity: { value: HAZE_DENSITY },
      uHazeStartM: { value: HAZE_START_M },
      uCameraWorld: { value: new THREE.Vector3() },
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
  });
}
