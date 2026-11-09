import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The photoreal core: the NRW 3D-Mesh (photogrammetric, Bildflug 2025) baked into GLB tiles by
 * `tools/geodata/bake_nrw_mesh.py` — PLAN Phase 1.
 *
 * The tiles are already in the scene's frame (metres, core centred, +x east, +z south, y absolute
 * DHHN2016), so they are added without any transform of their own.
 *
 * ⚠️ UNLIT ON PURPOSE. A photogrammetric texture is a photograph: the sun is already in it, with its
 * shadows. Lighting it a second time darkens every north face twice and reads as a render fault, so
 * the GLTF's standard material is replaced by a basic one carrying the same texture.
 *
 * ⚠️ AND IT REPLACES, IT DOES NOT ADD. Where the mesh exists, the LoD2 blocks, the draped terrain,
 * the water surface and the instanced trees all describe the SAME things again, a few decimetres
 * away — z-fighting and doubled trees. The scene hides them while the mesh is shown and brings them
 * back when it is switched off (a comparison the demo also uses).
 */

export interface MeshTile {
  file: string;
  node: number;
  vertices: number;
  triangles: number;
  texture: [number, number];
  texelM: number;
  min: [number, number, number];
  max: [number, number, number];
  bytes: number;
}

export interface MeshManifest {
  aoi: string;
  source: string;
  sourceUrl: string;
  attribution: string;
  tiles: MeshTile[];
  totals: MeshTotals;
  /**
   * The delivery ring (a coarse NRW mesh around the fine core): the same 2025
   * mesh at its ~4.9 m level out to the AOI shell, clipped so it never overlaps the fine core.
   */
  ring?: { dir: string; tiles: MeshTile[]; totals: MeshTotals; box: { x0: number; x1: number; z0: number; z1: number } };
}

export interface MeshTotals {
  tiles: number;
  vertices: number;
  texels: number;
  bytes: number;
  heightMinM: number;
  heightMaxM: number;
}

export interface MeshCoreLayer {
  group: THREE.Group;
  manifest: MeshManifest;
  /** Tiles that actually reached the GPU, which is the figure to report, not the manifest's. */
  loaded: number;
  /** Ring tiles that reached the GPU (0 when no ring was baked). */
  ringLoaded: number;
  /** Ray-cast the mesh from above: the height of its top surface at (x, z), or null off the mesh. */
  surfaceAt: (x: number, z: number) => number | null;
  dispose: () => void;
}

export class MeshNotBuiltError extends Error {}

export async function loadMeshCore(
  aoiId: string,
  base: string,
  renderer: THREE.WebGLRenderer
): Promise<MeshCoreLayer> {
  const root = `${base}/${aoiId}`;
  const response = await fetch(`${root}/mesh.json`);
  // A 404 from the dev server can come back as index.html with 200, so the content type is checked
  // too — a JSON parse error on HTML would otherwise surface as a crash rather than "not built".
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
    throw new MeshNotBuiltError(`no mesh for ${aoiId}`);
  }
  const manifest: MeshManifest = await response.json();

  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'mesh-core';
  const disposables: { dispose(): void }[] = [];
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const jobs = [
    ...manifest.tiles.map((tile) => ({ tile, url: `${root}/mesh/${tile.file}`, ring: false })),
    ...(manifest.ring?.tiles ?? []).map((tile) => ({ tile, url: `${root}/${manifest.ring!.dir}/${tile.file}`, ring: true })),
  ];
  const results = await Promise.allSettled(
    jobs.map(async ({ tile, url }) => {
      const gltf = await loader.loadAsync(url);
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const source = mesh.material as THREE.MeshStandardMaterial;
        const map = source.map;
        if (map) {
          map.anisotropy = Math.min(8, maxAniso);
          map.colorSpace = THREE.SRGBColorSpace;
          disposables.push(map);
        }
        const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
        source.dispose();
        mesh.material = material;
        mesh.name = `mesh-tile-${tile.node}`;
        disposables.push(material, mesh.geometry);
      });
      group.add(gltf.scene);
    })
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    // Reported, not swallowed: a missing tile is a visible hole in the city.
    console.warn(`mesh: ${failed.length} of ${jobs.length} tiles failed to load`, failed[0]);
  }
  const ringFailed = results.filter((r, i) => r.status === 'rejected' && jobs[i].ring).length;
  group.updateMatrixWorld(true);

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const top = Math.max(manifest.totals.heightMaxM, manifest.ring?.totals.heightMaxM ?? 0) + 50;
  const surfaceAt = (x: number, z: number): number | null => {
    ray.set(new THREE.Vector3(x, top, z), down);
    const hit = ray.intersectObject(group, true)[0];
    return hit ? hit.point.y : null;
  };

  return {
    group,
    manifest,
    loaded: manifest.tiles.length - (failed.length - ringFailed),
    ringLoaded: (manifest.ring?.tiles.length ?? 0) - ringFailed,
    surfaceAt,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
