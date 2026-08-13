import { compassPoint } from '@/data/bearing';
import type { PathPoint, Vehicle } from '@/data/model';
import { MAX_TRACKED_VEHICLES } from '@/data/selection';
import { STOPPED_BELOW_KMH, trackColor } from '@/theme';

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

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 opacity-40" aria-hidden>
      <path
        fill="currentColor"
        d="M8 1.5a4 4 0 0 0-4 4c0 2.9 4 8.5 4 8.5s4-5.6 4-8.5a4 4 0 0 0-4-4Zm0 5.6a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"
      />
    </svg>
  );
}

function SeatIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 opacity-40" aria-hidden>
      <path fill="currentColor" d="M4 2h2v7H4V2Zm3 7h5v2H7V9Zm-3 3h8v2H4v-2Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 opacity-40" aria-hidden>
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.6 6.8L11 9.7l-.6 1-3-1.8V4h1.2v4.3Z"
      />
    </svg>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-[11px] opacity-60">
        {icon}
        {label}
      </span>
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

  const lastReport = Number.isFinite(active.timestamp)
    ? new Date(active.timestamp * 1000).toLocaleTimeString()
    : 'unknown';
  const moving = active.speedKmh >= STOPPED_BELOW_KMH;
  const accent = trackColor(activeIndex);
  // ⚠️ Trains report no occupancy at all, and the feed sends '' rather than omitting the field -
  // an empty string is not nullish, so `?? 'unknown'` alone left the row blank.
  const occupancy = active.occupancy?.trim();

  return (
    <section
      className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
      data-testid="vehicle-detail"
    >
      {/*
        The tab strip carries the whole multi-selection, so it stays put and only the panel below
        it swaps. Labels are the route alone - at this width "Route 1030" across five tabs wraps
        into an unreadable stack, and the route number is what tells them apart anyway.
      */}
      <div className="mb-2 flex items-center gap-1">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Compared vehicles"
        >
          {vehicles.map((vehicle, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={vehicle.vehicleId}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onActivate(vehicle.vehicleId)}
                onAuxClick={(event) => {
                  if (event.button === 1) onCloseTab(vehicle.vehicleId);
                }}
                title={`Route ${vehicle.route || 'unknown'} - ${vehicle.vehicleId}`}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-1 text-[11px] transition-colors ${
                  isActive
                    ? 'border-white/70 bg-white/[0.08] text-white'
                    : 'border-transparent opacity-60 hover:bg-white/[0.05] hover:opacity-100'
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: trackColor(index) }}
                />
                {vehicle.route || vehicle.vehicleId}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => (vehicles.length > 1 ? onCloseTab(active.vehicleId) : onCloseAll())}
          aria-label={
            vehicles.length > 1
              ? `Stop comparing ${active.route || active.vehicleId}`
              : 'Clear selection'
          }
          className="shrink-0 rounded px-1.5 text-[14px] leading-none opacity-40 hover:bg-white/[0.08] hover:opacity-100"
        >
          ×
        </button>
      </div>

      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold">Route {active.route || 'unknown'}</h2>
          <p className="text-[11px] opacity-50">{active.vehicleId}</p>
        </div>
      </div>

      <div className="mt-2 rounded-lg bg-white/[0.05] py-3 text-center">
        <div className="text-[36px] font-bold leading-none tabular-nums">
          {active.speedKmh.toFixed(1)}
        </div>
        <div className="mt-1 text-[10px] tracking-wider opacity-50">KM/H</div>
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${
            moving ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'
          }`}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${moving ? 'bg-emerald-400' : 'bg-amber-400'}`}
          />
          {moving ? 'MOVING' : 'STOPPED'}
        </span>
      </div>

      <div className="mt-2 rounded-lg bg-white/[0.05] py-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5 opacity-70"
            style={{ transform: `rotate(${active.bearing}deg)` }}
            aria-hidden
          >
            <path fill="currentColor" d="M8 1.5 13 14 8 11.2 3 14 8 1.5Z" />
          </svg>
          <span className="text-[36px] font-bold leading-none tabular-nums">
            {active.bearing.toFixed(0)}°
          </span>
        </div>
        <div className="mt-1 text-[10px] tracking-wider opacity-50">
          BEARING · {compassPoint(active.bearing)}
        </div>
      </div>

      <div className="mt-2 divide-y divide-white/5">
        <Row
          icon={<PinIcon />}
          label="Position"
          value={`${active.lat.toFixed(5)}, ${active.lon.toFixed(5)}`}
        />
        <Row
          icon={<SeatIcon />}
          label="Occupancy"
          value={occupancy ? (OCCUPANCY_LABELS[occupancy] ?? occupancy) : 'not reported'}
        />
        <Row icon={<ClockIcon />} label="Last report" value={lastReport} />
      </div>

      <SpeedChart path={path} loading={pathLoading} />

      <p className="mt-2 text-[10px] opacity-35">
        {vehicles.length === 1
          ? 'Ctrl-click another vehicle to compare their tracks.'
          : `${vehicles.length} of ${MAX_TRACKED_VEHICLES} compared - middle-click a tab to drop it.`}
      </p>
    </section>
  );
}
