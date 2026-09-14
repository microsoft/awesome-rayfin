import { useMemo } from 'react';

import { interiorProvenanceKey } from '@/config/aoi';
import { useI18n } from '@/i18n';
import type { BuildingView, RoomLayer, RoomView } from '@/twin3d/rooms';

/**
 * Raum- und Flächenmanagement — the occupancy lens.
 *
 * The figures here are unusual for a demo in that most of them are real: the bookings come from
 * TUMonline through NavigaTUM, and the floor areas are computed from surveyed room outlines. The
 * one invented number is the seat count, and it carries a badge wherever it appears.
 *
 * The measure on show is **time utilisation** — the share of the teaching week a room is committed
 * — rather than seat occupancy. That is deliberate: it is the figure space planners actually plan
 * against, and it needs nothing synthetic to compute.
 */

export interface OccupancyState {
  building: string | null;
  room: RoomView | null;
  /** Slot in the teaching week, or null for the whole-week view. */
  slot: number | null;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

export function slotOf(day: number, hour: number, firstHour: number, hours: number): number {
  return day * hours + (hour - firstHour);
}

export function dayOf(slot: number, hours: number): number {
  return Math.floor(slot / hours);
}

export function hourOf(slot: number, hours: number, firstHour: number): number {
  return (slot % hours) + firstHour;
}

function percent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number, locale: string, digits = 0): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * The same ramp the shader uses, so the legend and the model agree.
 *
 * Exported because the Auswertung view draws the same bars, and a second copy of a colour scale is
 * a second copy that drifts — the legend and the report would then disagree about what "busy" is.
 */
export function rampColour(t: number): string {
  const low = [107, 133, 153];
  const mid = [232, 163, 61];
  const high = [201, 51, 41];
  const [a, b, k] = t < 0.5 ? [low, mid, t * 2] : [mid, high, (t - 0.5) * 2];
  const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * k);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

