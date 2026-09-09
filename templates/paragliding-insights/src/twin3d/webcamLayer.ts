import * as THREE from 'three';

import type { AoiWebcam } from '@/config/aoi';
import { wgs84ToUtm32 } from '@/flight/utm';
import type { WorldOrigin } from '@/flight/track';

import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_GAIN, SUN_TINT } from './terrainMaterial';

/**
 * Webcams, as markers you can click — PLAN §5.9, decision 26.
 *
 * The most useful thing this app can do with a webcam is also the cheapest: stand at the camera's
 * real position inside the model, point the marker the way the camera actually looks, and offer
 * the photograph as a link. The model then checks itself against reality from the same spot, live,
 * in front of whoever is watching — and the app never has to touch the operator's image.
 *
 * ⚠️ **Link-only, and that is a licence rather than a design choice.** foto-webcam.eu forbid
 * distributing, altering or copying their pictures without written consent, and in the same
 * sentence say links to their pages are welcome (§5.9 quotes it). So there is no image fetch here,
 * no texture, no cache — a marker, a direction, and an anchor tag.
 *
 * ⚠️ **One layer for the whole world, not one per site.** Cameras are configured per AOI, and
 * every per-site thing in this app has broken on the second site at least once: the tour pointed
 * at the wrong mountain, the far core arrived without buildings, the layer toggles reached only
 * the near site. Positions here are absolute WGS84 projected into world metres exactly as live
 * traffic is, so a camera lands in the right place whichever site the scene was built around, and
 * there is no second code path to forget.
 */

/**
 * Keeps a marker readable without letting it become a building-sized object up close.
 *
 * ⚠️ The floor was 25 m and that was wrong, caught by actually flying to a camera rather than by
 * reading the code: the geometry is ~1.3 units tall with a wedge reaching 3.4, so a floor of 25
 * draws an eight-storey post with an 85 m wedge on a mountain top, and the "stand where the camera
 * stands" view was filled by the marker instead of the panorama. 8 m is about a real mast, and the
 * screen-fraction rule still takes over past ~730 m, so nothing gets smaller at a distance.
 */
const MARKER_MIN_M = 8;
const MARKER_MAX_M = 260;
const MARKER_SCREEN_FRACTION = 0.011;

export interface WebcamMarker extends AoiWebcam {
  /** Which AOI configured it — shown in the card, and useful when two sites both have cameras. */
  site: string;
}

