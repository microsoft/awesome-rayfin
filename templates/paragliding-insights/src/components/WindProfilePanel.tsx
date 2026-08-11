import { useI18n } from '@/i18n';
import { compassPoint, type WindProfile } from '@/flight/wind';

/**
 * The wind profile the flight measured about itself — PLAN §5.5.
 *
 * Every row here comes from the drift of a full 360° turn the pilot actually flew. There is no
 * model behind it and no archive: the label says *aus dem Flug abgeleitet* because that is exactly
 * what it is.
 *
 * ⚠️ The gaps are the honest part and are shown rather than filled. Wind exists at an altitude only
 * if the pilot circled at that altitude, so a glide contributes nothing and a band that was only
 * ever crossed on a straight line stays empty. Interpolating across those gaps would turn a
 * measurement into a guess while looking more complete.
 */

export interface WindProfilePanelProps {
  profile: WindProfile;
}

export function WindProfilePanel({ profile }: WindProfilePanelProps) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: 1,
  });

  if (profile.bands.length === 0) {
    return (
      <p data-testid="wind-empty" className="text-xs leading-relaxed text-stone-500">
        {t('flight.windNone')}
      </p>
    );
  }

  const fastest = Math.max(...profile.bands.map((band) => band.speedMs));
  const descending = [...profile.bands].reverse();

  return (
    <div data-testid="wind-profile">
      <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{t('flight.wind')}</p>
      <ul className="mt-2 space-y-0.5">
        {descending.map((band) => (
          <li key={band.altM} className="flex items-center gap-2 text-xs tabular-nums">
            <span className="w-14 shrink-0 text-right text-stone-500">
              {nf.format(band.altM)} m
            </span>
            {/* An arrow pointing the way the wind is going, from a bearing that says where it comes
                from — hence the 180° turn. Pilots read "Wind aus West"; an arrow that pointed at
                the west would be backwards. */}
            <span
              className="w-4 shrink-0 text-center text-stone-700"
              style={{ transform: `rotate(${band.fromDeg + 180}deg)` }}
              aria-hidden
            >
              ↑
            </span>
            <span className="w-10 shrink-0 text-stone-700">{compassPoint(band.fromDeg)}</span>
            <span className="relative h-1.5 flex-1 rounded-full bg-stone-200">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-stone-600"
                style={{ width: `${(band.speedMs / Math.max(fastest, 0.1)) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 whitespace-nowrap text-right text-stone-700">
              {nf.format(band.speedMs * 3.6)} km/h
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
        {t('flight.windDerived', { turns: String(profile.samples.length) })}
      </p>
    </div>
  );
}
