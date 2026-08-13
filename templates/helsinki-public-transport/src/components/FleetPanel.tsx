import { useMemo, useState } from 'react';

import type { Vehicle } from '@/data/model';
import { speedColor, trackColor } from '@/theme';

interface FleetPanelProps {
  vehicles: Vehicle[];
  /** Compared vehicles, in tab order. */
  selectedIds: string[];
  activeVehicleId: string | null;
  onSelect: (vehicleId: string | null, additive: boolean) => void;
}

const MAX_ROWS = 200;

export function FleetPanel({
  vehicles,
  selectedIds,
  activeVehicleId,
  onSelect,
}: FleetPanelProps) {
  const [search, setSearch] = useState('');

  const selectedIndex = useMemo(
    () => new Map(selectedIds.map((id, index) => [id, index])),
    [selectedIds],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? vehicles.filter(
          (v) =>
            v.route.toLowerCase().includes(needle) ||
            v.vehicleId.toLowerCase().includes(needle) ||
            v.label.toLowerCase().includes(needle),
        )
      : vehicles;
    return [...matches].sort((a, b) => b.speedKmh - a.speedKmh).slice(0, MAX_ROWS);
  }, [vehicles, search]);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col gap-2" data-testid="fleet-panel">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold">Fleet</h2>
        <span className="text-[10px] opacity-50">
          {filtered.length === vehicles.length
            ? `${vehicles.length} vehicles`
            : `${filtered.length} of ${vehicles.length}`}
        </span>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter by route or vehicle id"
        aria-label="Filter vehicles"
        className="w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[12px] outline-none placeholder:opacity-40 focus:border-white/25"
      />

      <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto rounded-md border border-white/10">
        {filtered.map((vehicle) => {
          const trackIndex = selectedIndex.get(vehicle.vehicleId);
          const selected = trackIndex !== undefined;
          const active = vehicle.vehicleId === activeVehicleId;
          return (
            <li key={vehicle.vehicleId}>
              <button
                type="button"
                onClick={(event) =>
                  onSelect(
                    vehicle.vehicleId,
                    event.ctrlKey || event.metaKey || event.shiftKey,
                  )
                }
                aria-pressed={selected}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                  active ? 'bg-white/[0.10]' : selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.05]'
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: speedColor(vehicle.speedKmh),
                    // A compared vehicle wears the ring of its track colour.
                    boxShadow: selected ? `0 0 0 2px ${trackColor(trackIndex)}` : undefined,
                  }}
                />
                <span className="w-16 shrink-0 truncate text-[12px] font-medium">
                  {vehicle.route || '-'}
                </span>
                <span className="flex-1 truncate text-[11px] opacity-60">{vehicle.vehicleId}</span>
                <span className="shrink-0 text-[11px] tabular-nums opacity-80">
                  {vehicle.speedKmh.toFixed(0)} km/h
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-2 py-6 text-center text-[11px] opacity-50">No vehicles match.</li>
        ) : null}
      </ul>

      {vehicles.length > MAX_ROWS && !search ? (
        <p className="text-[10px] opacity-40">
          Showing the {MAX_ROWS} fastest. Use the filter to find a specific vehicle.
        </p>
      ) : null}
    </aside>
  );
}
