import { useMemo } from 'react';

import { useI18n } from '@/i18n';
import { rampColour } from '@/lenses/occupancy/OccupancyPanel';
import type { BuildingView, RoomLayer } from '@/twin3d/rooms';

/**
 * Auswertung — room utilisation, as a report rather than as a control.
 *
 * ⚠️ THIS IS A MAIN VIEW, AND THAT IS THE POINT. The same figures lived in the occupancy lens, in
 * a 384 px column that also carries the assistant. That column is the right home for a CONTROL —
 * open a building, pick a room, scrub the week — and the wrong one for a table a space planner
 * argues with: every building, its rooms, its share of the teaching week. At that width the rows
 * wrapped into a ribbon and the numbers could not be compared down a column, which is the only
 * thing anybody wants to do with them.
 *
 * ⚠️ THE COST IS REAL AND ACCEPTED. While this is open the occupancy lens is not on screen, so a
 * room cannot be selected from the side panel. Closing it puts the campus and its controls back
 * untouched — see `mainView` in `TwinShell`, which OVERLAYS rather than unmounts, so the WebGL
 * scene is never rebuilt (§28).
 *
 * The measure is TIME utilisation — the share of the teaching week a room is committed — not seat
 * occupancy. That is what space planners plan against, and it needs nothing invented to compute.
 */

export function AnalysisView({ layer }: { layer: RoomLayer }) {
  const { t, locale } = useI18n();
  const intl = locale === 'de' ? 'de-DE' : 'en-GB';
  const percent = (v: number) =>
    new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: 0 }).format(v);
  const number = (v: number) => new Intl.NumberFormat(intl).format(v);

  const rows = useMemo(
    () =>
      [...layer.buildings]
        .filter((b) => b.roomCount > 0)
        .sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1)),
    [layer.buildings]
  );

  /**
   * ⚠️ WEIGHTED BY `bookedRooms`, NOT BY `roomCount`, AND NOT A MEAN OF MEANS.
   *
   * Two mistakes are available here and the first version made the second one. Averaging the
   * per-building percentages gives a two-room outbuilding the same weight as a 300-room faculty,
   * which is how a campus that is mostly busy reports as mostly idle. So weight by rooms — but by
   * WHICH rooms? `BuildingView.utilisation` is the mean over the teaching rooms that have a
   * calendar (`bookedRooms`), so weighting it by `roomCount` multiplies a figure describing 4 rooms
   * by the 60 rooms in the building. Buildings whose calendar coverage is thin would then dominate
   * a total they barely contribute to.
   *
   * Buildings with no calendar at all are excluded rather than counted as zero — an unknown is not
   * an empty room, and that distinction is the whole reason `utilisation` is nullable.
   */
  const totals = useMemo(() => {
    const known = rows.filter((b) => b.utilisation !== null);
    const roomsKnown = known.reduce((n, b) => n + b.bookedRooms, 0);
    const weighted = known.reduce((n, b) => n + (b.utilisation ?? 0) * b.bookedRooms, 0);
    return {
      buildings: rows.length,
      rooms: rows.reduce((n, b) => n + b.roomCount, 0),
      roomsKnown,
      mean: roomsKnown ? weighted / roomsKnown : null,
    };
  }, [rows]);

  return (
    /*
      ⚠️ `z-30`, NOT `z-20`, AND THE DIFFERENCE WAS VISIBLE. The campus's floating chrome — the
      "Kalender öffnen" call to action, the drone hint, the terrain notice — is all `z-20` and is
      rendered after this in the DOM, so at equal depth it painted straight through the report: a
      button offering to open the calendar sat in the middle of the utilisation table.

      One layer up covers all of it at once. The week drawer is `z-30` too and comes later still,
      so it deliberately stays ON TOP and can be read against these figures — the same "these
      surfaces are open together, not instead of each other" the rail is built around.
    */
    <section
      data-testid="analysis-view"
      className="absolute inset-0 z-30 overflow-auto bg-stone-950/95 backdrop-blur"
    >
      <div className="mx-auto max-w-5xl px-8 py-8">
        <h2 className="text-xs uppercase tracking-[0.18em] text-stone-400">
          {t('analysis.title')}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-400">
          {t('analysis.intro')}
        </p>

        <dl data-testid="analysis-kpis" className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded border border-stone-700 bg-stone-900/70 p-4">
            <dt className="text-[0.65rem] uppercase tracking-wide text-stone-400">
              {t('analysis.meanUtilisation')}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">
              {totals.mean === null ? '—' : percent(totals.mean)}
            </dd>
            <dd className="text-[0.65rem] text-stone-500">
              {t('analysis.overRooms', { n: number(totals.roomsKnown) })}
            </dd>
          </div>
          <div className="rounded border border-stone-700 bg-stone-900/70 p-4">
            <dt className="text-[0.65rem] uppercase tracking-wide text-stone-400">
              {t('analysis.buildings')}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{number(totals.buildings)}</dd>
          </div>
          <div className="rounded border border-stone-700 bg-stone-900/70 p-4">
            <dt className="text-[0.65rem] uppercase tracking-wide text-stone-400">
              {t('analysis.rooms')}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{number(totals.rooms)}</dd>
          </div>
        </dl>

        <table data-testid="analysis-table" className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-stone-700 text-left text-[0.65rem] uppercase tracking-wide text-stone-400">
              <th className="pb-2">{t('analysis.building')}</th>
              <th className="pb-2 text-right">{t('analysis.rooms')}</th>
              <th className="pb-2 pl-6">{t('analysis.utilisation')}</th>
              <th className="w-24 pb-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b: BuildingView) => (
              <tr key={b.code} data-testid={`analysis-row-${b.code}`} className="border-b border-stone-800/70">
                <td className="py-2 font-medium text-stone-200">{b.code}</td>
                <td className="py-2 text-right tabular-nums text-stone-400">
                  {number(b.roomCount)}
                </td>
                <td className="py-2 pl-6">
                  {/*
                    A bar, because the question is "which buildings are busier than the others" and
                    that is a comparison down a column — the thing the 384 px panel could not do.
                  */}
                  {b.utilisation === null ? (
                    <span className="text-[0.7rem] text-stone-600">{t('analysis.noCalendar')}</span>
                  ) : (
                    <div className="h-2.5 w-full rounded-sm bg-stone-800">
                      <div
                        className="h-2.5 rounded-sm"
                        style={{
                          width: `${Math.max(2, Math.round(b.utilisation * 100))}%`,
                          backgroundColor: rampColour(b.utilisation),
                        }}
                      />
                    </div>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-300">
                  {b.utilisation === null ? '—' : percent(b.utilisation)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-6 text-[0.65rem] leading-relaxed text-stone-500">{t('analysis.note')}</p>
      </div>
    </section>
  );
}
