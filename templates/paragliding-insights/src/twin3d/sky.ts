import * as THREE from 'three';

import { SKY_HORIZON, SKY_ZENITH, SUN_DIRECTION } from './terrainMaterial';

/**
 * Gradient sky — PLAN decision 13.
 *
 * "Gradient sky + aerial haze on distant ridges. No HDRI, no volumetric cumulus." The scope is
 * bounded deliberately: every hour not spent on clouds is an hour spent on Fabric, which is the
 * actual point of the app. But a flat background colour is not a sky, and with nothing above the
 * horizon the most dramatic terrain in Germany still reads as a diagram.
 *
 * Implemented as a dome that rides with the camera rather than as a `scene.background` texture,
 * because a background texture is mapped in *screen* space and would not turn with the view — the
 * horizon has to stay where the horizon is when you orbit.
 *
 * ⚠️ Depth is neither tested nor written, and the dome is drawn first (`renderOrder = -1`). It is a
 * backdrop, not geometry: everything else must paint over it regardless of distance.
 *
 * The colours and the sun direction are imported, not redeclared. A sky that disagrees with the
 * haze paints a hard line along the horizon, and a glow that disagrees with the hillshade puts the
 * sun in two places at once.
 */

const vertexShader = /* glsl */ `
precision highp float;

out vec3 vDirection;

void main() {
  // Direction from the camera to this vertex, in world space. The dome is centred on the camera,
  // so the local position IS that direction.
  vDirection = position;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uSunDirection;

in vec3 vDirection;

out vec4 fragColor;

void main() {
  vec3 direction = normalize(vDirection);

  // Height in the sky, 0 at the horizon and 1 overhead. The curve is deliberately not linear:
  // real sky darkens quickly just above the horizon and then much more slowly, and a linear ramp
  // reads as a paint gradient rather than as air.
  float height = clamp(direction.y, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uZenith, pow(height, 0.55));

  // Below the horizon, keep going towards the horizon colour rather than clamping. The terrain
  // covers most of it, but the camera can dip below a ridge line and a hard band there is worse
  // than a soft one.
  if (direction.y < 0.0) {
    colour = mix(uHorizon, uHorizon * 0.92, clamp(-direction.y * 3.0, 0.0, 1.0));
  }

  // A broad warm glow around the sun. Not a disc — at this scale a literal sun would be a bright
  // dot that draws the eye away from the mountain, and it would have to be in the physically right
  // place for the date, which the app does not know.
  float toSun = clamp(dot(direction, normalize(uSunDirection)), 0.0, 1.0);
  colour += vec3(0.16, 0.13, 0.07) * pow(toSun, 6.0);

  fragColor = vec4(colour, 1.0);
}
`;

/**
 * Radius of the dome, in metres.
 *
 * ⚠️ Large, and it has to be. The first version used a unit sphere and forced the depth to the far
 * plane with the usual `gl_Position = clip.xyww` skybox trick. That trick is for a cube drawn with
 * the view translation stripped out; applied to a one-metre sphere sitting ON the camera it
 * misprojects everything at or behind the near plane, and the sky ends up painted across the lower
 * half of the frame with slivers of terrain floating above the horizon.
 *
 * A dome comfortably larger than the terrain and comfortably inside the far plane needs no tricks:
 * ordinary projection and clipping do the right thing from any angle.
 */
const RADIUS_M = 50000;

export interface Sky {
  mesh: THREE.Mesh;
  /** Keep the dome centred on the camera, so the horizon never gets closer. */
  update(camera: THREE.Camera): void;
  dispose(): void;
}

export function createSky(): Sky {
  const geometry = new THREE.SphereGeometry(RADIUS_M, 32, 16);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uZenith: { value: new THREE.Color(SKY_ZENITH) },
      uHorizon: { value: new THREE.Color(SKY_HORIZON) },
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION).normalize() },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return {
    mesh,
    update(camera) {
      mesh.position.copy(camera.position);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
