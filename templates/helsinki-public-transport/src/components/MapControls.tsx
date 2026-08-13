import type { MeshVintage } from '@/cesium/helsinkiOpenData';

export type ViewMode = '2d' | '3d';
export type MeshChoice = MeshVintage | 'off';

interface MapControlsProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  mesh: MeshChoice;
  onMeshChange: (mesh: MeshChoice) => void;
  showTrees: boolean;
  onShowTreesChange: (show: boolean) => void;
}

/**
 * Two surfaces, not four.
 *
 * The city publishes three mesh vintages, but as an app control they were archaeology rather than
 * a feature. Measured from an identical view on a cold cache: 2024 costs **406 MB** of GPU memory
 * against 52 MB for 2017, settles in 10.6 s against 7.9 s, and drags the frame rate from 48 to 36
 * - for a capture whose extra freshness is invisible at the altitudes this app is flown at. 2015
 * is simply the older, blurrier survey that 2017 replaced.
 *
 * What is left is the choice that actually means something: photogrammetry, or the lightweight
 * semantic buildings. CityGML settles in ~2.5 s, so it doubles as the fast option on a slow link.
 */
const MESH_OPTIONS: Array<{ value: MeshChoice; label: string; title: string }> = [
  { value: '2017', label: 'Photoreal', title: 'City-wide photogrammetric mesh, ~7.5 cm/px (2017)' },
  { value: 'off', label: 'Buildings', title: 'Semantic LoD2 buildings - much lighter and quicker to load' },
];

export function MapControls({
  mode,
  onModeChange,
  mesh,
  onMeshChange,
  showTrees,
  onShowTreesChange,
}: MapControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="map-controls">
      <div className="inline-flex overflow-hidden rounded-md border border-white/15">
        {(['2d', '3d'] as ViewMode[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            aria-pressed={mode === value}
            className={`px-2 py-1 text-[11px] font-medium transition-colors ${
              mode === value ? 'bg-white/[0.14]' : 'hover:bg-white/[0.06]'
            }`}
          >
            {value === '2d' ? 'Map' : '3D photoreal'}
          </button>
        ))}
      </div>

      {mode === '3d' ? (
        <>
          <select
            value={mesh}
            onChange={(e) => onMeshChange(e.target.value as MeshChoice)}
            aria-label="3D surface"
            className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-[11px] [&>option]:text-black"
          >
            {MESH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.title}>
                {option.label}
              </option>
            ))}
          </select>

          <label
            title={
              mesh === 'off'
                ? 'Park and street tree models from the Helsinki open data catalogue'
                : 'The photogrammetric mesh already contains the tree canopy - switch to CityGML to add the tree models'
            }
            className={`flex items-center gap-1 text-[11px] ${
              mesh === 'off' ? 'cursor-pointer opacity-70' : 'cursor-not-allowed opacity-35'
            }`}
          >
            <input
              type="checkbox"
              checked={showTrees && mesh === 'off'}
              disabled={mesh !== 'off'}
              onChange={(e) => onShowTreesChange(e.target.checked)}
            />
            Trees
          </label>
        </>
      ) : null}
    </div>
  );
}
