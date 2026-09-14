import * as THREE from 'three';

import type { ShellMeta, TerrainMeta } from './terrainLoader';
import {
  AMBIENT,
  HAZE_COLOUR,
  HAZE_DENSITY,
  HAZE_START_M,
  SHADOW_TINT,
  SUN_DIRECTION,
  SUN_GAIN,
  SUN_TINT,
} from './terrainMaterial';

/**
 * The coarse terrain shell — PLAN §4.1, §7 phase 1 steps 4 and 5.
 *
 * This is the horizon. The photoreal core is 9 km across, which at valley scale ends about four
 * kilometres past the Nebelhorn — and a mountain range that stops at a straight edge reads as a
 * diorama on a table, not as the Allgäu. The shell continues the terrain for another 30 km at 30 m
 * posting, deliberately across the Austrian border, and fades into aerial haze.
 *
 * Two things make the join invisible, and both are here rather than in the data:
 *
 *  1. **Elevation feathering.** For the last `uBandM` metres before the core boundary the shell's
 *     own elevation is blended into the elevation the *core* has at the nearest boundary cell, so
 *     the two meshes meet at exactly the same height even though one is a bare-earth model at 4 m
 *     and the other a surface model at 30 m.
 *  2. **Discarding.** Inside the core rectangle the shell is not drawn at all. Without this the two
 *     meshes occupy the same space and z-fight, which flickers as the camera moves — far more
 *     obvious than any seam.
 *
 * The colour ramp and the sun vector are deliberately identical to the core's. The shell is meant
 * to look like more of the same mountain seen from further away, and the moment its greens or its
 * shading differ, the eye finds the boundary immediately.
 */

