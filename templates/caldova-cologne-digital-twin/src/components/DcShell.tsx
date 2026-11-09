import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { DayScrubber } from '@/components/DayScrubber';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Twin3DView } from '@/components/Twin3DView';
import { activeAoi } from '@/config/aoi';
import { currentBrand, placeName } from '@/config/brand';
import { NUMBER_LOCALE, useI18n } from '@/i18n';
import { useOfflineState } from '@/offline';
import { useTheme } from '@/theme';
import logoUrl from '@reorder/assets/caldova-logo.svg';
import { ReorderApp } from '@reorder/ReorderApp';
// The Finance tab (src/finance/SOURCE.md) is code-split: its cockpit, exports and vendor visuals load on first open.
const FinanceApp = lazy(() => import('@finance/FinanceApp').then((m) => ({ default: m.FinanceApp })));
import { useLive } from '@/reorder-live/useLive';
import type { Twin3DHandle } from '@/twin3d/scene';
import { OPENING_SLOT } from '@/twin3d/tours';

/**
 * The shell for the Caldova Cologne twin (PLAN v1 scope, D9): the photoreal core, the exploded
 * Caldova Logistikzentrum and the driving tours. Night scene, CO₂ what-if, chat and the deviation
 * log came with the engine and are deliberately not here.
 *
 * ⚠️ A CONTROL APPEARS ONLY WHEN ITS DATA HAS LOADED. The hall button needs the interior model, the
 * tours button needs the tours, the mesh switch needs the mesh. A button that opens nothing is the
 * engine's most repeated defect, and every instance looked finished.
 *
 * ⚠️ NO TYPED NUMBERS. Every figure below is read from the scene handle or the measured metadata and
 * formatted through Intl (dcValues.test.ts enforces it).
 */
