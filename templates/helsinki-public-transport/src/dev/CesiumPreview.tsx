import { useMemo, useState } from 'react';

import { CesiumView } from '@/components/CesiumView';
import { MapControls, type MeshChoice } from '@/components/MapControls';
import type { PathPoint, Vehicle } from '@/data/model';
import { EMPTY_SELECTION, applySelect } from '@/data/selection';

/**
 * Dev-only harness: renders the 3D scene with synthetic vehicles so the Helsinki open-data
 * layers can be checked without going through Fabric sign-in. Compiled out of production
 * builds - `main.tsx` only reaches this behind `import.meta.env.DEV`.
 */

const CENTRE = { lon: 24.9484, lat: 60.1673 };

function mockVehicles(count: number): Vehicle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.004 + (i % 7) * 0.0016;
    const speedKmh = (i % 9) * 8;
    return {
      vehicleId: `mock/${i}`,
      route: `${1000 + (i % 12)}`,
      label: '',
      lat: CENTRE.lat + Math.sin(angle) * radius,
      lon: CENTRE.lon + Math.cos(angle) * radius * 2,
      bearing: (angle * 180) / Math.PI,
      speed: speedKmh / 3.6,
      speedKmh,
      occupancy: 'MANY_SEATS_AVAILABLE',
      timestamp: Date.now() / 1000,
    };
  });
}

const VEHICLES = mockVehicles(120);

/** A short synthetic track, offset per vehicle so several of them are told apart on screen. */
function mockPath(seed: number, count = 60): PathPoint[] {
  const start = Date.now() - 30 * 60 * 1000;
  const angle = (seed / 120) * Math.PI * 2;
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      lat: CENTRE.lat + Math.sin(angle) * 0.004 + t * 0.012 * Math.cos(angle),
      lon: CENTRE.lon + Math.cos(angle) * 0.008 + t * 0.024 * Math.sin(angle),
      bearing: (angle * 180) / Math.PI,
      speed: 6 + Math.sin(t * Math.PI * 3 + seed) * 4,
      timestamp: new Date(start + t * 30 * 60 * 1000).toISOString(),
    };
  });
}

export function CesiumPreview() {
  const [mesh, setMesh] = useState<MeshChoice>('2017');
  const [showTrees, setShowTrees] = useState(false);
  const [selection, setSelection] = useState(EMPTY_SELECTION);

  // Synthetic tracks for whatever is selected, so multi-track rendering can be checked here too.
  const paths = useMemo(() => {
    const map = new Map<string, PathPoint[]>();
    for (const id of selection.ids) {
      const seed = Number(id.split('/')[1] ?? 0);
      map.set(id, mockPath(seed));
    }
    return map;
  }, [selection.ids]);

  return (
    <div className="flex h-screen flex-col gap-2 p-2">
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-semibold">Cesium preview (dev only)</span>
        <MapControls
          mode="3d"
          onModeChange={() => undefined}
          mesh={mesh}
          onMeshChange={setMesh}
          showTrees={showTrees}
          onShowTreesChange={setShowTrees}
        />
        <span className="text-[11px] opacity-50" data-testid="preview-selection">
          selected: {selection.ids.join(', ') || 'none'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10">
        <CesiumView
          vehicles={VEHICLES}
          selectedIds={selection.ids}
          activeVehicleId={selection.activeId}
          paths={paths}
          mesh={mesh}
          showTrees={showTrees}
          onSelect={(id, additive) =>
            setSelection((current) => applySelect(current, id, additive))
          }
        />
      </div>
    </div>
  );
}