export interface WebcamLayer {
  group: THREE.Group;
  setVisible(visible: boolean): void;
  /** The camera under a ray, or null. */
  pick(raycaster: THREE.Raycaster): WebcamMarker | null;
  /** Keeps markers a readable size. Called every frame. */
  update(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
precision highp float;

out vec3 vWorld;
out vec3 vTint;

void main() {
  vec4 world = instanceMatrix * vec4(position, 1.0);
  vWorld = (modelMatrix * world).xyz;
  vTint = color;
  gl_Position = projectionMatrix * modelViewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec2 uLightRamp;

in vec3 vWorld;
in vec3 vTint;

out vec4 fragColor;

void main() {
  // Derivative normals, like the buildings and the aircraft: this scene has no lights, so every
  // material shades itself or renders black.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lambert = clamp(abs(dot(normal, normalize(uSunDirection))), 0.0, 1.0);
  vec3 colour = vTint * mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);
  fragColor = vec4(colour, 1.0);
}
`;

/**
 * A camera on a short post, with a wedge showing which way it looks.
 *
 * The wedge is the point of the marker. A dot would say "there is a camera here"; the wedge says
 * "and it is looking THAT way", which is the difference between a pin and a piece of information —
 * and the bearing behind it is verified twice over (OSM `camera:direction` against the operator's
 * own caption), so drawing it is a claim this app can stand behind.
 *
 * Built looking +Z, so the same yaw convention as every other oriented thing in the scene.
 */
function markerGeometry(): { body: THREE.BufferGeometry; wedge: THREE.BufferGeometry } {
  const post = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8);
  post.translate(0, 0.5, 0);

  const housing = new THREE.BoxGeometry(0.34, 0.26, 0.5);
  housing.translate(0, 1.12, 0.06);

  const lens = new THREE.CylinderGeometry(0.1, 0.13, 0.16, 10);
  lens.rotateX(Math.PI / 2);
  lens.translate(0, 1.12, 0.36);

  const body = mergeSimple([post, housing, lens]);
  post.dispose();
  housing.dispose();
  lens.dispose();

  // A flat wedge on the ground plane, opening along +Z — the field of view, schematically.
  const half = Math.tan(THREE.MathUtils.degToRad(24));
  const reach = 3.4;
  const wedge = new THREE.BufferGeometry();
  wedge.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([
        0, 1.12, 0.2, -half * reach, 1.12, reach, half * reach, 1.12, reach,
      ]),
      3
    )
  );
  wedge.computeVertexNormals();

  return { body, wedge };
}

/** Concatenate a few small geometries without pulling in the merge utility for three primitives. */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const part of parts) {
    const nonIndexed = part.index ? part.toNonIndexed() : part;
    const array = nonIndexed.getAttribute('position').array;
    for (let i = 0; i < array.length; i++) positions.push(array[i]);
    if (nonIndexed !== part) nonIndexed.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  return merged;
}

function withColour(geometry: THREE.BufferGeometry, colour: THREE.Color): THREE.BufferGeometry {
  // `vertexColors` multiplies by this attribute; without it every instance renders black.
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = colour.r;
    array[i * 3 + 1] = colour.g;
    array[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

export function createWebcamLayer(origin: WorldOrigin, cameras: WebcamMarker[]): WebcamLayer {
  const group = new THREE.Group();
  group.name = 'webcams';

  const { body, wedge } = markerGeometry();
  withColour(body, new THREE.Color(0.16, 0.18, 0.21));
  withColour(wedge, new THREE.Color(0.98, 0.78, 0.28));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    vertexColors: true,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
  });
  const wedgeMaterial = material.clone();
  wedgeMaterial.transparent = true;
  wedgeMaterial.opacity = 0.5;
  wedgeMaterial.depthWrite = false;
  wedgeMaterial.side = THREE.DoubleSide;

  const count = Math.max(1, cameras.length);
  const bodies = new THREE.InstancedMesh(body, material, count);
  const wedges = new THREE.InstancedMesh(wedge, wedgeMaterial, count);
  for (const mesh of [bodies, wedges]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = cameras.length;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const anchors = cameras.map((camera) => {
    const { easting, northing } = wgs84ToUtm32(camera.lon, camera.lat);
    return {
      camera,
      world: new THREE.Vector3(
        easting - origin.centreEasting,
        camera.eleM,
        -(northing - origin.centreNorthing)
      ),
    };
  });

  const dummy = new THREE.Object3D();

  return {
    group,

    setVisible(visible: boolean) {
      group.visible = visible;
    },

    pick(raycaster: THREE.Raycaster) {
      if (!group.visible) return null;
      const hits = raycaster.intersectObjects([bodies, wedges], false);
      for (const hit of hits) {
        if (hit.instanceId === undefined) continue;
        const anchor = anchors[hit.instanceId];
        if (anchor) return anchor.camera;
      }
      return null;
    },

    update(camera: THREE.PerspectiveCamera) {
      if (!group.visible || anchors.length === 0) return;

      anchors.forEach((anchor, index) => {
        dummy.position.copy(anchor.world);
        const distance = camera.position.distanceTo(anchor.world);
        dummy.scale.setScalar(
          THREE.MathUtils.clamp(distance * MARKER_SCREEN_FRACTION, MARKER_MIN_M, MARKER_MAX_M)
        );
        // North is -Z and the marker looks +Z, so the yaw is π − bearing, exactly as for aircraft.
        dummy.rotation.set(0, Math.PI - THREE.MathUtils.degToRad(anchor.camera.bearingDeg), 0);
        dummy.updateMatrix();
        bodies.setMatrixAt(index, dummy.matrix);
        wedges.setMatrixAt(index, dummy.matrix);
      });

      bodies.instanceMatrix.needsUpdate = true;
      wedges.instanceMatrix.needsUpdate = true;
      // Same trap as the aircraft: the picking sphere is computed once from the matrices as they
      // were, and these are rescaled every frame, so a stale sphere makes every click miss.
      bodies.boundingSphere = null;
      wedges.boundingSphere = null;
    },

    dispose() {
      body.dispose();
      wedge.dispose();
      material.dispose();
      wedgeMaterial.dispose();
    },
  };
}
