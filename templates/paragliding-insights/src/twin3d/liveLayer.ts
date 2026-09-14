import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { LiveAircraft } from '@/live/ogn';
import { FREE_FLIGHT_TYPES } from '@/live/ogn';
import { wgs84ToUtm32 } from '@/flight/utm';
import type { WorldOrigin } from '@/flight/track';

import { VARIO_GLSL, VARIO_SCALE_MS, varioColour } from './vario';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_GAIN, SUN_TINT } from './terrainMaterial';

/**
 * Live traffic — PLAN §3 Mode C, phase 4.
 *
 * Two pieces of geometry for the whole sky: one instanced mesh carrying every aircraft marker, and
 * one line buffer carrying every trail. Per-aircraft objects would be the obvious shape and the
 * wrong one — the set churns constantly as gliders come into and out of receiver range, and
 * creating and disposing meshes on that cadence is how a scene ends up leaking GPU buffers over an
 * afternoon.
 *
 * Markers are **chevrons that point where the aircraft is going**, coloured by climb rate on the
 * same ramp as the flight ribbon, so a thermalling glider is orange and a glide is blue whether it
 * is live or replayed. Heading matters more here than in replay: a live map is read as "what is
 * happening", and half of that is which way everyone is heading.
 */

/** Beyond this, a marker would be a single pixel; below it, it would swamp the terrain. */
const MARKER_MIN_M = 45;
const MARKER_MAX_M = 900;
/** Roughly constant on-screen size — tuned by eye against the 55° vertical field of view. */
const MARKER_SCREEN_FRACTION = 0.016;

const trailVertexShader = /* glsl */ `
precision highp float;

attribute float aAge;
attribute float aVario;

out float vAge;
out float vVario;

void main() {
  vAge = aAge;
  vVario = aVario;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const trailFragmentShader = /* glsl */ `
precision highp float;

uniform float uVarioScale;

in float vAge;
in float vVario;

out vec4 fragColor;

${VARIO_GLSL}

