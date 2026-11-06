import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NUMBER_LOCALE, useI18n } from '@/i18n';
import type { DayEvent } from '@/twin3d/dayEvents';
import type { Twin3DHandle } from '@/twin3d/scene';

/**
 * The operating day, as a control.
 *
 * ⚠️ ONE CLOCK. The hall's machinery, the vans on the road and how dark the scene is are three
 * views of the same moment, and this is the only thing that sets it. The alternative — a slider
 * for the hall and another for the tours — would let the picture contradict itself, which is
 * exactly the failure a twin exists to prevent: vans rolling out of an idle warehouse.
 *
 * ⚠️ IT DOES NOT KEEP ITS OWN COPY OF THE TIME while playing. The value lives in the scene; React
 * only hears about whole quarter-hours. An independent React counter would drift against the
 * scene's own clock within seconds, and the drift would look like the animation stuttering rather
 * than like two clocks disagreeing.
 *
 * The speed model and the event markers follow Flut-Insights: a base rate multiplied by discrete
 * steps, a rAF loop that advances on WALL-CLOCK delta rather than on frame count, and named
 * moments derived from the model rather than written by hand.
 */

/** Quarter-hours in a day. Matches the generator's grid. */
const SLOTS = 96;

/** Seconds of the operating day in one quarter-hour. */
const SECONDS_PER_SLOT = 15 * 60;

/**
 * Playback speeds, as simulated seconds per real second.
 *
 * ⚠️ 1 MEANS REAL TIME, and it is the whole reason this list exists. The clock ran at a fixed
 * 2 250x, which shows a van crossing the city in under a second — you could see THAT it moved but
 * never watch it arrive anywhere. At 1x a van drives at the speed a van drives at, so the approach
 * to a pharmacy, the stop and the pull-away are all watchable. The high end is kept because at
 * real time a full day takes a full day.
 */
const PLAYBACK_SPEEDS = [1, 10, 60, 300, 900, 2400] as const;

/** 900x: a quarter-hour a second. Fast enough to watch a wave leave and return in half a minute. */
const DEFAULT_SPEED_INDEX = 4;

