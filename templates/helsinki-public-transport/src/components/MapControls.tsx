export type ViewMode = '2d' | '3d';

interface MapControlsProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

/**
 * One 3D surface, not four.
 *
 * The city also publishes photogrammetric reality meshes, and they were offered here as a
 * `Photoreal` option. They are gone: vehicles are clamped to the terrain rather than to the mesh,
 * so at close range they sank underneath the photogrammetry and disappeared - and a transit map
 * that hides the vehicles when you zoom in has no reason to exist. The tree models went with them;
 * they cost a second tileset for canopy the buildings view barely shows.
 *
 * What is left is the surface that works at every altitude: the textured semantic LoD2 buildings,
 * which settle in ~2.5 s and keep every vehicle on screen.
 */
export function MapControls({ mode, onModeChange }: MapControlsProps) {
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
            {value === '2d' ? 'Map' : '3D city'}
          </button>
        ))}
      </div>
    </div>
  );
}
