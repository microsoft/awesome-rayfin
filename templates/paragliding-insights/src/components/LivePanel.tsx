import { useI18n } from '@/i18n';
import { FREE_FLIGHT_TYPES, type LiveAircraft, type LiveStatus } from '@/live/ogn';

/**
 * Mode C — what is airborne right now (PLAN §3, phase 4).
 *
 * The panel carries as much weight when the sky is empty as when it is full, which is the whole
 * point of decision 15. Three states, none of them an error:
 *
 *   **live**        aircraft, sorted so free flight is at the top
 *   **empty**       the relay is connected and nobody is flying — a fact, plainly stated
 *   **unavailable** no relay is reachable, so the app shows the recording and says so
 *   **wrong-area** a relay IS reachable but is watching a different AOI — refused rather than drawn
 *
 * The last of those is the normal case for the deployed build: static hosting cannot hold a socket
 * open to APRS-IS. Presenting that as a failure would be misleading, because nothing has failed.
 */

const TYPE_ORDER = ['paraglider', 'hangglider', 'glider'];

/**
 * Types with a translation. Anything outside this set falls back to "unknown" rather than showing
 * the viewer a raw i18n key — OGN can add a type at any time, and this app will not have heard.
 */
const TRANSLATED_TYPES = new Set([
  'paraglider',
  'hangglider',
  'glider',
  'towplane',
  'aircraft',
  'helicopter',
  'jet',
  'balloon',
  'parachute',
  'uav',
  'dropplane',
  'airship',
  'static',
  'ufo',
]);

function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

export function LivePanel({
  status,
  aircraft,
  freeFlightOnly,
  onToggleFreeFlightOnly,
  followId,
  onFollow,
}: {
  status: LiveStatus;
  aircraft: LiveAircraft[];
  freeFlightOnly: boolean;
  onToggleFreeFlightOnly: () => void;
  followId: string | null;
  onFollow: (id: string | null) => void;
}) {
  const { t } = useI18n();

  const visible = freeFlightOnly ? aircraft.filter((a) => FREE_FLIGHT_TYPES.has(a.type)) : aircraft;
  const sorted = [...visible].sort(
    (a, b) => typeRank(a.type) - typeRank(b.type) || b.altM - a.altM
  );

  return (
    <div data-testid="live-panel" data-status={status} className="text-sm text-stone-700">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{t('live.label')}</p>
        <span
          data-testid="live-status"
          className={`text-[0.65rem] uppercase tracking-[0.12em] ${
            status === 'live' ? 'text-emerald-700' : 'text-stone-500'
          }`}
        >
          {status === 'live'
            ? t('live.aircraft', { count: String(sorted.length) })
            : status === 'connecting'
              ? t('live.connecting')
              : status === 'wrong-area'
                ? t('live.wrongArea')
                : t('live.fallback')}
        </span>
      </div>

      {status === 'wrong-area' && (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
          {t('live.wrongAreaHint')}
        </p>
      )}

      {status === 'unavailable' && (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
          {t('live.fallbackHint')} {t('live.unavailableHint')}
        </p>
      )}

      {status === 'live' && sorted.length === 0 && (
        <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
          {t('live.empty')} {t('live.emptyHint')}
        </p>
      )}

      {status === 'live' && (
        <>
          <button
            type="button"
            data-testid="live-freeflight"
            onClick={onToggleFreeFlightOnly}
            aria-pressed={freeFlightOnly}
            className="mt-2 flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-stone-200/70"
            title={t('live.freeFlightOnlyHint')}
          >
            <span>{t('live.freeFlightOnly')}</span>
            <span className="text-xs opacity-70">{freeFlightOnly ? 'on' : 'off'}</span>
          </button>

          <ul className="mt-1 space-y-1">
            {sorted.map((craft) => (
              <li key={craft.id}>
                <button
                  type="button"
                  data-testid={`live-aircraft-${craft.id}`}
                  onClick={() => onFollow(followId === craft.id ? null : craft.id)}
                  aria-pressed={followId === craft.id}
                  className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${
                    followId === craft.id ? 'bg-stone-800 text-stone-50' : 'hover:bg-stone-200/70'
                  }`}
                >
                  <span className="truncate">
                    {t(`live.type_${TRANSLATED_TYPES.has(craft.type) ? craft.type : 'unknown'}`)}{' '}
                    {/* Registration only ever appears for a pilot who registered the device AND
                        left it identifiable. Everyone else is anonymous by construction — the
                        relay never sends a name it was not given permission to send. */}
                    {craft.registration ? (
                      <span className="opacity-70">{craft.registration}</span>
                    ) : (
                      <span className="text-xs opacity-45">{t('live.anonymous')}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums opacity-80">
                    {Math.round(craft.altM)} m
                    {craft.climbMs !== null && (
                      <span className={craft.climbMs >= 0 ? ' text-amber-700' : ' text-sky-800'}>
                        {' '}
                        {craft.climbMs >= 0 ? '+' : ''}
                        {craft.climbMs.toFixed(1)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">{t('live.notice')}</p>
        </>
      )}
    </div>
  );
}
