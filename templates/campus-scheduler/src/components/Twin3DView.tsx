import { useEffect, useRef, useState } from 'react';

import type { AoiConfig } from '@/config/aoi';
import { useI18n } from '@/i18n';
import { initCampus3D, type Campus3DHandle } from '@/twin3d/scene';
import type { LoadStageProgress } from '@/twin3d/terrainLoader';

/**
 * How far through the current stage, or null when the size is not known.
 *
 * ⚠️ UNKNOWN IS A REAL CASE, not a defensive one. The aerial photograph is a JPEG whose size is
 * genuinely not derivable from metadata, so it depends on a Content-Length the static host may not
 * send. The bar then switches to an indeterminate pulse and the megabyte counter carries the
 * reassurance instead — a bar frozen at a made-up percentage is worse than no bar.
 */
function stagePercent(progress: LoadStageProgress | null): number | null {
  if (!progress || progress.totalBytes <= 0) return null;
  return Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100));
}

function formatLoaded(progress: LoadStageProgress | null, locale: string): string {
  if (!progress) return '';
  const format = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const mb = (bytes: number) => format.format(bytes / 1_048_576);
  return progress.totalBytes > 0
    ? `${mb(progress.loadedBytes)} / ${mb(progress.totalBytes)} MB`
    : `${mb(progress.loadedBytes)} MB`;
}

/**
 * Hosts the WebGL canvas and owns the scene's lifetime.
 *
 * The scene is created once per AOI and torn down on unmount. React never touches the contents of
 * the canvas — it hands over a DOM node and gets a handle back, which keeps the render loop out of
 * the reconciler entirely.
 */
export function Twin3DView({
  aoi,
  onReady,
}: {
  aoi: AoiConfig;
  onReady?: (handle: Campus3DHandle) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { t, locale } = useI18n();
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<LoadStageProgress | null>(null);
  const loadingPercent = stagePercent(progress);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let handle: Campus3DHandle | null = null;
    let cancelled = false;

    // Switching university starts a fresh download, so the overlay has to come back rather than
    // stay dismissed from the previous site.
    setReady(false);
    setProgress(null);

    initCampus3D(canvas, aoi, {
      labelHost: labelRef.current ?? undefined,
      onProgress: (update) => {
        if (!cancelled) setProgress(update);
      },
    })
      .then((created) => {
        // An AOI switch that resolves after unmount would otherwise leave an orphaned render loop
        // running against a detached canvas.
        if (cancelled) {
          created.dispose();
          return;
        }
        handle = created;
        setReady(true);
        onReady?.(created);
      })
      .catch((err: unknown) => {
        // The technical cause ("Failed to fetch", a WebGL context message) is English, from the
        // browser, and untranslatable — so it goes to the console for whoever is debugging, and the
        // reader gets a sentence in the language they chose.
        console.error('scene build failed', err);
        // The KEY is stored, not the translated sentence — otherwise the message freezes in whatever
        // language was active at the moment of failure and a later switch leaves it stranded.
        setError('twin.errScene');
      });

    return () => {
      cancelled = true;
      handle?.dispose();
    };
    // `onReady` is deliberately not a dependency: the scene is keyed to the AOI, and a caller
    // passing an inline callback must not tear down and rebuild the whole campus on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoi]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} data-testid="campus-canvas" className="block h-full w-full" />
      <div ref={labelRef} className="pointer-events-none absolute inset-0" />

      {/*
        Tens of megabytes have to arrive before there is anything to look at, and until they do the
        canvas is an empty rectangle that reads as a broken page rather than a loading one.

        The byte counter is deliberately shown alongside the percentage: on a slow link the
        percentage can sit on one number for seconds, and a figure that keeps moving is what
        actually distinguishes "still working" from "stuck". Naming the stage does the same job for
        the wait as a whole — an aerial photograph taking a while is understandable, an unexplained
        blank screen is not.
      */}
      {!ready && !error && (
        <div
          data-testid="twin3d-loading"
          data-stage={progress?.stage ?? 'starting'}
          role="status"
          aria-live="polite"
          className="absolute inset-0 flex items-center justify-center p-8"
        >
          <div className="w-full max-w-sm rounded-lg border border-stone-700 bg-stone-950/90 p-5 shadow-lg backdrop-blur">
            <div className="flex items-baseline justify-between gap-4">
              {/*
                ⚠️ The stone scale in this app is INVERTED against Tailwind's: low numbers are ink,
                high numbers are surfaces, and both flip with the theme. `text-stone-900` here
                would be #f7f6f4 in light mode — the page colour, on a card that is nearly the page
                colour. Titles take stone-100, secondary text stone-200, faint text stone-600.
              */}
              <p className="text-sm font-semibold text-stone-100">{t('twin.loading')}</p>
              <p className="font-mono text-xs text-stone-600">
                {progress
                  ? t('twin.loadingStep', { step: progress.step, of: progress.stepCount })
                  : ''}
              </p>
            </div>

            <p data-testid="twin3d-loading-stage" className="mt-1 text-xs text-stone-200">
              {progress ? t(`twin.loading_${progress.stage}`) : t('twin.loadingStart')}
            </p>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-stone-800">
              <div
                data-testid="twin3d-loading-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={loadingPercent ?? undefined}
                className={
                  loadingPercent === null
                    ? 'h-full w-1/3 animate-pulse rounded-full bg-amber-500/70'
                    : 'h-full rounded-full bg-amber-500 transition-[width] duration-200'
                }
                style={loadingPercent === null ? undefined : { width: `${loadingPercent}%` }}
              />
            </div>

            <p data-testid="twin3d-loading-bytes" className="mt-2 font-mono text-xs text-stone-600">
              {formatLoaded(progress, locale)}
            </p>
          </div>
        </div>
      )}
      {error && (
        <div
          data-testid="scene-error"
          className="absolute inset-x-0 bottom-0 bg-red-900/90 px-4 py-3 text-sm text-red-50"
        >
          {t(error)}
        </div>
      )}
    </div>
  );
}