void main() {
  // Trails fade over the last twenty minutes rather than ending abruptly, so the map reads as
  // "where everyone has just been" instead of as a set of arbitrary line lengths.
  float alpha = clamp(1.0 - vAge, 0.0, 1.0);
  alpha = alpha * alpha;
  if (alpha < 0.01) discard;
  fragColor = vec4(varioColour(vVario, uVarioScale), alpha * 0.85);
}
`;

export interface LiveLayer {
  group: THREE.Group;
  /** Replace the traffic. Cheap enough to call at the relay's 1 Hz broadcast rate. */
  setAircraft(aircraft: LiveAircraft[]): void;
  setVisible(visible: boolean): void;
  /** World position of one aircraft, for the follow camera. Null once it has gone. */
  positionOf(id: string): THREE.Vector3 | null;
  /** Keeps the markers a readable size as the camera moves. Called every frame. */
  update(camera: THREE.PerspectiveCamera): void;
  /** The aircraft under a ray, or null. Used for click-to-select. */
  pick(raycaster: THREE.Raycaster): string | null;
  dispose(): void;
}

/**
 * A flat chevron lying in the XZ plane, apex towards +Z.
 *
 * Flat rather than solid because the scene has no lights (PLAN §8) — an unlit solid reads as a
 * silhouette with no shape to it, whereas a flat arrow seen from above, which is how this map is
 * mostly viewed, is unambiguous.
 */
function chevronGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // Apex, two trailing corners, and a notch so it reads as an arrowhead rather than a triangle.
  const vertices = new Float32Array([
    0, 0, 1.4, -0.85, 0, -1.0, 0, 0, -0.35, 0, 0, -0.35, 0.85, 0, -1.0, 0, 0, 1.4,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

  // ⚠️ A white per-vertex colour, which looks pointless and is not. Per-instance colour requires
  // `vertexColors: true` on the material, and that switches on the shader's `USE_COLOR` path —
  // which multiplies by the geometry's `color` attribute. With no such attribute the attribute
  // reads as zero and every marker renders **black**, silently, with the instance colours computed
  // and uploaded correctly and then multiplied away. White is the identity for that multiply.
  const white = new Float32Array(vertices.length).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));

  return geometry;
}

/**
 * A powered aircraft, in the shape Airport IQ draws — fuselage, nose, tail cone, wing, stabiliser,
 * fin and engine nacelles, merged into one geometry so the whole fleet is still a single instanced
 * draw call.
 *
 * ⚠️ **The materials could not come with it.** Airport IQ lights its aircraft with a
 * `MeshStandardMaterial`, which in this scene renders **pure black**: there are no lights here and
 * every material bakes its own shading (PLAN §8, first rule). So the airframe is Airport IQ's, and
 * the shading is this app's — screen-space derivative normals against the same sun vector the
 * terrain and the buildings use, so an airliner is lit from the same direction as the mountain
 * underneath it.
 *
 * Built pointing +Z, like the chevron, so both meshes take the same heading rotation.
 */
function aircraftGeometry(): THREE.BufferGeometry {
  // Proportions of a narrow-body, normalised to a unit length so the instance scale is the only
  // thing that decides how big it looks.
  const len = 2.0;
  const rad = 0.17;
  const span = 2.0;

  const parts: THREE.BufferGeometry[] = [];

  const fuselage = new THREE.CylinderGeometry(rad, rad, len, 12);
  fuselage.rotateX(Math.PI / 2);
  parts.push(fuselage);

  const nose = new THREE.ConeGeometry(rad, rad * 2.6, 12);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, len / 2 + rad * 1.1);
  parts.push(nose);

  const tail = new THREE.ConeGeometry(rad, rad * 3, 12);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, rad * 0.35, -len / 2 - rad * 1.2);
  parts.push(tail);

  const wing = new THREE.BoxGeometry(span, rad * 0.3, rad * 2.7);
  wing.translate(0, -rad * 0.35, -len * 0.03);
  parts.push(wing);

  const stabiliser = new THREE.BoxGeometry(span * 0.4, rad * 0.24, rad * 1.7);
  stabiliser.translate(0, rad * 0.1, -len * 0.44);
  parts.push(stabiliser);

  const fin = new THREE.BoxGeometry(rad * 0.32, rad * 2.9, rad * 2);
  fin.translate(0, rad * 2.1, -len * 0.44);
  parts.push(fin);

  for (const side of [1, -1]) {
    const nacelle = new THREE.CylinderGeometry(rad * 0.52, rad * 0.46, rad * 2.6, 10);
    nacelle.rotateX(Math.PI / 2);
    nacelle.translate(side * span * 0.28, -rad * 0.85, len * 0.02);
    parts.push(nacelle);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();

  // Same reason as the chevron: `vertexColors` needs a white identity to multiply the per-instance
  // colour against, or every aircraft renders black.
  const white = new Float32Array(merged.attributes.position.count * 3).fill(1);
  merged.setAttribute('color', new THREE.BufferAttribute(white, 3));
  return merged;
}

/**
 * Shading for the airframe, baked rather than lit.
 *
 * The mesh carries positions only, so normals come from screen-space derivatives of the world
 * position — the same trick the LoD2 buildings use, and exact for flat faces, which is all this
 * airframe has.
 */
const aircraftVertexShader = /* glsl */ `
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

const aircraftFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec2 uLightRamp;

in vec3 vWorld;
in vec3 vTint;

out vec4 fragColor;

