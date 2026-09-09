import { useEffect, useState } from 'react';

import { useI18n } from '@/i18n';
import { loadDaySnapshot, type DaySnapshot } from '@/day/snapshot';

/**
 * Mode D — **Der Tag** (PLAN §3, phase 5).
 *
 * Every figure here is the answer to a DAX query against the Direct Lake semantic model over the
 * Fabric Lakehouse, exported by `tools/fabric/export_day.py`. It would have been easier to read the
 * curated CSVs and skip Fabric entirely, and it would have made the whole mode a claim rather than
 * a demonstration.
 *
 * ⚠️ **It is a snapshot, and it says so.** The app deploys as static hosting and cannot hold a
 * Fabric token, so it cannot query the model from the browser. The panel therefore names the model
 * run it came from and when it was taken, in the same spirit as Mode C badging its fallback: a
 * limitation stated is information, a limitation hidden is a bug waiting to be found on stage.
 *
 * ⚠️ **Cloud base is shown with the fraction of the area that actually had cumulus.** ICON-D2
 * reports zero where there is no shallow convection, and a mean over those zeros produced *113 m*
 * on a day with cumulus at 3 080 m. The harvester excludes them; this shows the coverage so that
 * "base at 3 080 m over 4 % of the valley" cannot be read as "base at 3 080 m".
 */

function hourLabel(iso: string): string {
  // The stamps are UTC without a zone marker, as DAX returns them.
  const match = /T(\d{2}):/.exec(iso);
  return match ? `${match[1]}` : '';
}

export function DayPanel({ site }: { site: string }) {
  const { t, locale } = useI18n();
  const [day, setDay] = useState<DaySnapshot | null>(null);
  const [missing, setMissing] = useState(false);

  // ⚠️ Keyed on the site, and re-read when it changes. This used to read the URL once with an empty
  // dependency list, which was correct only because switching site reloaded the page. Flying
  // between sites keeps the component mounted, so without this the Tegelberg would show
  // Oberstdorf's forecast — the same leak as the flight panel, one component along.
  useEffect(() => {
    let cancelled = false;
    setDay(null);
    setMissing(false);
    loadDaySnapshot(site)
      .then((data) => {
        if (cancelled) return;
        // A fresh clone has no snapshot until the Fabric tooling has run. That is a first-run
        // state, like the missing terrain, not a failure.
        if (data) setDay(data);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [site]);

  if (missing || !day) return null;

  const convective = day.hours.filter((h) => h.cloudBaseM !== null);
  const best = convective.length
    ? convective.reduce((a, b) => ((b.cloudBaseM ?? 0) > (a.cloudBaseM ?? 0) ? b : a))
    : null;
  const peakCape = day.hours.reduce((max, h) => Math.max(max, h.capeJkg), 0);
  const freezing = day.hours.find((h) => h.freezingM > 0)?.freezingM ?? null;
  const number = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');

  return (
    <div data-testid="day-panel" className="text-sm text-stone-700">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-[0.16em] text-stone-500">{t('day.label')}</p>
        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-stone-500">
          {t('day.snapshot')}
        </span>
      </div>

      <dl className="mt-2 space-y-1">
        <Row
          label={t('day.cloudBase')}
          value={best?.cloudBaseM ? `${number.format(best.cloudBaseM)} m` : t('day.noConvection')}
          note={
            best
              ? t('day.coverage', {
                  pct: String(Math.round(best.cloudCoverage * 100)),
                  hour: hourLabel(best.validTs),
                })
              : undefined
          }
        />
        <Row label={t('day.cape')} value={`${number.format(peakCape)} J/kg`} />
        {freezing !== null && (
          <Row label={t('day.freezing')} value={`${number.format(freezing)} m`} />
        )}
      </dl>

      {/* The day as a shape rather than a table: one bar per forecast hour, height by cloud base,
          so a working afternoon is visible at a glance and a dead day is visibly dead. */}
      {convective.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.65rem] uppercase tracking-[0.12em] text-stone-500">
            {t('day.byHour')}
          </p>
          <div className="mt-1 flex h-12 items-end gap-px">
            {day.hours.map((hour) => {
              const height = hour.cloudBaseM ? Math.min(100, (hour.cloudBaseM / 4000) * 100) : 0;
              return (
                <div
                  key={hour.stepH}
                  className="flex-1 bg-stone-300"
                  style={{ height: `${Math.max(2, height)}%` }}
                  title={`${hourLabel(hour.validTs)}:00 · ${
                    hour.cloudBaseM ? `${hour.cloudBaseM} m` : t('day.noConvection')
                  }`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[0.6rem] tabular-nums text-stone-400">
            <span>{hourLabel(day.hours[0]?.validTs ?? '')}</span>
            <span>{hourLabel(day.hours[day.hours.length - 1]?.validTs ?? '')}</span>
          </div>
        </div>
      )}

      {day.flights.count > 0 && (
        <dl className="mt-3 space-y-1 border-t border-stone-300 pt-3">
          <Row label={t('day.flights')} value={number.format(day.flights.count)} />
          {day.flights.ceilingM !== null && (
            <Row label={t('day.ceiling')} value={`${number.format(day.flights.ceilingM)} m`} />
          )}
          {day.flights.bestClimbMs !== null && (
            <Row label={t('day.bestClimb')} value={`+${day.flights.bestClimbMs.toFixed(1)} m/s`} />
          )}
          {day.flights.distanceKm !== null && (
            <Row label={t('day.distance')} value={`${day.flights.distanceKm.toFixed(1)} km`} />
          )}
        </dl>
      )}

      <p className="mt-2 text-[0.7rem] leading-relaxed text-stone-500">
        {t('day.notice', { run: day.modelRun.replace('T', ' ').slice(0, 16) })}
      </p>
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right tabular-nums">
        {value}
        {/* An explicit space, not just the margin: a CSS gap is invisible to the accessible name,
            which otherwise reads "3.081 m4 % der Fläche". Same trap as the live panel. */}
        {note && <> <span className="text-[0.65rem] text-stone-400">{note}</span></>}
      </dd>
    </div>
  );
}
