import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createLiveLayer } from '../liveLayer';
import type { LiveAircraft } from '@/live/ogn';

/**
 * Two meshes, one sky — PLAN §3 Mode C.
 *
 * Free flight is drawn as a chevron and powered traffic as Airport IQ's airframe, which means one
 * instanced draw call each and therefore two independent index spaces. Everything downstream —
 * per-instance colour, the per-frame matrix rebuild, and above all picking, which only ever gets
 * an `instanceId` back — depends on those indices lining up with the right aircraft.
 *
 * ⚠️ This is tested because getting it wrong is silent and plausible. An off-by-one in either list
 * does not throw and does not look broken: it just means clicking one aircraft opens another one's
 * details, which reads as a glitch rather than as a bug and would survive any amount of looking at
 * the screen.
 */

const origin = { centreEasting: 600000, centreNorthing: 5250000 };

function craft(id: string, type: string, lat = 47.42, lon = 10.34): LiveAircraft {
  return {
    id,
    type,
    lat,
    lon,
    altM: 2000,
    climbMs: 1,
    groundMs: 10,
    courseDeg: 90,
    t: Math.floor(Date.now() / 1000),
    registration: null,
    model: null,
    cn: null,
    trail: [],
  };
}

/** The two instanced meshes, in the order the layer adds them: chevrons first, then airframes. */
function meshes(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
}

describe('live traffic layer', () => {
  it('draws free flight and powered traffic on separate meshes', () => {
    const layer = createLiveLayer(origin);
    layer.setAircraft([
      craft('a', 'paraglider'),
      craft('b', 'jet'),
      craft('c', 'hangglider'),
      craft('d', 'powered'),
      craft('e', 'glider'),
    ]);

    const [chevrons, planes] = meshes(layer.group);
    // paraglider, hangglider, glider
    expect(chevrons.count).toBe(3);
    // jet, powered
    expect(planes.count).toBe(2);

    layer.dispose();
  });

  it('keeps the sky empty when the caller filters everything out', () => {
    const layer = createLiveLayer(origin);
    layer.setAircraft([craft('a', 'paraglider'), craft('b', 'jet')]);
    // What "nur Freiflug" does: the CALLER filters, and the layer draws exactly what it is given.
    // Before this, the scene was handed the unfiltered list and kept drawing airliners after the
    // control said it had removed them.
    layer.setAircraft([craft('a', 'paraglider')]);

    const [chevrons, planes] = meshes(layer.group);
    expect(chevrons.count).toBe(1);
    expect(planes.count).toBe(0);

    layer.dispose();
  });

  it('tracks positions per aircraft, whichever mesh drew it', () => {
    const layer = createLiveLayer(origin);
    layer.setAircraft([craft('wing', 'paraglider', 47.42, 10.34), craft('jet', 'jet', 47.46, 10.31)]);

    const wing = layer.positionOf('wing');
    const jet = layer.positionOf('jet');
    expect(wing).not.toBeNull();
    expect(jet).not.toBeNull();
    // Different aircraft, different places — a shared index space would collapse these onto one.
    expect(wing!.distanceTo(jet!)).toBeGreaterThan(100);
    expect(layer.positionOf('gone')).toBeNull();

    layer.dispose();
  });

  it('forgets aircraft that have left the sky', () => {
    const layer = createLiveLayer(origin);
    layer.setAircraft([craft('a', 'paraglider'), craft('b', 'jet')]);
    layer.setAircraft([]);

    const [chevrons, planes] = meshes(layer.group);
    expect(chevrons.count).toBe(0);
    expect(planes.count).toBe(0);
    expect(layer.positionOf('a')).toBeNull();

    layer.dispose();
  });
});
