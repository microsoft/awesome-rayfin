import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { OperationsMeta } from '@/twin3d/dcInterior';
import { createTourLayer, type Tour } from '@/twin3d/tours';
import { TRUCK_LENGTH_M, VAN_LENGTH_M, createTruckGeometry, createVanGeometry } from '@/twin3d/vanModel';

/**
 * The Cologne fleet: trucks drive in the truck mesh, vans in the van
 * mesh, the other slot is parked off-world, a tunnel hides the vehicle without ending the tour, and
 * vehicles are 1:1 — never scaled by the shader.
 */

const EXT = { minEasting: 355584, maxNorthing: 5646832, widthM: 3246, depthM: 3090 };
const HUB = { lat: 50.9441, lon: 6.9747 };

function tour(id: string, vehicleClass: 'truck' | 'van', path: number[][]): Tour {
  return {
    tourId: id,
    wave: 1,
    waveTime: '11:30',
    departSlot: 46,
    returnSlot: 50,
    drops: 1,
    lines: 10,
    distanceKm: 1,
    kmPerDrop: 1,
    onTimeDrops: 1,
    vehicleId: `V-${id}`,
    vehicleType: 'diesel',
    gCo2: 0,
    withinEvRange: true,
    pharmacyIds: ['P001'],
    path,
    stopIndices: [path.length - 2],
    routed: true,
    vehicleClass,
  };
}

// Straight east from the hub; heights baked (3rd value), a tunnel stretch (4th value 1) on the van.
const pathA = [
  [50.9441, 6.9747, 45],
  [50.9441, 6.976, 45.5],
  [50.9441, 6.978, 46],
  [50.9441, 6.98, 46],
];
const pathB = [
  [50.9441, 6.9747, 45],
  [50.9441, 6.9752, 39, 1],
  [50.9441, 6.9757, 39, 1],
  [50.9441, 6.98, 46],
];

function layer() {
  const meta = {
    pharmacies: [{ id: 'P001', name: 'Caldova Partner Pharmacy 001', lat: 50.9441, lon: 6.98, km: 0.4 }],
    tours: [tour('T001', 'truck', pathA), tour('T002', 'van', pathB)],
  } as unknown as OperationsMeta;
  const l = createTourLayer(meta, EXT, () => 45, HUB, undefined);
  if (!l) throw new Error('no tour layer');
  return l;
}

function position(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(index, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

describe('the Cologne fleet', () => {
  it('drives a truck tour in the truck mesh and parks its van slot', () => {
    const l = layer();
    l.setTime(46.6);
    const trucks = l.group.getObjectByName('tour-trucks') as THREE.InstancedMesh;
    const vans = l.group.getObjectByName('tour-vans') as THREE.InstancedMesh;
    expect(position(trucks, 0).y).toBeGreaterThan(40);
    expect(position(vans, 0).y).toBeLessThan(-1000);
  });

  it('stands vehicles on the baked road height, not 6 m above it', () => {
    const l = layer();
    l.setTime(46.6);
    const trucks = l.group.getObjectByName('tour-trucks') as THREE.InstancedMesh;
    const y = position(trucks, 0).y;
    expect(y).toBeGreaterThan(45);
    expect(y).toBeLessThan(47);
  });

  it('hides a vehicle in a tunnel without ending its tour', () => {
    const l = layer();
    // early in the round the van is on the tunnel stretch
    l.setTime(46.15);
    expect(l.tourActive(1)).toBe(true);
    expect(l.vanPosition(1)).toBeNull();
  });

  it('reports a truck tour from the truck mesh', () => {
    const l = layer();
    l.setTime(46.6);
    const at = l.vanPosition(0);
    expect(at).not.toBeNull();
    expect(at!.y).toBeGreaterThan(40);
  });

  it('builds a truck that is longer than the van, at true size', () => {
    const truck = createTruckGeometry();
    const van = createVanGeometry();
    truck.computeBoundingBox();
    van.computeBoundingBox();
    const tl = truck.boundingBox!.max.z - truck.boundingBox!.min.z;
    const vl = van.boundingBox!.max.z - van.boundingBox!.min.z;
    expect(tl).toBeGreaterThan(TRUCK_LENGTH_M - 0.3);
    expect(tl).toBeLessThan(TRUCK_LENGTH_M + 0.3);
    expect(vl).toBeLessThan(VAN_LENGTH_M + 0.3);
    // stands on the road, nose along +Z
    expect(truck.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01);
  });

  it('never scales a vehicle with camera range (1:1 rule)', () => {
    const l = layer();
    const vans = l.group.getObjectByName('tour-vans') as THREE.InstancedMesh;
    const mat = vans.material as THREE.ShaderMaterial;
    const range = mat.uniforms.uVanScaleRange.value as THREE.Vector2;
    expect(range.x).toBe(1);
    expect(range.y).toBe(1);
  });
});
