import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createWebcamLayer, type WebcamMarker } from '../webcamLayer';

/**
 * A marker that points the wrong way is worse than no marker — PLAN §5.9.
 *
 * The whole claim this layer makes is "there is a camera here and it looks THAT way", and both
 * halves were verified against OSM and the operator's own caption before a line of it was drawn.
 * The rendering can still throw that away silently: a mirrored or inverted yaw draws a perfectly
 * confident wedge pointing at the wrong valley, and nothing about the picture says so. Neither
 * does an off-by-one between the instance index and the camera list, which just opens the wrong
 * page — the exact bug class that made every aircraft click miss when the bounding sphere went
 * stale, and which no amount of looking at the screen would catch.
 *
 * So the direction, the index mapping and the stale-sphere trap are asserted here rather than
 * trusted.
 */

const origin = { centreEasting: 600000, centreNorthing: 5250000 };

function webcam(id: string, bearingDeg: number, lat = 47.42, lon = 10.34): WebcamMarker {
  return {
    id,
    site: 'oberstdorf',
    name: id,
    lat,
    lon,
    eleM: 2000,
    bearingDeg,
    page: `https://www.foto-webcam.eu/webcam/${id}/`,
    operator: 'foto-webcam.eu',
    use: 'link-only',
    osm: `node/${id}`,
  };
}

function meshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
}

/** Where the marker's own +Z ends up after the layer has placed it, in world axes. */
function facing(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  return forward.normalize();
}

function viewer(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 1, 100000);
  camera.position.set(0, 3000, 2000);
  return camera;
}

describe('webcam layer', () => {
  it('points each marker along its verified bearing', () => {
    // North is -Z and east is +X in this scene, so a compass bearing has one correct answer.
    const layer = createWebcamLayer(origin, [
      webcam('north', 0),
      webcam('east', 90, 47.43, 10.35),
      webcam('south', 180, 47.44, 10.36),
      webcam('west', 270, 47.45, 10.37),
    ]);
    layer.update(viewer());

    const [bodies] = meshes(layer.group);
    const expected = [
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-1, 0, 0),
    ];
    expected.forEach((want, index) => {
      const got = facing(bodies, index);
      // A mirrored yaw would still be a unit vector, so compare the direction itself.
      expect(got.dot(want)).toBeCloseTo(1, 5);
    });

    layer.dispose();
  });

  it('maps each instance back to the camera that produced it', () => {
    const cameras = [webcam('nebelhorn', 130), webcam('tegelberghaus', 290, 47.57, 10.76)];
    const layer = createWebcamLayer(origin, cameras);
    layer.update(viewer());

    const [bodies] = meshes(layer.group);
    expect(bodies.count).toBe(2);

    // Fire at each marker from straight above: whichever instance is hit must be its own camera,
    // because the card's link is chosen by exactly this mapping.
    cameras.forEach((expectedCamera, index) => {
      const matrix = new THREE.Matrix4();
      bodies.getMatrixAt(index, matrix);
      const at = new THREE.Vector3().setFromMatrixPosition(matrix);

      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(at.x, at.y + 500, at.z),
        new THREE.Vector3(0, -1, 0)
      );
      expect(layer.pick(raycaster)?.id).toBe(expectedCamera.id);
    });

    layer.dispose();
  });

  it('drops the picking sphere every frame, because the markers rescale every frame', () => {
    const layer = createWebcamLayer(origin, [webcam('nebelhorn', 130)]);
    const [bodies] = meshes(layer.group);

    layer.update(viewer());
    // Force the lazy sphere three.js caches on first raycast.
    bodies.computeBoundingSphere();
    expect(bodies.boundingSphere).not.toBeNull();

    layer.update(viewer());
    // Left in place, this sphere is sized for the previous frame's scale and every click misses.
    expect(bodies.boundingSphere).toBeNull();

    layer.dispose();
  });

  it('cannot be clicked while it is hidden', () => {
    const layer = createWebcamLayer(origin, [webcam('nebelhorn', 130)]);
    layer.update(viewer());

    const [bodies] = meshes(layer.group);
    const matrix = new THREE.Matrix4();
    bodies.getMatrixAt(0, matrix);
    const at = new THREE.Vector3().setFromMatrixPosition(matrix);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(at.x, at.y + 500, at.z),
      new THREE.Vector3(0, -1, 0)
    );

    expect(layer.pick(raycaster)).not.toBeNull();
    layer.setVisible(false);
    // An invisible object that still answers clicks is a trap, not a feature.
    expect(layer.pick(raycaster)).toBeNull();

    layer.dispose();
  });
});