void main() {
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lambert = clamp(abs(dot(normal, normalize(uSunDirection))), 0.0, 1.0);
  vec3 colour = vTint * mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);
  fragColor = vec4(colour, 1.0);
}
`;

export function createLiveLayer(
  origin: WorldOrigin,
  options: { trailSeconds?: number } = {}
): LiveLayer {
  const trailSeconds = options.trailSeconds ?? 20 * 60;

  const group = new THREE.Group();
  group.name = 'live-traffic';

  // Instance capacity is fixed up front. The busiest 75 s over this AOI saw 18 aircraft including
  // airliners, so 256 is ample headroom and costs a few kilobytes of buffer.
  const CAPACITY = 256;
  const markerGeometry = chevronGeometry();
  const markerMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
  });
  const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, CAPACITY);
  markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  markers.count = 0;
  // Instanced meshes are frustum-culled against the geometry's own bounding sphere, which for one
  // chevron at the origin is about two metres across — so every marker vanishes the moment the
  // scene origin leaves the view.
  markers.frustumCulled = false;
  group.add(markers);

  /**
   * Powered traffic gets the aircraft shape; free flight keeps the chevron.
   *
   * Two meshes rather than one, because an instanced draw call has exactly one geometry. It is
   * also the right split visually: a chevron says "a wing, going that way", which is what a
   * paraglider is, and an airliner at 11 km reads as an aeroplane or as nothing.
   */
  const aircraftGeom = aircraftGeometry();
  const aircraftMaterial = new THREE.ShaderMaterial({
    vertexShader: aircraftVertexShader,
    fragmentShader: aircraftFragmentShader,
    vertexColors: true,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
  });
  const planes = new THREE.InstancedMesh(aircraftGeom, aircraftMaterial, CAPACITY);
  planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  planes.count = 0;
  planes.frustumCulled = false;
  group.add(planes);

  const trailGeometry = new THREE.BufferGeometry();
  const trailMaterial = new THREE.ShaderMaterial({
    vertexShader: trailVertexShader,
    fragmentShader: trailFragmentShader,
    uniforms: {
      uVarioScale: { value: VARIO_SCALE_MS },
    },
    transparent: true,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
  });
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  trails.frustumCulled = false;
  group.add(trails);

  /** id → world position, kept so the follow camera does not have to re-project. */
  const positions = new Map<string, THREE.Vector3>();
  /** id → which mesh drew it, where, and which way it was heading. */
  const anchors = new Map<
    string,
    { courseDeg: number | null; index: number; powered: boolean }
  >();
  /** Reverse lookup for picking: mesh + instance index → aircraft id. */
  const chevronIds: string[] = [];
  const planeIds: string[] = [];
  let current: LiveAircraft[] = [];

  const project = (lat: number, lon: number, altM: number): THREE.Vector3 => {
    const { easting, northing } = wgs84ToUtm32(lon, lat);
    return new THREE.Vector3(easting - origin.centreEasting, altM, -(northing - origin.centreNorthing));
  };

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();

  const rebuildTrails = (aircraft: LiveAircraft[], nowS: number) => {
    // One buffer for every trail, as line segments: two vertices per drawn span. Rebuilt whole on
    // each update, which at a few dozen aircraft is a handful of milliseconds and far simpler than
    // maintaining a ring buffer per aircraft.
    let segments = 0;
    for (const craft of aircraft) segments += Math.max(0, craft.trail.length - 1);

    const positionArray = new Float32Array(segments * 6);
    const ageArray = new Float32Array(segments * 2);
    const varioArray = new Float32Array(segments * 2);

    let v = 0;
    for (const craft of aircraft) {
      for (let i = 1; i < craft.trail.length; i++) {
        const [t0, lat0, lon0, alt0] = craft.trail[i - 1];
        const [t1, lat1, lon1, alt1] = craft.trail[i];
        const a = project(lat0, lon0, alt0);
        const b = project(lat1, lon1, alt1);

        positionArray.set([a.x, a.y, a.z, b.x, b.y, b.z], v * 3);
        ageArray[v] = (nowS - t0) / trailSeconds;
        ageArray[v + 1] = (nowS - t1) / trailSeconds;

        // Vertical speed between the two fixes, which is the trail's own measurement rather than
        // the instrument's instantaneous reading — the right value for colouring a past segment.
        const dt = Math.max(1, t1 - t0);
        const vario = (alt1 - alt0) / dt;
        varioArray[v] = vario;
        varioArray[v + 1] = vario;

        v += 2;
      }
    }

    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
    trailGeometry.setAttribute('aAge', new THREE.BufferAttribute(ageArray, 1));
    trailGeometry.setAttribute('aVario', new THREE.BufferAttribute(varioArray, 1));
    trailGeometry.setDrawRange(0, segments * 2);
  };

  return {
    group,

    setAircraft(aircraft: LiveAircraft[]) {
      current = aircraft.slice(0, CAPACITY);
      const nowS = Date.now() / 1000;

      positions.clear();
      anchors.clear();
      chevronIds.length = 0;
      planeIds.length = 0;

      current.forEach((craft) => {
        const powered = !FREE_FLIGHT_TYPES.has(craft.type);
        const list = powered ? planeIds : chevronIds;
        const index = list.length;
        list.push(craft.id);

        positions.set(craft.id, project(craft.lat, craft.lon, craft.altM));
        anchors.set(craft.id, { courseDeg: craft.courseDeg, index, powered });

        // Colour is set here rather than per frame: it only changes when a new fix arrives.
        //
        // Free flight is coloured by climb rate, on the same ramp as the flight ribbon, because
        // that is the interesting thing about a glider. A powered aircraft's climb rate is not,
        // and painting an airliner orange for climbing out of Munich would say something this app
        // does not mean — so it wears Airport IQ's white airframe instead.
        if (powered) {
          colour.setRGB(0.92, 0.93, 0.95);
          planes.setColorAt(index, colour);
        } else {
          colour.copy(varioColour(craft.climbMs));
          markers.setColorAt(index, colour);
        }
      });

      markers.count = chevronIds.length;
      planes.count = planeIds.length;
      if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
      if (planes.instanceColor) planes.instanceColor.needsUpdate = true;

      rebuildTrails(current, nowS);
    },

    setVisible(visible: boolean) {
      group.visible = visible;
    },

    positionOf(id: string) {
      const world = positions.get(id);
      if (!world) return null;
      return world.clone();
    },

    update(camera: THREE.PerspectiveCamera) {
      if (!group.visible || current.length === 0) return;

      for (const craft of current) {
        const anchor = anchors.get(craft.id);
        const world = positions.get(craft.id);
        if (!anchor || !world) continue;

        dummy.position.set(world.x, world.y, world.z);

        // A marker sized in world metres is either invisible from across the valley or the size of
        // a hangar from close up. Scaling with distance to the eye keeps it roughly constant on
        // screen, which is what a traffic symbol has to be to be readable at all.
        const distance = camera.position.distanceTo(dummy.position);
        const scale = THREE.MathUtils.clamp(
          distance * MARKER_SCREEN_FRACTION,
          MARKER_MIN_M,
          MARKER_MAX_M
        );
        dummy.scale.setScalar(scale);

        // Course is degrees clockwise from north. North is -Z in this scene and both shapes point
        // +Z, so the yaw that takes one to the other is π − course.
        const course = ((anchor.courseDeg ?? 0) * Math.PI) / 180;
        dummy.rotation.set(0, Math.PI - course, 0);

        dummy.updateMatrix();
        if (anchor.powered) planes.setMatrixAt(anchor.index, dummy.matrix);
        else markers.setMatrixAt(anchor.index, dummy.matrix);
      }

      markers.instanceMatrix.needsUpdate = true;
      planes.instanceMatrix.needsUpdate = true;

      // ⚠️ Invalidate the picking volume, every frame.
      //
      // `InstancedMesh.raycast` starts with a bounding-sphere test and computes that sphere ONCE,
      // lazily, from the instance matrices as they were at the time. Every aircraft here moves and
      // is rescaled on every frame, so a sphere computed on the first click is wrong by the second
      // — and the failure is total rather than partial: the ray misses the stale sphere and the
      // mesh reports no hit at all, so clicking an aircraft that is plainly under the cursor does
      // nothing. Nulling it makes the next raycast recompute, which costs nothing because clicks
      // are rare and frames are not.
      markers.boundingSphere = null;
      planes.boundingSphere = null;
    },

    pick(raycaster: THREE.Raycaster) {
      if (!group.visible) return null;
      // Nearest hit across both meshes. Instanced picking gives an `instanceId`, which is why the
      // two id lists are kept in draw order rather than derived from the aircraft array.
      const hits = raycaster.intersectObjects([markers, planes], false);
      for (const hit of hits) {
        if (hit.instanceId === undefined) continue;
        const id = hit.object === planes ? planeIds[hit.instanceId] : chevronIds[hit.instanceId];
        if (id) return id;
      }
      return null;
    },

    dispose() {
      markerGeometry.dispose();
      markerMaterial.dispose();
      aircraftGeom.dispose();
      aircraftMaterial.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
    },
  };
}
