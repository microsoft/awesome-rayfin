import type { PathPoint, Vehicle } from '@/data/model';
import { MAX_TRACKED_VEHICLES } from '@/data/selection';
import { trackColor } from '@/theme';

import { SpeedChart } from './SpeedChart';

interface VehicleDetailProps {
  /** The compared vehicles, in tab order. */
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  paths: Map<string, PathPoint[]>;
  loadingIds: Set<string>;
  onActivate: (vehicleId: string) => void;
  onCloseTab: (vehicleId: string) => void;
  onCloseAll: () => void;
}

const OCCUPANCY_LABELS: Record<string, string> = {
  EMPTY: 'Empty',
  MANY_SEATS_AVAILABLE: 'Many seats',
  FEW_SEATS_AVAILABLE: 'Few seats',
  STANDING_ROOM_ONLY: 'Standing only',
  CRUSHED_STANDING_ROOM_ONLY: 'Crowded',
  FULL: 'Full',
  NOT_ACCEPTING_PASSENGERS: 'Not boarding',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] opacity-50">{label}</span>
      <span className="text-[12px] tabular-nums">{value}</span>
    </div>
  );
}

export function VehicleDetail({
  vehicles,
  activeVehicleId,
  paths,
  loadingIds,
  onActivate,
  onCloseTab,
  onCloseAll,
}: VehicleDetailProps) {
  if (vehicles.length === 0) return null;

  const activeIndex = Math.max(
    0,
    vehicles.findIndex((v) => v.vehicleId === activeVehicleId),
  );
  const active = vehicles[activeIndex];
  const path = paths.get(active.vehicleId) ?? [];
  const pathLoading = loadingIds.has(active.vehicleId) && path.length === 0;

  const lastSeen = Number.isFinite(active.timestamp)
    ? new Date(active.timestamp * 1000).toLocaleTimeString()
    : 'unknown';

  return (
    <section
      className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
      data-testid="vehicle-detail"
    >
      {vehicles.length > 1 ? (
        <div
          className="mb-2 flex flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Compared vehicles"
        >
          {vehicles.map((vehicle, index) => {
            const isActive = index === activeIndex;
            return (
              <span
                key={vehicle.vehicleId}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${
                  isActive
                    ? 'border-white/25 bg-white/[0.12]'
                    : 'border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onActivate(vehicle.vehicleId)}
                  className="flex items-center gap-1"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: trackColor(index) }}
                  />
                  {vehicle.route || vehicle.vehicleId}
                </button>
                <button
                  type="button"
                  onClick={() => onCloseTab(vehicle.vehicleId)}
                  aria-label={`Stop comparing ${vehicle.route || vehicle.vehicleId}`}
                  className="opacity-40 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            );
          })}
          {vehicles.length >= MAX_TRACKED_VEHICLES ? (
            <span className="text-[10px] opacity-35">max {MAX_TRACKED_VEHICLES}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {vehicles.length > 1 ? (
            <span
              aria-hidden
              className="mt-1 h-3 w-1 shrink-0 rounded-full"
              style={{ backgroundColor: trackColor(activeIndex) }}
            />
          ) : null}
          <div>
            <h2 className="text-[13px] font-semibold">Route {active.route || 'unknown'}</h2>
            <p className="text-[11px] opacity-50">{active.vehicleId}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseAll}
          aria-label="Clear selection"
          className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/[0.08]"
        >
          Close
        </button>
      </div>

      <div className="mt-2 divide-y divide-white/5">
        <Row label="Speed" value={`${active.speedKmh.toFixed(1)} km/h`} />
        <Row label="Bearing" value={`${active.bearing.toFixed(0)}°`} />
        <Row label="Position" value={`${active.lat.toFixed(5)}, ${active.lon.toFixed(5)}`} />
        <Row
          label="Occupancy"
          value={OCCUPANCY_LABELS[active.occupancy] ?? active.occupancy ?? 'unknown'}
        />
        <Row label="Last seen" value={lastSeen} />
        <Row label="Track" value={pathLoading ? 'loading...' : `${path.length} points (2 h)`} />
      </div>

      <SpeedChart path={path} loading={pathLoading} />

      {vehicles.length === 1 ? (
        <p className="mt-2 text-[10px] opacity-35">
          Ctrl-click another vehicle to compare their tracks.
        </p>
      ) : null}
    </section>
  );
}
