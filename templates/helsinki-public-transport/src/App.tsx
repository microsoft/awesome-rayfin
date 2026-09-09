import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { ConnectLiveData } from '@/components/ConnectLiveData';
import { FleetPanel } from '@/components/FleetPanel';
import { Header } from '@/components/Header';
import { KpiBar } from '@/components/KpiBar';
import { MapControls, type ViewMode } from '@/components/MapControls';
import { MapView } from '@/components/MapView';
import { VehicleDetail } from '@/components/VehicleDetail';
import {
  EMPTY_SELECTION,
  activate,
  applySelect,
  closeTab,
  pruneSelection,
} from '@/data/selection';
import { LIVE_POLL_MS, useCounters, useVehicles, useVehiclePaths } from '@/hooks/useFleet';
import type { AppEnv } from '@/services/auth';
import { signIn } from '@/services/auth';
import { getRayfinClient } from '@/services/rayfinClient';

// CesiumJS is ~4 MB of JavaScript. Keeping it in its own chunk means opening the 2D map - the
// default - never downloads it. It is warmed in the background once the dashboard is idle (see
// below), so switching to 3D starts fetching tiles rather than starting with a 4 MB download.
const loadCesiumView = () => import('@/components/CesiumView');
const CesiumView = lazy(() => loadCesiumView().then((m) => ({ default: m.CesiumView })));

const THEME_KEY = 'hsl-theme';
const VIEW_KEY = 'hsl-view-mode';

interface AppProps {
  env: AppEnv;
  authenticated: boolean;
  onAuthenticated: () => void;
}

function SignInScreen({ env, onAuthenticated }: { env: AppEnv; onAuthenticated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(env);
      onAuthenticated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-[20px] font-semibold">Helsinki Public Transport Realtime Tracker</h1>
        <p className="mt-2 text-[13px] opacity-60">
          Live vehicle positions from the HSL GTFS-RT feed, streamed through Fabric Real-Time
          Intelligence.
        </p>
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Signing in...' : 'Sign in with Fabric'}
        </button>
        {error ? <p className="mt-3 text-[12px] text-red-400">{error}</p> : null}
      </div>
    </div>
  );
}

function Dashboard() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'dark',
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) as ViewMode) || '2d',
  );
  const [selection, setSelection] = useState(EMPTY_SELECTION);

  // Only used to decide whose comments get a delete affordance - the server enforces the same
  // rule from the JWT, so a wrong value here cannot grant anything.
  const currentUserId = useMemo(() => {
    try {
      return getRayfinClient().auth.getSession().user?.id ?? null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  // Prefetch the 3D chunk once the first paint is out of the way. Deliberately not on the
  // critical path: the live map has to come up first.
  useEffect(() => {
    if (viewMode === '3d') return;
    const timer = window.setTimeout(() => void loadCesiumView(), 3000);
    return () => window.clearTimeout(timer);
  }, [viewMode]);

  const { vehicles, stats, error, needsSignIn, updatedAt } = useVehicles();
  const { counters } = useCounters();
  const { paths, loadingIds } = useVehiclePaths(selection.ids);

  const vehicleIndex = useMemo(
    () => new Map(vehicles.map((v) => [v.vehicleId, v])),
    [vehicles],
  );

  // A vehicle can stop reporting while it is being compared - drop its tab rather than showing
  // a frozen readout.
  useEffect(() => {
    if (vehicles.length === 0) return;
    setSelection((current) => pruneSelection(current, new Set(vehicleIndex.keys())));
  }, [vehicleIndex, vehicles.length]);

  const selectedVehicles = useMemo(
    () =>
      selection.ids
        .map((id) => vehicleIndex.get(id))
        .filter((v): v is NonNullable<typeof v> => v !== undefined),
    [selection.ids, vehicleIndex],
  );

  const handleSelect = useCallback((vehicleId: string | null, additive: boolean) => {
    setSelection((current) => applySelect(current, vehicleId, additive));
  }, []);

  const live = updatedAt !== null && Date.now() - updatedAt < LIVE_POLL_MS * 5;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        live={live && !error}
        updatedAt={updatedAt}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      {needsSignIn ? <ConnectLiveData onConnected={() => undefined} /> : null}

      {error ? (
        <div
          className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] text-red-400"
          role="alert"
        >
          Query failed: {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-0 flex-col gap-3">
          <KpiBar
            vehicles={stats.vehicles}
            moving={stats.moving}
            routes={stats.routes}
            avgSpeedKmh={stats.avgSpeedKmh}
            positionsLastHour={counters.positionsLastHour}
            positionsTotal={counters.positionsTotal}
          />
          <div className="flex items-center justify-between gap-2">
            <MapControls mode={viewMode} onModeChange={setViewMode} />
            {viewMode === '3d' ? (
              <span className="text-[10px] opacity-45">
                Imagery &amp; 3D models &copy; City of Helsinki (CC BY 4.0) &middot; CesiumJS
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10">
            {viewMode === '3d' ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[12px] opacity-60">
                    Loading the 3D scene...
                  </div>
                }
              >
                <CesiumView
                  vehicles={vehicles}
                  selectedIds={selection.ids}
                  activeVehicleId={selection.activeId}
                  paths={paths}
                  onSelect={handleSelect}
                />
              </Suspense>
            ) : (
              <MapView
                vehicles={vehicles}
                selectedIds={selection.ids}
                activeVehicleId={selection.activeId}
                paths={paths}
                theme={theme}
                onSelect={handleSelect}
              />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <VehicleDetail
            vehicles={selectedVehicles}
            activeVehicleId={selection.activeId}
            paths={paths}
            loadingIds={loadingIds}
            onActivate={(id) => setSelection((current) => activate(current, id))}
            onCloseTab={(id) => setSelection((current) => closeTab(current, id))}
            onCloseAll={() => setSelection(EMPTY_SELECTION)}
            currentUserId={currentUserId}
          />
          <div className="min-h-0 flex-1">
            <FleetPanel
              vehicles={vehicles}
              selectedIds={selection.ids}
              activeVehicleId={selection.activeId}
              onSelect={handleSelect}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App({ env, authenticated, onAuthenticated }: AppProps) {
  if (!authenticated) {
    return <SignInScreen env={env} onAuthenticated={onAuthenticated} />;
  }
  return <Dashboard />;
}