export function DayScrubber({
  handle,
  slot,
  onSlot,
}: {
  handle: Twin3DHandle | null;
  slot: number;
  onSlot: (slot: number) => void;
}) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(DEFAULT_SPEED_INDEX);
  const [following, setFollowing] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);
  const fractional = useRef<number>(slot);
  const lastWhole = useRef<number>(slot);
  const speed = PLAYBACK_SPEEDS[speedIndex];

  const events: DayEvent[] = useMemo(() => handle?.dayEvents() ?? [], [handle]);

  useEffect(() => {
    if (!playing) {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }
    // ⚠️ KEEP THE FRACTION WHEN REACT AGREES ON THE WHOLE SLOT. React only holds whole
    // quarter-hours, so resetting from it unconditionally threw away any sub-slot position — a
    // jump to 04:18 became 04:15 the moment playback started, which silently moved the ride three
    // simulated minutes away from the arrival it was meant to show.
    if (Math.floor(fractional.current) !== slot) fractional.current = slot;
    lastWhole.current = Math.floor(fractional.current);
    last.current = performance.now();

    const step = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      // Wall-clock delta, not frame count, so playback runs at the same speed on any machine and
      // a dropped frame costs no simulated time.
      fractional.current = (fractional.current + (dt * speed) / SECONDS_PER_SLOT + SLOTS) % SLOTS;

      // ⚠️ DRIVE THE SCENE WITH THE FRACTION, EVERY FRAME. The first version only pushed the
      // floored slot through React state, so the vans moved in 15-minute jumps — they teleported
      // between positions and it read as a broken animation rather than as a coarse one.
      handle?.setDcSlot(fractional.current);
      const whole = Math.floor(fractional.current);
      if (whole !== lastWhole.current) {
        lastWhole.current = whole;
        onSlot(whole);
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
    // ⚠️ `speed` IS a dependency: changing it restarts the loop, which resets `last`, so the new
    // rate cannot be applied to time that elapsed under the old one. `slot` deliberately is not —
    // it changes constantly while playing and would tear the loop down 60 times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, onSlot, handle, speed]);

  // The ride can end on its own, when the tour it was following comes home.
  useEffect(() => {
    handle?.onFollowChanged(setFollowing);
  }, [handle]);

  const label = useCallback((value: number) => {
    const minutes = Math.round(value * 15);
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }, []);

  const active = handle?.activeTours() ?? 0;
  const atStop = handle?.vansAtStop() ?? 0;
  const night = handle?.nightFactor() ?? 0;
  const number = (value: number): string =>
    new Intl.NumberFormat(NUMBER_LOCALE).format(value);

  const jumpTo = (target: number) => {
    setPlaying(false);
    fractional.current = target;
    handle?.setDcSlot(target);
    onSlot(Math.floor(target));
  };

  const toggleFollow = () => {
    if (!handle) return;
    if (following) {
      handle.followDelivery(false);
      setFollowing(false);
      return;
    }

    // ⚠️ ALWAYS THE SAME MOMENT. An earlier version only jumped when it judged the current time
    // unsuitable, and that judgement went wrong in ways that took a long time to pin down: it rode
    // along with a van 12 km out on featureless shell terrain while reporting a van in the city,
    // because the decision depended on scene state that had moved on by the time it was acted on.
    // For most of the day every van is kilometres outside the 2 km photoreal core, so there is
    // exactly one moment worth offering, and jumping to it unconditionally makes the button do the
    // same thing every time. The clock is easy to move afterwards.
    //
    // The moment itself is derived from the same timelines the vans are animated along, so it
    // cannot point at a minute where no van is standing anywhere.
    // A little before the van pulls up, so the approach and the stop are both watchable rather
    // than starting with the delivery already underway. 0.05 of a quarter-hour is 45 seconds,
    // which at real time is 45 seconds of watching.
    const moment = handle.cityDeliverySlot();
    const start = moment === null ? handle.dcSlot() : Math.max(moment - 0.05, 0);

    // Pin BOTH clocks before playing. React owns the whole slot and the scene owns the fraction,
    // and starting playback snaps the scene to REACT's value — so writing only one of them lets
    // the ride begin somewhere other than where it just jumped to.
    fractional.current = start;
    handle.setDcSlot(start);
    onSlot(Math.floor(start));

    const index = handle.followDelivery(true);
    setFollowing(index >= 0);
    if (index >= 0) {
      // Real time, because the point of riding along is watching a van drive rather than watching
      // it teleport. The viewer can speed back up from the slider.
      setSpeedIndex(0);
      setPlaying(true);
    }
  };

  // The moment the clock is currently in, so the caption says what you are looking at.
  const currentEvent = useMemo(() => {
    let found: DayEvent | null = null;
    for (const event of events) if (event.slot <= slot + 0.001) found = event;
    return found;
  }, [events, slot]);

  const nothingOnTheRoad = active === 0;

  return (
    <section className="mt-5" data-testid="day-scrubber">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
        {t('dc.dayHeading')}
      </h2>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="day-play"
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
          disabled={!handle}
          className="rounded border border-stone-700 px-2 py-1 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-40"
        >
          {playing ? t('dc.dayPause') : t('dc.dayPlay')}
        </button>
        <output data-testid="day-clock" className="font-mono text-lg font-semibold text-stone-100">
          {label(slot)}
        </output>
        {night > 0.4 && (
          <span className="rounded bg-stone-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
            {t('dc.dayNight')}
          </span>
        )}
      </div>

      {/* ── speed ──────────────────────────────────────────────────────────────────────────── */}
      <div className="mt-2 flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wide text-stone-500" htmlFor="day-speed">
          {t('dc.daySpeed')}
        </label>
        <input
          id="day-speed"
          type="range"
          data-testid="day-speed"
          min={0}
          max={PLAYBACK_SPEEDS.length - 1}
          step={1}
          value={speedIndex}
          disabled={!handle}
          aria-valuetext={speed === 1 ? t('dc.dayRealTime') : `${number(speed)}\u00d7`}
          onChange={(event) => setSpeedIndex(Number(event.target.value))}
          className="w-24 accent-emerald-500"
        />
        <span data-testid="day-speed-value" className="font-mono text-[11px] text-stone-300">
          {speed === 1 ? t('dc.dayRealTime') : `${number(speed)}\u00d7`}
        </span>
      </div>

      {/* ── the moments of the day ─────────────────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div data-testid="day-events" className="relative mt-3 h-4">
          {events.map((event) => {
            const isCurrent = currentEvent?.id === event.id;
            return (
              <button
                key={event.id}
                type="button"
                data-testid={`day-event-${event.id}`}
                title={t(`dc.events.${event.id}`)}
                aria-label={`${t(`dc.events.${event.id}`)} — ${label(event.slot)}`}
                onClick={() => jumpTo(event.slot)}
                style={{ left: `${(event.slot / SLOTS) * 100}%` }}
                className="absolute bottom-0 -translate-x-1/2 px-1"
              >
                <span
                  className={
                    isCurrent
                      ? 'block h-3.5 w-0.5 bg-emerald-400'
                      : 'block h-2.5 w-0.5 bg-stone-600 hover:bg-stone-300'
                  }
                />
              </button>
            );
          })}
        </div>
      )}

      <input
        type="range"
        data-testid="day-slider"
        min={0}
        max={SLOTS - 1}
        step={1}
        value={slot}
        disabled={!handle}
        aria-label={t('dc.dayHeading')}
        onChange={(event) => jumpTo(Number(event.target.value))}
        className="w-full accent-emerald-500"
      />

      <div className="flex justify-between font-mono text-[10px] text-stone-600">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>

      {currentEvent && (
        <p className="mt-1.5 text-xs text-stone-300" data-testid="day-event-caption">
          <span
            data-testid="day-event-kind"
            className="mr-1.5 rounded bg-stone-800 px-1 py-0.5 text-[9px] uppercase tracking-wide text-stone-400"
          >
            {currentEvent.kind === 'planned' ? t('dc.eventPlanned') : t('dc.eventDerived')}
          </span>
          <span className="font-medium">{t(`dc.events.${currentEvent.id}`)}</span>
          <span className="font-mono text-stone-500"> · {label(currentEvent.slot)}</span>
        </p>
      )}

      <p className="mt-1.5 text-xs text-stone-400" data-testid="day-active">
        {t('dc.dayTours', { count: number(active) })}
        {' · '}
        <span className="text-amber-300" data-testid="day-at-stop">
          {t('dc.dayAtStop', { count: number(atStop) })}
        </span>
      </p>

      <button
        type="button"
        data-testid="day-follow"
        aria-pressed={following}
        onClick={toggleFollow}
        disabled={!handle || (nothingOnTheRoad && !following)}
        className="mt-2 w-full rounded border border-stone-700 px-2 py-1 text-xs text-stone-200 hover:bg-stone-800 disabled:opacity-40"
      >
        {following ? t('dc.dayFollowStop') : t('dc.dayFollow')}
      </button>

      <p className="mt-1 text-xs leading-relaxed text-stone-500">{t('dc.dayNote')}</p>
    </section>
  );
}
