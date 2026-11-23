import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n';
import type { Twin3DHandle } from '@/twin3d/scene';
import { CaldovaImmersive } from '@/xr/caldovaXr';
import { HEADSET_TOURS } from '@/xr/tours';
import type { XrKind, XrTourState } from '@/xr/xrSession';

declare global {
  interface Window {
    __zwillingXr?: () => Record<string, unknown>;
  }
}

/**
 * Meta Quest entry over the twin: "VR: 1:1" and "AR: Köln on the table", plus the guided tours.
 *
 * Each button appears only where WebXR says that session kind is possible, so a laptop shows
 * nothing. ⚠️ Inside the Fabric portal the app runs in an iframe without `xr-spatial-tracking`, so
 * even the Quest browser answers "not supported" there; that case gets a small "Quest" button with
 * the direct address instead.
 *
 * ⚠️ `enter` must run inside the click handler: a browser grants an immersive session only to a
 * user gesture, never to an effect or a timer.
 */
export function HeadsetControls({
  handle,
  onSync,
  onStart,
}: {
  handle: Twin3DHandle | null;
  onSync: (state: { slot: number; tours: boolean; hall: boolean }) => void;
  /** A session is about to own the clock: the page stops its own playback. */
  onStart: () => void;
}) {
  const { t, locale } = useI18n();
  const [immersive, setImmersive] = useState<CaldovaImmersive | null>(null);
  const [supported, setSupported] = useState<Record<XrKind, boolean>>({ fly: false, tabletop: false });
  const [presenting, setPresenting] = useState(false);
  const [state, setState] = useState<'idle' | 'entering' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [tour, setTour] = useState<XrTourState | null>(null);
  const [toursOpen, setToursOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // The scene reads these at call time, so a language switch reaches the headset without a rebuild.
  const tRef = useRef(t);
  const localeRef = useRef(locale);
  const syncRef = useRef(onSync);
  tRef.current = t;
  localeRef.current = locale;
  syncRef.current = onSync;

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    let created: CaldovaImmersive | null = null;
    // The XR rig is only built where a session is possible: a desktop without a headset keeps the
    // renderer exactly as it was.
    void Promise.all([CaldovaImmersive.supported('fly'), CaldovaImmersive.supported('tabletop')]).then(([fly, tabletop]) => {
      if (cancelled) return;
      setSupported({ fly, tabletop });
      if (!fly && !tabletop) return;
      created = new CaldovaImmersive({
        handle,
        t: () => tRef.current,
        locale: () => localeRef.current,
        onPresentingChange: (on) => setPresenting(on),
        onSync: (synced) => syncRef.current(synced),
      });
      created.mode.onTourChange = setTour;
      window.__zwillingXr = () => created?.telemetry() ?? {};
      setImmersive(created);
    });
    return () => {
      cancelled = true;
      created?.dispose();
      delete window.__zwillingXr;
      setImmersive(null);
    };
  }, [handle]);

  const framed = typeof window !== 'undefined' && window.top !== window.self;
  // Only a headset browser needs the way out of the portal frame; a laptop in the portal sees nothing new.
  const questBrowser = typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent);
  const directUrl = (() => {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('xr', '1');
    return url.toString();
  })();

  const run = async (start: () => Promise<void>) => {
    if (!immersive) return;
    onStart();
    setState('entering');
    setMessage(null);
    try {
      await start();
      setState('idle');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const any = supported.fly || supported.tabletop;
  if (!handle || (!any && !(framed && questBrowser))) return null;

  const busy = presenting || state === 'entering';
  const tours = HEADSET_TOURS.filter((entry) => entry.stops.every((stop) => supported[stop.kind]));
  const kindName = (kind: XrKind) => (kind === 'fly' ? 'VR' : 'AR');
  const button =
    'rounded border border-stone-700 bg-stone-950/85 px-3 py-1.5 text-xs font-semibold text-stone-100 shadow backdrop-blur transition hover:bg-stone-900 disabled:opacity-50';

  return (
    <div
      id="headset"
      data-testid="headset-controls"
      role="group"
      aria-label={t('xr.label')}
      className="absolute left-3 top-3 z-10 flex max-w-[28rem] flex-wrap items-start gap-2"
    >
      {any ? (
        <>
          {tour?.waiting ? (
            <>
              <button type="button" data-xr="continue" className={button} title={tour.title} disabled={busy} onClick={() => void run(() => immersive!.continueTour())}>
                {state === 'entering' ? t('xr.entering') : t('xr.continue', { step: `${tour.index + 1}/${tour.count}`, kind: kindName(tour.kind) })}
              </button>
              <button type="button" data-xr="cancel-tour" className={button} disabled={busy} onClick={() => immersive?.mode.cancelTour()}>
                {t('xr.cancelTour')}
              </button>
            </>
          ) : null}
          {tours.length > 0 && !tour?.waiting ? (
            <div className="relative">
              <button type="button" data-xr="tours" className={button} aria-expanded={toursOpen} disabled={busy} onClick={() => setToursOpen(!toursOpen)}>
                {t('xr.tours')} ▾
              </button>
              {toursOpen ? (
                <div role="group" aria-label={t('xr.toursLabel')} className="absolute left-0 top-full z-20 mt-1 flex min-w-[14rem] flex-col gap-1">
                  {tours.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      data-tour={entry.id}
                      className={`${button} bg-stone-950 text-left`}
                      disabled={busy}
                      onClick={() => {
                        setToursOpen(false);
                        void run(() => immersive!.startTour(entry.id));
                      }}
                    >
                      {entry.name[locale]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {supported.fly ? (
            <button type="button" data-xr="fly" className={button} disabled={busy} onClick={() => void run(() => immersive!.enter('fly'))}>
              {state === 'entering' ? t('xr.entering') : t('xr.fly')}
            </button>
          ) : null}
          {supported.tabletop ? (
            <button type="button" data-xr="tabletop" className={button} disabled={busy} onClick={() => void run(() => immersive!.enter('tabletop'))}>
              {state === 'entering' ? t('xr.entering') : t('xr.tabletop')}
            </button>
          ) : null}
          {state === 'error' && message ? (
            <p role="alert" className="w-full rounded bg-red-900/90 px-3 py-1.5 text-xs text-red-50">
              {t('xr.error')}: {message}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <button type="button" data-xr="link" className={button} aria-expanded={linkOpen} title={t('xr.directTitle')} onClick={() => setLinkOpen(!linkOpen)}>
            {t('xr.quest')}
          </button>
          {linkOpen ? (
            <div className="w-full rounded border border-stone-700 bg-stone-950/90 p-3 text-xs text-stone-200 shadow">
              <p>{t('xr.direct')}</p>
              <a className="mt-1 block break-all text-emerald-300 underline" href={directUrl} target="_blank" rel="noopener noreferrer">
                {directUrl}
              </a>
              <button
                type="button"
                className={`${button} mt-2`}
                onClick={() => {
                  void navigator.clipboard?.writeText(directUrl).then(
                    () => setCopied(true),
                    () => setCopied(false)
                  );
                }}
              >
                {copied ? t('xr.copied') : t('xr.copy')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
