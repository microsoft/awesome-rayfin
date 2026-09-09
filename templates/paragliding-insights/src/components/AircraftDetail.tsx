import { useI18n } from '@/i18n';
import type { LiveAircraft } from '@/live/ogn';

/**
 * One selected aircraft, in detail — PLAN §3 Mode C.
 *
 * Opened by clicking the aircraft in the scene. Everything here is a field the relay actually
 * sent; nothing is derived, estimated or filled in. A missing value is shown as missing, because
 * "we do not know" is a real answer about live traffic and a guess is not.
 *
 * ⚠️ **Identity is shown only when the pilot allowed it.** The relay drops `no-track` devices
 * server-side and rewrites `no-identify` ones to a salted `anon-…` id before they ever reach the
 * browser (§2.2.1), so an anonymous aircraft has no registration, model or competition number to
 * display — and this component must not invent a label to fill the gap. It says the aircraft is
 * anonymous instead, which is the truth and is also the more interesting statement.
 */
export interface AircraftDetailProps {
  aircraft: LiveAircraft;
  onClose: () => void;
  onFollow: (id: string) => void;
  following: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="tabular-nums text-stone-800">{value}</dd>
    </div>
  );
}

export function AircraftDetail({ aircraft, onClose, onFollow, following }: AircraftDetailProps) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');

  const anonymous = aircraft.id.startsWith('anon-');
  const ageS = Math.max(0, Math.round(Date.now() / 1000 - aircraft.t));

  // The OGN live map, centred on this aircraft's position.
  //
  // A link-out rather than an embed: it needs no licence, it sends the traffic to the network that
  // actually produced this data, and it shows the viewer the same aircraft in its own source. It
  // is deliberately a POSITION link, not a device link — a device page would attach a permanent
  // identity to an aircraft this app has just promised to keep anonymous.
  const sourceUrl = `https://live.glidernet.org/#c=${aircraft.lat.toFixed(5)},${aircraft.lon.toFixed(
    5
  )}&z=12&s=1`;

  return (
    <section
      data-testid="aircraft-detail"
      data-aircraft={aircraft.id}
      className="mt-3 rounded border border-stone-300 bg-stone-50/95 p-3 text-xs"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-500">
          {t(`live.type_${aircraft.type}`)}
        </p>
        <button
          type="button"
          data-testid="aircraft-detail-close"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-200/70"
          aria-label={t('live.close')}
        >
          ✕
        </button>
      </div>

      <p className="mb-2 text-sm text-stone-900">
        {anonymous ? t('live.anonymous') : (aircraft.registration ?? aircraft.cn ?? aircraft.id)}
      </p>
      {!anonymous && aircraft.model && <p className="mb-2 text-stone-600">{aircraft.model}</p>}

      <dl className="space-y-1">
        <Row label={t('live.altitude')} value={`${number.format(Math.round(aircraft.altM))} m`} />
        {aircraft.climbMs !== null && (
          <Row
            label={t('live.climb')}
            value={`${aircraft.climbMs >= 0 ? '+' : ''}${aircraft.climbMs.toFixed(1)} m/s`}
          />
        )}
        {aircraft.groundMs !== null && (
          <Row
            label={t('live.groundSpeed')}
            value={`${Math.round(aircraft.groundMs * 3.6)} km/h`}
          />
        )}
        {aircraft.courseDeg !== null && (
          <Row label={t('live.course')} value={`${Math.round(aircraft.courseDeg)}°`} />
        )}
        {/* The age of the fix, always — a live map that shows a stale position as current is the
            one thing Mode C must never do. */}
        <Row label={t('live.lastFix')} value={t('live.secondsAgo', { seconds: String(ageS) })} />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="aircraft-detail-follow"
          onClick={() => onFollow(aircraft.id)}
          className={`rounded border px-2 py-1 ${
            following
              ? 'border-stone-800 bg-stone-800 text-stone-50'
              : 'border-stone-400 hover:bg-stone-200/70'
          }`}
        >
          {t('live.follow')}
        </button>
        <a
          data-testid="aircraft-detail-source"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded border border-stone-400 px-2 py-1 text-stone-700 hover:bg-stone-200/70"
        >
          {t('live.openSource')} ↗
        </a>
      </div>

      <p className="mt-2 text-[0.65rem] leading-relaxed text-stone-500">{t('live.sourceNote')}</p>
    </section>
  );
}