export function OccupancyPanel({
  layer,
  state,
  onExplode,
  onSelectRoom,
  onSlot,
  playing = false,
  onTogglePlay,
  shuttle = null,
}: {
  layer: RoomLayer;
  state: OccupancyState;
  onExplode: (code: string | null) => void;
  onSelectRoom: (room: RoomView | null) => void;
  onSlot: (slot: number | null) => void;
  playing?: boolean;
  onTogglePlay?: () => void;
  /** The measured road journey between the campuses, when this AOI has two. */
  shuttle?: { distanceM: number; driveSeconds: number } | null;
}) {
  const { t, locale } = useI18n();
  const grid = layer.meta.occupancyGrid;

  const building = useMemo(
    () => layer.buildings.find((b) => b.code === state.building) ?? null,
    [layer.buildings, state.building]
  );

  /**
   * One entry per room code, with area summed across its polygons.
   *
   * `layer.rooms` holds polygons, and a room can be drawn as more than one (see
   * `RoomLayer.distinct`). Left as-is, this panel would count 5532.Z1.003 twice, weight it twice
   * in the mean utilisation, and offer it twice in the free-room list. The kept entry's `index`
   * still points at its first polygon, which is what selection highlights.
   */
  const roomsHere = useMemo(() => {
    if (!building) return [];
    const byCode = new Map<string, RoomView>();
    for (const polygon of layer.rooms) {
      if (polygon.building !== building.code) continue;
      const seen = byCode.get(polygon.code);
      byCode.set(
        polygon.code,
        seen ? { ...seen, areaM2: seen.areaM2 + polygon.areaM2 } : polygon
      );
    }
    return [...byCode.values()];
  }, [layer.rooms, building]);

  const teaching = useMemo(() => roomsHere.filter((r) => r.teaching), [roomsHere]);

  /** Teaching rooms with a calendar that are free at the chosen hour. */
  const free = useMemo(() => {
    if (state.slot === null) return [];
    return teaching
      .filter((room) => {
        const occ = layer.occupancyFor(room);
        return occ ? occ[state.slot as number] === 0 : false;
      })
      .sort((a, b) => b.areaM2 - a.areaM2);
  }, [teaching, layer, state.slot]);

  const stats = useMemo(() => {
    const withCalendar = teaching.filter((r) => r.utilisation !== null);
    const meanUtilisation = withCalendar.length
      ? withCalendar.reduce((sum, r) => sum + (r.utilisation ?? 0), 0) / withCalendar.length
      : null;
    return {
      rooms: roomsHere.length,
      teaching: teaching.length,
      withCalendar: withCalendar.length,
      meanUtilisation,
      areaM2: roomsHere.reduce((sum, r) => sum + r.areaM2, 0),
      teachingAreaM2: teaching.reduce((sum, r) => sum + r.areaM2, 0),
    };
  }, [roomsHere, teaching]);

  /**
   * Whether this building is modelled below its own height.
   *
   * ⚠️ A BUILDING CAN BE MISSING TWO OF ITS THREE FLOORS AND SIMPLY LOOK EMPTY. OTH publishes a
   * plan for the ground floor of Prüfening's six buildings and nothing above, and this project
   * refuses to invent a grid on the storey above an architect's drawing — so those buildings hold
   * one modelled floor each, the campus carries 15 of 936 sessions, and a viewer had no way to
   * tell that apart from a quiet campus. The restraint is right; being silent about it is not.
   */
  const partial = building ? layer.meta.levelCoverage?.byBuilding?.[building.code] : undefined;

  const day = state.slot === null ? 1 : dayOf(state.slot, grid.hours);
  const hour = state.slot === null ? 10 : hourOf(state.slot, grid.hours, grid.firstHour);

  /**
   * When — and it is NOT part of the open building.
   *
   * ⚠️ This block used to live below the "pick a building" early return, so the clock only
   * existed once somebody had opened a building. That was defensible while the only thing it did
   * was recolour that building's rooms. It stopped being defensible the moment play drove the
   * shuttle between the two campuses: the journey is a property of the CAMPUS, and asking a
   * viewer to open an arbitrary lecture hall before they may watch a bus leave for the other site
   * is a rule with no reason behind it. The hour colours every room on the campus either way.
   */
  const when = (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs uppercase tracking-[0.18em] text-stone-400">
          {t('occupancy.when')}
        </h4>
        <button
          type="button"
          data-testid="whole-week"
          onClick={() => onSlot(state.slot === null ? slotOf(1, 10, grid.firstHour, grid.hours) : null)}
          className={`rounded px-2 py-0.5 text-[0.65rem] transition ${
            state.slot === null
              ? 'bg-stone-100 text-stone-900'
              : 'text-stone-400 hover:bg-stone-800'
          }`}
        >
          {t('occupancy.wholeWeek')}
        </button>
      </div>

      <div className="mt-2 flex gap-1">
        {DAY_KEYS.map((key, index) => (
          <button
            key={key}
            type="button"
            data-testid={`day-${index}`}
            onClick={() => onSlot(slotOf(index, hour, grid.firstHour, grid.hours))}
            className={`flex-1 rounded py-1 text-[0.65rem] transition ${
              state.slot !== null && day === index
                ? 'bg-stone-100 text-stone-900'
                : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
            }`}
          >
            {t(`occupancy.day.${key}`)}
          </button>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="flex justify-between text-[0.7rem] text-stone-400">
          <span>{t('occupancy.hour')}</span>
          <span className="tabular-nums text-stone-200">
            {state.slot === null ? t('occupancy.wholeWeek') : `${String(hour).padStart(2, '0')}:00`}
          </span>
        </span>
        <div className="mt-1 flex items-center gap-2">
          {/*
            ⚠️ PLAY SITS ON THE SLIDER, not in a toolbar somewhere else. It moves this control and
            nothing else, and a transport button parked away from the thing it transports is the
            reason nobody finds it. Dragging the slider takes over and stops the playback — see
            `setSlotManually` in TwinShell.
          */}
          {onTogglePlay && (
            <button
              type="button"
              data-testid="week-play"
              aria-pressed={playing}
              aria-label={t(playing ? 'occupancy.pause' : 'occupancy.play')}
              title={t(playing ? 'occupancy.pause' : 'occupancy.play')}
              onClick={onTogglePlay}
              className={`shrink-0 rounded border px-2 py-1 text-[0.7rem] leading-none transition ${
                playing
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                  : 'border-stone-700 text-stone-300 hover:border-amber-500/50 hover:text-amber-300'
              }`}
            >
              {playing ? '❚❚' : '▶'}
            </button>
          )}
          <input
            type="range"
            data-testid="hour-slider"
            min={grid.firstHour}
            max={grid.firstHour + grid.hours - 1}
            value={hour}
            onChange={(event) =>
              onSlot(slotOf(day, Number(event.target.value), grid.firstHour, grid.hours))
            }
            className="w-full accent-stone-200"
          />
        </div>
      </label>

      {shuttle && (
        /*
          The measured figures, beside the thing that acts them out. The vehicle drives the real
          free-flow time (see `shuttle.ts`), so this states what is on screen rather than
          apologising for it — but the numbers still belong in text, because nobody should have to
          time a bus with a stopwatch to learn how far apart two campuses are.
        */
        <p className="mt-2 text-[0.65rem] leading-relaxed text-stone-500">
          {t('occupancy.shuttleNote', {
            km: (shuttle.distanceM / 1000).toFixed(1).replace('.', locale === 'de' ? ',' : '.'),
            min: String(Math.round(shuttle.driveSeconds / 60)),
          })}
        </p>
      )}
    </div>
  );

  // ── Nothing open yet: choose a building ────────────────────────────────────────────────
  if (!building) {
    const ranked = [...layer.buildings].sort((a, b) => b.roomCount - a.roomCount);
    return (
      <section data-testid="occupancy-panel" className="mt-4 space-y-4">
        {when}
        <div>
          <p className="text-xs leading-relaxed text-stone-400">{t('occupancy.pickBuilding')}</p>
          <ul className="mt-3 space-y-1">
            {ranked.map((entry: BuildingView) => (
              <li key={entry.code}>
                <button
                  type="button"
                  data-testid={`explode-${entry.code}`}
                  onClick={() => onExplode(entry.code)}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-stone-800"
                >
                  <span className="font-medium text-stone-200">{entry.code}</span>
                  <span className="text-stone-500">
                    {number(entry.roomCount, locale)} {t('occupancy.roomsShort')}
                  </span>
                  {entry.utilisation !== null ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[0.65rem] font-medium text-ink"
                      style={{ backgroundColor: rampColour(entry.utilisation) }}
                    >
                      {percent(entry.utilisation, locale)}
                    </span>
                  ) : (
                    <span className="text-[0.65rem] text-stone-600">{t('occupancy.noCalendar')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/*
          ⚠️ THIS BRANCH HAD NO PROVENANCE LINE AT ALL, AND IT IS THE ONE THAT SHOWS THE NUMBERS
          FIRST. Every building above carries a utilisation percentage — the very first figures
          anyone sees on this lens — and where the site's week is invented, so is every one of
          them. The note existed only after a building was opened, which is a click later than the
          claim. Same key and same test id as the branch below: the two are mutually exclusive, so
          exactly one is ever mounted.
        */}
        <p
          data-testid="occupancy-provenance"
          className="border-t border-stone-700 pt-3 text-[0.65rem] leading-relaxed text-stone-500"
        >
          {t(interiorProvenanceKey('occupancy', layer.meta.aoi), { semester: grid.semester })}
        </p>
      </section>
    );
  }

  return (
    <section data-testid="occupancy-panel" className="mt-4 space-y-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('occupancy.building', { code: building.code })}</h3>
        <button
          type="button"
          data-testid="collapse-building"
          onClick={() => onExplode(null)}
          className="rounded px-2 py-1 text-xs text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
        >
          {t('occupancy.close')}
        </button>
      </header>

      {partial && (
        <p
          data-testid="partial-building"
          className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[0.7rem] leading-relaxed text-amber-300"
        >
          {t('occupancy.partialLevels', {
            modelled: partial.modelled,
            levels: partial.levels,
          })}
        </p>
      )}

      {/* ── When ───────────────────────────────────────────────────────────────────── */}
      {when}

      {/* ── Key figures ────────────────────────────────────────────────────────────── */}
      <dl data-testid="occupancy-kpis" className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-stone-700 bg-stone-800/60 p-2">
          <dt className="text-[0.65rem] text-stone-400">{t('occupancy.utilisation')}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {stats.meanUtilisation === null ? '—' : percent(stats.meanUtilisation, locale)}
          </dd>
          <dd className="text-[0.6rem] text-stone-500">
            {t('occupancy.overRooms', { n: number(stats.withCalendar, locale) })}
          </dd>
        </div>
        <div className="rounded border border-stone-700 bg-stone-800/60 p-2">
          <dt className="text-[0.65rem] text-stone-400">{t('occupancy.teachingRooms')}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {number(stats.teaching, locale)}
          </dd>
          <dd className="text-[0.6rem] text-stone-500">
            {t('occupancy.ofRooms', { n: number(stats.rooms, locale) })}
          </dd>
        </div>
        <div className="rounded border border-stone-700 bg-stone-800/60 p-2">
          <dt className="text-[0.65rem] text-stone-400">{t('occupancy.area')}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {number(stats.areaM2, locale)} m²
          </dd>
          <dd className="text-[0.6rem] text-stone-500">{t('occupancy.areaDerived')}</dd>
        </div>
        <div className="rounded border border-stone-700 bg-stone-800/60 p-2">
          <dt className="text-[0.65rem] text-stone-400">{t('occupancy.teachingArea')}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">
            {number(stats.teachingAreaM2, locale)} m²
          </dd>
          <dd className="text-[0.6rem] text-stone-500">
            {stats.areaM2 > 0 ? percent(stats.teachingAreaM2 / stats.areaM2, locale) : '—'}
          </dd>
        </div>
      </dl>

      {/* ── Where is there space? ──────────────────────────────────────────────────── */}
      {state.slot !== null && (
        <div data-testid="free-rooms">
          <h4 className="text-xs uppercase tracking-[0.18em] text-stone-400">
            {t('occupancy.freeAt', {
              day: t(`occupancy.day.${DAY_KEYS[day]}`),
              hour: `${String(hour).padStart(2, '0')}:00`,
            })}
          </h4>
          {free.length === 0 ? (
            <p className="mt-2 text-xs text-stone-500">{t('occupancy.noneFree')}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {free.slice(0, 6).map((room) => (
                <li key={room.code}>
                  <button
                    type="button"
                    onClick={() => onSelectRoom(room)}
                    className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-stone-800"
                  >
                    <span className="text-stone-200">{room.code}</span>
                    <span className="text-stone-500">{room.usage}</span>
                    <span className="tabular-nums text-stone-400">
                      {number(room.areaM2, locale)} m²
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── The selected room ──────────────────────────────────────────────────────── */}
      {state.room && (
        <RoomCard layer={layer} room={state.room} onClear={() => onSelectRoom(null)} />
      )}

      {/*
        ⚠️ TEST ID BECAUSE THIS SENTENCE IS THE HONESTY CLAIM, AND IT MOVES WITH THE DATA.
        `interiorProvenanceKey` swaps to the `-synthetic` variant when `config/release.json`
        substitutes a site's interiors. The real variant names TUMonline as the source of the
        bookings; leaving it up over an invented week would be a false statement on a screen full
        of real room numbers in a real building — which is exactly the reading that would be taken
        as the university's own utilisation figure. Nothing could check it until it had a handle.
      */}
      <p
        data-testid="occupancy-provenance"
        className="border-t border-stone-700 pt-3 text-[0.65rem] leading-relaxed text-stone-500"
      >
        {t(interiorProvenanceKey('occupancy', layer.meta.aoi), { semester: grid.semester })}
      </p>
    </section>
  );
}

function RoomCard({
  layer,
  room,
  onClear,
}: {
  layer: RoomLayer;
  room: RoomView;
  onClear: () => void;
}) {
  const { t, locale } = useI18n();
  const grid = layer.meta.occupancyGrid;
  const occupancy = layer.occupancyFor(room);
  const peak = occupancy ? Math.max(...occupancy, 1) : 1;

  return (
    <div data-testid="room-card" className="rounded border border-stone-600 bg-stone-800 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{room.code}</h4>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-stone-400 transition hover:text-stone-100"
        >
          ×
        </button>
      </div>
      {room.name && room.name !== room.code && (
        <p className="mt-0.5 text-xs text-stone-300">{room.name}</p>
      )}

      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('occupancy.usage')}</dt>
          <dd>{room.usage ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('occupancy.floor')}</dt>
          <dd className="tabular-nums">{room.level}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('occupancy.area')}</dt>
          <dd className="tabular-nums">{number(room.areaM2, locale, 1)} m²</dd>
        </div>
        {room.seats !== null && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-stone-400">{t('occupancy.seats')}</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="tabular-nums">{number(room.seats, locale)}</span>
              {/* The one invented figure on this card, and it says so. */}
              <span
                data-testid="synthetic-badge"
                className="rounded bg-amber-500/20 px-1 py-0.5 text-[0.55rem] uppercase tracking-wider text-amber-300"
              >
                {t('provenance.synthetic')}
              </span>
            </dd>
          </div>
        )}
        {room.utilisation !== null && (
          <div className="flex justify-between gap-2">
            <dt className="text-stone-400">{t('occupancy.utilisation')}</dt>
            <dd className="tabular-nums">{percent(room.utilisation, locale)}</dd>
          </div>
        )}
      </dl>

      {occupancy ? (
        <div className="mt-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-stone-500">
            {t('occupancy.week')}
          </p>
          {/* Five rows of hours: the room's real teaching week at a glance. */}
          <div className="mt-1 flex gap-0.5">
            {DAY_KEYS.map((key, dayIndex) => (
              <div key={key} className="flex-1">
                <div className="text-center text-[0.55rem] text-stone-500">
                  {t(`occupancy.day.${key}`)}
                </div>
                <div className="mt-0.5 space-y-px">
                  {Array.from({ length: grid.hours }, (_, h) => {
                    const weeks = occupancy[dayIndex * grid.hours + h];
                    return (
                      <div
                        key={h}
                        title={`${String(h + grid.firstHour).padStart(2, '0')}:00 — ${weeks} ${t('occupancy.weeks')}`}
                        className="h-1.5 rounded-[1px]"
                        style={{
                          backgroundColor:
                            weeks > 0 ? rampColour(weeks / peak) : 'rgba(255,255,255,0.06)',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[0.65rem] leading-relaxed text-stone-500">
          {t('occupancy.roomNoCalendar')}
        </p>
      )}

      {room.courses && room.courses.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-stone-500">
            {t('occupancy.courses')}
          </p>
          <ul className="mt-1 space-y-0.5 text-[0.7rem] text-stone-300">
            {room.courses.map((course) => (
              <li key={course.title} className="flex gap-2">
                <span className="tabular-nums text-stone-500">{course.count}×</span>
                <span className="min-w-0 flex-1 truncate" title={course.title}>
                  {course.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
