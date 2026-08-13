import * as THREE from 'three';

/**
 * The Nebelhornbahn — PLAN §5.7, decision 25.
 *
 * Cheap to draw and it does three jobs at once: it explains how a pilot reaches 1930 m without
 * flying, it gives the eye a continuous vertical line to read 1400 m of relief against, and it
 * makes the scene instantly recognisable to anyone who has been there.
 *
 * ⚠️ The cable's height is modelled, not surveyed — see `build_cableway.py`. OpenStreetMap gives
 * the ground track and the stations; where the rope actually hangs is interpolated between them.
 * The app states this rather than letting a confident-looking line imply otherwise.
 *
 * Everything here uses `MeshBasicMaterial` because **the scene has no lights**. These are small,
 * dark, man-made objects read as silhouettes against the terrain, so flat colour is not a
 * compromise — it is what they should look like. A Lambert material would render pure black.
 */

export interface CablewayLine {
  id: string;
  name: string;
  kind: string;
  lengthM: number;
  /** [x, y, z] in world metres. y is the modelled cable height. */
  points: [number, number, number][];
}

export interface CablewayStation {
  id: string;
  name: string;
  kind: 'station' | 'pylon';
  x: number;
  z: number;
  groundM: number;
  publishedEleM: number | null;
}

export interface CablewayData {
  lines: CablewayLine[];
  stations: CablewayStation[];
  pylonHeightM: number;
  minClearanceM: number;
  attribution: string;
  heightNote: string;
}

export interface CablewayLayer {
  group: THREE.Group;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const CABLE_COLOUR = 0x2b2926;
const STRUCTURE_COLOUR = 0x4a453f;

export function createCablewayLayer(data: CablewayData): CablewayLayer {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const cableMaterial = new THREE.MeshBasicMaterial({ color: CABLE_COLOUR });
  const structureMaterial = new THREE.MeshBasicMaterial({ color: STRUCTURE_COLOUR });
  disposables.push(cableMaterial, structureMaterial);

  // ── The ropes ────────────────────────────────────────────────────────────
  for (const line of data.lines) {
    if (line.points.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(
      line.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'catmullrom',
      0
    );
    // Radial segments of 4 rather than 8: at 2.5 m radius on a 2 km span the rope is a couple of
    // pixels wide, and nobody has ever counted the sides of a cable.
    const segments = Math.max(24, Math.round(line.lengthM / 25));
    const geometry = new THREE.TubeGeometry(curve, segments, 2.5, 4, false);
    disposables.push(geometry);
    group.add(new THREE.Mesh(geometry, cableMaterial));
  }

  // ── Pylons and stations ──────────────────────────────────────────────────
  // Instanced, because there are a couple of dozen of each and they are identical boxes. One draw
  // call for the lot is not a meaningful saving here — it is simply the tidy way to do it.
  const pylons = data.stations.filter((s) => s.kind === 'pylon');
  const stations = data.stations.filter((s) => s.kind === 'station');

  const addBoxes = (
    items: CablewayStation[],
    width: number,
    height: number,
    depth: number
  ): THREE.InstancedMesh | null => {
    if (items.length === 0) return null;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    disposables.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, structureMaterial, items.length);
    // These are tiny objects scattered across 9 km of terrain, and the terrain around them is
    // never culled either.
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const pylonMesh = addBoxes(pylons, 3, data.pylonHeightM, 3);
  const stationMesh = addBoxes(stations, 16, 10, 16);

  const place = (mesh: THREE.InstancedMesh | null, items: CablewayStation[], height: number) => {
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    items.forEach((item, index) => {
      // The box is centred on its own origin, so it has to be lifted by half its height to stand
      // ON the ground rather than half-buried in it.
      matrix.makeTranslation(item.x, item.groundM + height / 2, item.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  place(pylonMesh, pylons, data.pylonHeightM);
  place(stationMesh, stations, 10);

  return {
    group,
    setVisible(visible: boolean) {
      group.visible = visible;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