const vertexShader = /* glsl */ `
precision highp float;
precision highp usampler2D;

uniform usampler2D uHeight;
uniform vec2  uHeightSize;
uniform float uHeightMin;
uniform float uHeightScale;
uniform float uCellSizeM;

// The core heightmap, so the shell can match its edge exactly.
uniform usampler2D uCoreHeight;
uniform vec2  uCoreHeightSize;
uniform float uCoreHeightMin;
uniform float uCoreHeightScale;

// Everything below is in metres relative to the world origin, which is the centre of the core.
uniform vec4  uCoreRect;   // xy = min corner (x, z), zw = size
uniform float uBandM;

out float vTerrainZ;
out vec3  vNormal;
out float vCoreDepth;   // metres inside the core rectangle; negative outside
out vec3  vWorld;

vec2 gridUv(vec2 uv) {
  return vec2(uv.x, 1.0 - uv.y);
}

float shellElevation(vec2 uv) {
  ivec2 texel = ivec2(clamp(gridUv(uv), 0.0, 1.0) * (uHeightSize - 1.0));
  return uHeightMin + float(texelFetch(uHeight, texel, 0).r) * uHeightScale;
}

/**
 * Elevation of the core at a world position, CLAMPED to the core's edge.
 *
 * The clamp is the point: for a shell vertex outside the core, this returns the core's elevation
 * at the nearest boundary cell, which is exactly the height the shell has to reach as it arrives
 * at that boundary.
 */
float coreElevationClamped(vec3 world) {
  vec2 local = (world.xz - uCoreRect.xy) / uCoreRect.zw;   // 0..1 across the core
  vec2 uv = clamp(local, 0.0, 1.0);
  ivec2 texel = ivec2(uv * (uCoreHeightSize - 1.0));
  return uCoreHeightMin + float(texelFetch(uCoreHeight, texel, 0).r) * uCoreHeightScale;
}

/** Signed distance into the core rectangle: positive inside, negative outside. */
float coreDepth(vec3 world) {
  vec2 lo = world.xz - uCoreRect.xy;
  vec2 hi = uCoreRect.xy + uCoreRect.zw - world.xz;
  return min(min(lo.x, hi.x), min(lo.y, hi.y));
}

void main() {
  // The shell mesh is OFFSET from the world origin (which is the centre of the core), so the local
  // vertex position is not the world position. Everything below — the core rectangle test, the
  // feathering, the haze distance — is expressed in world metres, so the model matrix has to be
  // applied here rather than folded into modelViewMatrix at the end.
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;

  float elevation = shellElevation(uv);
  float depth = coreDepth(world);
  vCoreDepth = depth;

  // Feather the last uBandM metres before the boundary. At the boundary itself the weight is 1,
  // so the shell adopts the core's elevation exactly and the two meshes meet without a step.
  if (depth > -uBandM) {
    float weight = clamp(1.0 + depth / uBandM, 0.0, 1.0);
    elevation = mix(elevation, coreElevationClamped(world), weight);
  }

  vTerrainZ = elevation;

  vec2 step = 1.0 / uHeightSize;
  float zx = shellElevation(uv + vec2(step.x, 0.0)) - shellElevation(uv - vec2(step.x, 0.0));
  float zy = shellElevation(uv + vec2(0.0, step.y)) - shellElevation(uv - vec2(0.0, step.y));
  vNormal = normalize(vec3(-zx, 2.0 * uCellSizeM, zy));

  world.y = elevation;
  vWorld = world;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uElevLowM;
uniform float uElevHighM;
uniform vec3  uHazeColour;
uniform float uHazeDensity;
uniform float uHazeStartM;
uniform vec3  uCameraWorld;
uniform vec3  uSunDirection;
uniform vec3  uSunTint;
uniform vec3  uShadowTint;
uniform vec2  uLightRamp;

in float vTerrainZ;
in vec3  vNormal;
in float vCoreDepth;
in vec3  vWorld;

out vec4 fragColor;

// Identical to the core's ramp. Any difference here draws a line around the core.
vec3 terrainColour(float z) {
  vec3 pasture   = vec3(0.72, 0.79, 0.55);
  vec3 montane   = vec3(0.62, 0.72, 0.49);
  vec3 subalpine = vec3(0.80, 0.80, 0.66);
  vec3 rock      = vec3(0.94, 0.93, 0.89);

  float span = max(uElevHighM - uElevLowM, 1.0);
  float t = clamp((z - uElevLowM) / span, 0.0, 1.0);

  vec3 colour = mix(pasture, montane, smoothstep(0.00, 0.28, t));
  colour = mix(colour, subalpine, smoothstep(0.30, 0.62, t));
  colour = mix(colour, rock, smoothstep(0.60, 0.92, t));
  return colour;
}

void main() {
  // Inside the core the high-resolution mesh is drawn instead. Rejecting per fragment rather than
  // culling the geometry avoids z-fighting between two surfaces that are, by construction, at the
  // same height where they meet.
  //
  // ⚠️ Culling these vertices out of the clip volume instead was tried, on the theory that discard
  // disables early-Z and was causing a measured 1 fps. It was not: the 1 fps was Chromium
  // throttling requestAnimationFrame for an occluded window, which is not a rendering problem at
  // all. The vertex-cull version also left a visible white gap along the core boundary, where the
  // shell stopped a fraction before the core began. Discard is correct here; if this ever does
  // become a real bottleneck, measure it with the window in the foreground first.
  if (vCoreDepth > 0.0) discard;

  vec3 colour = terrainColour(vTerrainZ);

  // Same sun and the same warm/cool tinting as the core — shading the two tiers differently would
  // draw the boundary as clearly as colouring them differently.
  float lambert = clamp(dot(normalize(vNormal), normalize(uSunDirection)), 0.0, 1.0);
  colour *= mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);

  // Aerial haze. Distance is measured from the camera in world metres, so the effect is a property
  // of how far away the ridge is rather than of where it happens to sit in the frame. Without a
  // start distance the near shell would be hazed too and the seam would reappear as a brightness
  // step just outside the core.
  float distance = length(vWorld - uCameraWorld);
  float haze = 1.0 - exp(-max(distance - uHazeStartM, 0.0) * uHazeDensity);
  colour = mix(colour, uHazeColour, clamp(haze, 0.0, 0.92));

  fragColor = vec4(colour, 1.0);
}
`;

export interface ShellMaterialOptions {
  shell: ShellMeta;
  shellTexture: THREE.DataTexture;
  core: TerrainMeta;
  coreTexture: THREE.DataTexture;
  /** World-space rectangle of the core: [minX, minZ, widthM, depthM]. */
  coreRect: [number, number, number, number];
  elevationRangeM: { min: number; max: number };
}

export function createShellMaterial(options: ShellMaterialOptions): THREE.ShaderMaterial {
  const { shell, core, coreRect } = options;

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uHeight: { value: options.shellTexture },
      uHeightSize: { value: new THREE.Vector2(shell.width, shell.height) },
      uHeightMin: { value: shell.heightMinM },
      uHeightScale: { value: shell.heightScale },
      uCellSizeM: { value: shell.resolutionM },
      uCoreHeight: { value: options.coreTexture },
      uCoreHeightSize: { value: new THREE.Vector2(core.width, core.height) },
      uCoreHeightMin: { value: core.heightMinM },
      uCoreHeightScale: { value: core.heightScale },
      uCoreRect: { value: new THREE.Vector4(...coreRect) },
      uBandM: { value: shell.transitionBandM },
      uElevLowM: { value: options.elevationRangeM.min },
      uElevHighM: { value: options.elevationRangeM.max },
      // Shared with the core, deliberately: see the note on the constants.
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
