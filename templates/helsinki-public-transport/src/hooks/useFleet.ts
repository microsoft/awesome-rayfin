import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { COUNTERS_DAX, LIVE_VEHICLES_DAX, vehiclePathDax } from '@/data/queries';
import { daxNumber, toPathPoint, toVehicle, type Counters, type PathPoint, type Vehicle } from '@/data/model';
import {
  NeedsPowerBiSignIn,
  getTransport,
  needsPowerBiSignIn,
  runDax,
  subscribeToGateway,
} from '@/services/daxGateway';
import { useDaxQuery } from './useDaxQuery';

/** How often the live layer is refreshed. Matches the source app. */
export const LIVE_POLL_MS = 2000;
const COUNTER_POLL_MS = 15000;

export interface FleetStats {
  vehicles: number;
  moving: number;
  routes: number;
  avgSpeedKmh: number;
}

export function useVehicles() {
  const { rows, loading, error, needsSignIn, updatedAt } = useDaxQuery(
    LIVE_VEHICLES_DAX,
    LIVE_POLL_MS,
  );

  const vehicles = useMemo<Vehicle[]>(
    () => rows.map(toVehicle).filter((v): v is Vehicle => v !== null),
    [rows],
  );

  const stats = useMemo<FleetStats>(() => {
    if (vehicles.length === 0) {
      return { vehicles: 0, moving: 0, routes: 0, avgSpeedKmh: 0 };
    }
    const moving = vehicles.filter((v) => v.speedKmh > 1).length;
    const routes = new Set(vehicles.map((v) => v.route).filter(Boolean)).size;
    const avg = vehicles.reduce((sum, v) => sum + v.speedKmh, 0) / vehicles.length;
    return { vehicles: vehicles.length, moving, routes, avgSpeedKmh: avg };
  }, [vehicles]);

  return { vehicles, stats, loading, error, needsSignIn, updatedAt };
}

export function useCounters(): { counters: Counters; error: string | null } {
  const { rows, error } = useDaxQuery(COUNTERS_DAX, COUNTER_POLL_MS);

  const counters = useMemo<Counters>(() => {
    const row = rows[0];
    if (!row) return { positionsLastHour: 0, positionsTotal: 0 };
    return {
      positionsLastHour: daxNumber(row, 'Positions_last_hour') || 0,
      positionsTotal: daxNumber(row, 'Positions_total') || 0,
    };
  }, [rows]);

  return { counters, error };
}

export function useVehiclePath(vehicleId: string | null): {
  path: PathPoint[];
  loading: boolean;
  error: string | null;
} {
  const query = useMemo(() => (vehicleId ? vehiclePathDax(vehicleId) : null), [vehicleId]);
  const { rows, loading, error } = useDaxQuery(query, vehicleId ? LIVE_POLL_MS * 3 : 0);

  const path = useMemo<PathPoint[]>(
    () => rows.map(toPathPoint).filter((p): p is PathPoint => p !== null),
    [rows],
  );

  return { path, loading, error };
}

const PATH_POLL_MS = LIVE_POLL_MS * 3;

export interface VehiclePaths {
  paths: Map<string, PathPoint[]>;
  /** Vehicles whose track is currently in flight. */
  loadingIds: Set<string>;
  error: string | null;
}

/**
 * Recent tracks for several vehicles at once, for comparing them on the map.
 *
 * `useDaxQuery` can only manage one query, and hooks cannot be called in a loop over a changing
 * list, so this runs its own poll. The tracks are fetched **sequentially**: each one is a
 * TOPN 1000 over DirectQuery, and firing five of those at the Eventhouse simultaneously every
 * few seconds is a good way to make the whole app feel slow.
 */
export function useVehiclePaths(vehicleIds: string[]): VehiclePaths {
  // A primitive key keeps the effect from re-running on every render of a fresh array literal.
  const key = vehicleIds.join('|');
  const [paths, setPaths] = useState<Map<string, PathPoint[]>>(() => new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Re-run as soon as the gateway changes state - e.g. right after an interactive sign-in.
  const gatewayVersion = useSyncExternalStore(
    subscribeToGateway,
    () => `${getTransport() ?? 'auto'}:${needsPowerBiSignIn() ? 'anon' : 'auth'}`,
  );

  useEffect(() => {
    const ids = key ? key.split('|') : [];

    // Forget tracks for vehicles that are no longer selected.
    setPaths((previous) => {
      const next = new Map<string, PathPoint[]>();
      for (const id of ids) {
        const existing = previous.get(id);
        if (existing) next.set(id, existing);
      }
      return next.size === previous.size && ids.length === previous.size ? previous : next;
    });

    if (ids.length === 0) {
      setLoadingIds(new Set());
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      setLoadingIds(new Set(ids));
      let failure: string | null = null;

      for (const id of ids) {
        if (cancelled) return;
        try {
          const rows = await runDax(vehiclePathDax(id));
          if (cancelled) return;
          const points = rows.map(toPathPoint).filter((p): p is PathPoint => p !== null);
          setPaths((previous) => new Map(previous).set(id, points));
        } catch (e) {
          if (cancelled) return;
          // Waiting for a sign-in is not an error the user needs to see here - the banner says so.
          if (!(e instanceof NeedsPowerBiSignIn)) {
            failure = e instanceof Error ? e.message : String(e);
          }
        } finally {
          if (!cancelled) {
            setLoadingIds((previous) => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            });
          }
        }
      }

      if (cancelled) return;
      setError(failure);
      // Schedule the next sweep only once this one has finished, so slow responses cannot stack.
      timer = setTimeout(run, needsPowerBiSignIn() ? 5000 : PATH_POLL_MS);
    };

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, gatewayVersion]);

  return { paths, loadingIds, error };
}