export function DcShell() {
  const aoi = activeAoi();
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const offline = useOfflineState();
  const [handle, setHandle] = useState<Twin3DHandle | null>(null);
  const [hallOpen, setHallOpen] = useState(false);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [toursOn, setToursOn] = useState(false);
  const [meshOn, setMeshOn] = useState(false);
  const [slot, setSlotState] = useState(OPENING_SLOT);
  const [scene, setScene] = useState<{ buildings: number; hasDrape: boolean } | null>(null);
  // Three tabs. The twin stays MOUNTED behind the other tabs, so switching back never
  // reloads the scene; the live reorder state lives here so it survives a switch too.
  const [tab, setTab] = useState<'twin' | 'reorder' | 'finance'>('twin');
  // Mounted on first open and then kept (hidden) like the twin, so its view state survives a switch.
  const [financeOpened, setFinanceOpened] = useState(false);
  useEffect(() => {
    if (tab === 'finance') setFinanceOpened(true);
  }, [tab]);
  const live = useLive(tab === 'reorder');

  const ops = handle?.dcInterior?.meta ?? null;
  const zone = ops?.zones.find((z) => z.id === zoneId) ?? null;

  const onReady = useCallback((created: Twin3DHandle) => {
    setHandle(created);
    setScene({ buildings: created.buildingCount, hasDrape: created.hasDrape });
    setMeshOn(created.meshVisible());
    created.onZonePicked((id) => setZoneId(id));
    created.onDcOpenChanged((open) => {
      setHallOpen(open);
      if (!open) setZoneId(null);
    });
  }, []);

  const toggleHall = useCallback(() => {
    if (handle) handle.openDc(!hallOpen);
  }, [handle, hallOpen]);

  const toggleMesh = useCallback(() => {
    if (!handle) return;
    handle.setMeshVisible(!meshOn);
    setMeshOn(handle.meshVisible());
  }, [handle, meshOn]);

  const setSlot = useCallback(
    (next: number) => {
      setSlotState(next);
      // Idempotent: while playing, the scrubber drives the scene with a FRACTIONAL slot.
      if (handle && Math.floor(handle.dcSlot()) !== next) handle.setDcSlot(next);
    },
    [handle]
  );

  const toggleTours = useCallback(() => {
    if (!handle) return;
    const next = !toursOn;
    setToursOn(next);
    handle.setToursVisible(next);
    if (next && hallOpen) {
      setHallOpen(false);
      handle.openDc(false, false); // the camera is already flying to the tours overview
      setZoneId(null);
    }
  }, [handle, toursOn, hallOpen]);

  const pickZone = useCallback(
    (id: string) => {
      const next = id === zoneId ? null : id;
      setZoneId(next);
      handle?.selectZone(next);
    },
    [handle, zoneId]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The hidden twin must not react while the reorder tab is in front.
      if (event.key !== 'Escape' || !handle || tab !== 'twin') return;
      if (zoneId) {
        setZoneId(null);
        handle.selectZone(null);
      } else if (hallOpen) {
        setHallOpen(false);
        handle.openDc(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handle, hallOpen, zoneId, tab]);

  // Land on the Caldova Logistikzentrum, not on a bounding-box centre.
  useEffect(() => {
    if (!handle) return;
    const timer = window.setTimeout(() => handle.focusPlace('logistikzentrum'), 400);
    return () => window.clearTimeout(timer);
  }, [handle]);

  const number = new Intl.NumberFormat(NUMBER_LOCALE);
  const decimal1 = new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const mesh = handle?.meshCore ?? null;

  return (
    <div className="flex h-dvh w-dvw flex-col bg-stone-950 text-stone-100">
      <header data-testid="dc-shell-header" className="flex shrink-0 items-center gap-4 border-b border-stone-800 bg-stone-900 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={logoUrl}
            alt="Caldova"
            className={`h-5 w-auto shrink-0 ${theme === 'dark' ? 'brightness-0 invert' : ''}`}
          />
          <span className="h-7 w-px shrink-0 bg-stone-700" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-stone-100">
              {currentBrand().site[locale] ?? currentBrand().site.en}
            </p>
            <p className="truncate text-xs text-stone-500">
              {currentBrand().tagline[locale] ?? currentBrand().tagline.en}
            </p>
          </div>
        </div>
        <nav className="ml-4 flex items-center gap-1" role="tablist" aria-label={t('tabs.label')}>
          {(['twin', 'reorder', 'finance'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`tab-${id}`}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded px-3 py-1 text-xs font-semibold transition ${
                tab === id ? 'bg-emerald-700 text-white' : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {offline.kind !== 'unsupported' && (
            <span
              data-testid="offline-chip"
              title={t('offline.hint')}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                offline.kind === 'ready' || offline.kind === 'updated'
                  ? 'bg-emerald-900/60 text-emerald-200'
                  : offline.kind === 'failed'
                    ? 'bg-red-900/60 text-red-200'
                    : 'bg-stone-800 text-stone-300'
              }`}
            >
              {offline.kind === 'ready'
                ? t('offline.ready')
                : offline.kind === 'updated'
                  ? t('offline.updated')
                  : offline.kind === 'failed'
                  ? t('offline.failed')
                  : t('offline.caching', {
                      percent: offline.total ? Math.round((100 * offline.done) / offline.total) : 0,
                    })}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>

      {financeOpened && (
        <div className={`min-h-0 flex-1 overflow-y-auto ${tab === 'finance' ? '' : 'hidden'}`} data-finance-shown={tab === 'finance' ? '' : undefined}>
          <Suspense fallback={<p className="p-6 text-sm text-stone-400">{t('tabs.loading')}</p>}>
            <FinanceApp active={tab === 'finance'} />
          </Suspense>
        </div>
      )}
      {tab === 'reorder' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ReorderApp live={live} />
        </div>
      )}
      <div className={`min-h-0 flex-1 ${tab === 'twin' ? 'flex' : 'hidden'}`}>
        <main className="relative min-w-0 flex-1">
          <Twin3DView aoi={aoi} onReady={onReady} />
        </main>

        <aside
          data-testid="dc-panel"
          className="w-[22rem] shrink-0 overflow-y-auto border-l border-stone-800 bg-stone-900 p-4 text-sm"
        >
          {/* ── the city model ─────────────────────────────────────────────── */}
          {mesh && (
            <section data-testid="mesh-section">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {t('mesh.heading')}
              </h2>
              <button
                type="button"
                data-testid="mesh-toggle"
                aria-pressed={meshOn}
                onClick={toggleMesh}
                className={`mt-2 w-full rounded px-3 py-2 text-sm font-semibold transition ${
                  meshOn
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'border border-emerald-700 text-emerald-300 hover:bg-stone-800'
                }`}
              >
                {meshOn ? t('mesh.showLod2') : t('mesh.showMesh')}
              </button>
              <dl className="mt-2 space-y-1.5">
                <Fact label={t('mesh.tiles')} value={`${number.format(mesh.loaded)} / ${number.format(mesh.tiles)}`} measured />
                <Fact label={t('mesh.vertices')} value={number.format(mesh.vertices)} measured />
                <Fact label={t('mesh.texels')} value={`${decimal1.format(mesh.texels / 1e6)} ${t('mesh.megatexel')}`} />
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">{t('mesh.note')}</p>
            </section>
          )}

          {/* ── the hall ────────────────────────────────────────────────────── */}
          {ops && (
            <section className={mesh ? 'mt-5' : ''} data-testid="dc-hall">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {t('dc.hall')}
              </h2>
              <button
                type="button"
                data-testid="hall-toggle"
                aria-pressed={hallOpen}
                onClick={toggleHall}
                disabled={!handle}
                className={`mt-2 w-full rounded px-3 py-2 text-sm font-semibold transition disabled:opacity-40 ${
                  hallOpen
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'border border-emerald-700 text-emerald-300 hover:bg-stone-800'
                }`}
              >
                {hallOpen ? t('dc.hallClose') : t('dc.hallOpen')}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">{t('dc.hallHint')}</p>

              {hallOpen && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    {t('dc.chainHeading')}
                  </h3>
                  <ol className="mt-2 space-y-0.5" data-testid="zone-list">
                    {ops.zones.map((z) => (
                      <li key={z.id}>
                        <button
                          type="button"
                          data-testid={`zone-${z.id}`}
                          aria-pressed={z.id === zoneId}
                          onClick={() => pickZone(z.id)}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${
                            z.id === zoneId ? 'bg-stone-800 text-stone-100' : 'text-stone-300 hover:bg-stone-800'
                          }`}
                        >
                          <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: z.colour }} />
                          <span className="truncate">{z.name[locale] ?? z.name.en}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 rounded border border-stone-800 bg-stone-950/60 p-2" data-testid="zone-detail">
                    {zone ? (
                      <>
                        <p className="text-xs font-semibold text-stone-100">{zone.name[locale] ?? zone.name.en}</p>
                        <p className="mt-1 text-xs leading-relaxed text-stone-400">{zone.note[locale] ?? zone.note.en}</p>
                        <dl className="mt-2 space-y-1">
                          <Fact label={t('dc.zoneArea')} value={`${number.format(Math.round(zone.areaM2))} m²`} />
                          {zone.tempC !== null && <Fact label={t('dc.zoneTemp')} value={`${zone.tempC} °C`} />}
                        </dl>
                      </>
                    ) : (
                      <p className="text-xs leading-relaxed text-stone-500">{t('dc.zoneNone')}</p>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── places ───────────────────────────────────────────────────── */}
          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('dc.places')}</h2>
            <ul className="mt-2 space-y-1">
              {aoi.focusPlaces.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    data-testid={`place-${place.id}`}
                    onClick={() => handle?.activatePlace(place.id)}
                    disabled={!handle}
                    className="w-full rounded border border-stone-800 px-2 py-1.5 text-left text-stone-200 transition hover:border-emerald-600 hover:bg-stone-800 disabled:opacity-40"
                  >
                    {placeName(place.id, { en: place.name })[locale] ?? place.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* ── the site, measured ──────────────────────────────────────────── */}
          <section className="mt-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('dc.siteFacts')}</h2>
            <dl className="mt-2 space-y-1.5">
              <Fact label={t('dc.factAddress')} value="Koelnmesse, 50679 Cologne-Deutz" />
              <Fact label={t('dc.factBuildings')} value={scene ? number.format(scene.buildings) : '…'} measured />
              {ops && (
                <Fact label={t('dc.factFootprint')} value={`${number.format(Math.round(ops.envelope.footprintM2))} m²`} measured />
              )}
            </dl>
          </section>

          {/* ── the last mile ────────────────────────────────────────────────── */}
          {handle?.tours && (
            <section className="mt-5" data-testid="dc-tours">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('dc.toursHeading')}</h2>
              <button
                type="button"
                data-testid="tours-toggle"
                aria-pressed={toursOn}
                onClick={toggleTours}
                className={`mt-2 w-full rounded px-3 py-2 text-sm font-semibold transition ${
                  toursOn ? 'bg-sky-700 text-white hover:bg-sky-600' : 'border border-sky-800 text-sky-300 hover:bg-stone-800'
                }`}
              >
                {toursOn ? t('dc.toursHide') : t('dc.toursShow')}
              </button>
              <dl className="mt-2 space-y-1.5">
                <Fact label={t('dc.toursDrops')} value={number.format(handle.tours.dropCount())} />
                <Fact label={t('dc.toursRoutes')} value={number.format(handle.tours.tourCount())} />
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-stone-500">{t('dc.toursNote')}</p>
            </section>
          )}

          {/* ── the operating day ───────────────────────────────────────────── */}
          {ops && <DayScrubber handle={handle} slot={slot} onSlot={setSlot} />}

          {/* ── provenance ──────────────────────────────────────────────────── */}
          <section className="mt-5" data-testid="dc-provenance">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('dc.provenance')}</h2>
            <div className="mt-2 rounded border border-emerald-800/60 bg-emerald-950/30 p-2">
              <p className="text-xs font-semibold text-emerald-300">{t('dc.provMeasured')}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-300">{t('dc.provMeasuredBody')}</p>
            </div>
            <div className="mt-2 rounded border border-amber-800/60 bg-amber-950/30 p-2">
              <p className="text-xs font-semibold text-amber-300">{t('dc.provSynthetic')}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-300">{t('dc.provSyntheticBody')}</p>
            </div>
          </section>

          {/* ── attribution ─────────────────────────────────────────────────── */}
          <section className="mt-5 border-t border-stone-800 pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('dc.attribution')}</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
              {aoi.geobasis.attribution}
              {mesh && (
                <>
                  <br />
                  {t('mesh.attribution')}
                </>
              )}
              <br />© OpenStreetMap contributors, ODbL 1.0
              <br />
              {aoi.shellGeobasis.attribution}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value, measured }: { label: string; value: string; measured?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-stone-500">{label}</dt>
      <dd className="text-right text-xs font-medium text-stone-200">
        {value}
        {measured && (
          <span className="ml-1 text-emerald-500" title="measured">
            ●
          </span>
        )}
      </dd>
    </div>
  );
}
