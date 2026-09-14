import { useI18n } from '@/i18n';
import type { WebcamMarker } from '@/twin3d/webcamLayer';

/**
 * One webcam, and a way out to the picture — PLAN §5.9, decision 26.
 *
 * ⚠️ **There is no image here, and that is the licence rather than an omission.** foto-webcam.eu's
 * terms forbid distributing, altering or copying their pictures without written consent, and in
 * the same sentence welcome links to their pages. So this card is a signpost: it says where the
 * camera is, which way it looks, and offers the operator's own page in a new tab. Fetching the
 * JPEG to show it here would be the one thing they explicitly disallow, and it would also cost
 * them the bandwidth.
 *
 * The card names the operator, because the same terms ask for it and because a viewer should know
 * whose picture they are about to open.
 */
export interface WebcamCardProps {
  camera: WebcamMarker;
  onClose: () => void;
  onFocus: (camera: WebcamMarker) => void;
}

/** Degrees to the nearest compass point, in the display language. */
function compass(bearingDeg: number, locale: string): string {
  const de = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const points = locale === 'de' ? de : en;
  return points[Math.round(((bearingDeg % 360) / 45)) % 8];
}

export function WebcamCard({ camera, onClose, onFocus }: WebcamCardProps) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');

  return (
    <section
      data-testid="webcam-card"
      data-webcam={camera.id}
      className="mt-3 rounded border border-stone-300 bg-stone-50/95 p-3 text-xs"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-500">
          {t('webcam.label')}
        </p>
        <button
          type="button"
          data-testid="webcam-card-close"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-200/70"
          aria-label={t('live.close')}
        >
          ✕
        </button>
      </div>

      <p className="mb-2 text-sm text-stone-900">{camera.name}</p>

      <dl className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-stone-500">{t('live.altitude')}</dt>
          <dd className="tabular-nums text-stone-800">{number.format(camera.eleM)} m</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-stone-500">{t('webcam.direction')}</dt>
          <dd className="tabular-nums text-stone-800">
            {compass(camera.bearingDeg, locale)} · {Math.round(camera.bearingDeg)}°
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-stone-500">{t('webcam.operator')}</dt>
          <dd className="text-right text-stone-800">{camera.operator}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="webcam-card-focus"
          onClick={() => onFocus(camera)}
          className="rounded border border-stone-400 px-2 py-1 hover:bg-stone-200/70"
        >
          {t('webcam.standHere')}
        </button>
        <a
          data-testid="webcam-card-open"
          href={camera.page}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded border border-stone-800 bg-stone-800 px-2 py-1 text-stone-50 hover:bg-stone-700"
        >
          {t('webcam.open')} ↗
        </a>
      </div>

      <p className="mt-2 text-[0.65rem] leading-relaxed text-stone-500">{t('webcam.note')}</p>
    </section>
  );
}
