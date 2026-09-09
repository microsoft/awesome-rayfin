import { useCallback, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/i18n';
import type { FlowMeta } from '@/twin3d/flows';

export interface FlowState {
  /** 15-minute slot of the teaching week, or null for the whole week at once. */
  slot: number | null;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;

// Timeline geometry, in viewBox units. The chart is the control, so it is given real height:
// at 46 units a 280-bar week is a texture, not something you can aim at.
const VB_W = 280;
const CHART_TOP = 5;
const CHART_H = 46;
const BASE_Y = CHART_TOP + CHART_H;
const AXIS_Y = BASE_Y + 11;
const VB_H = AXIS_Y + 4;

/** A spike is a local maximum worth navigating to, not merely a slot busier than its neighbour. */
const PEAK_FLOOR = 0.12;

/**
 * The Campus Flow lens.
 *
 * The scrubber is the lens. A flow map of a whole week is a picture of the paths; a flow map of
 * 10:00 on a Tuesday is a picture of the rush, and watching it form and dissolve is the only way
 * the bottleneck argument lands.
 *
 * The week is 280 fifteen-minute slots, which is what makes this hard to drive. Across a sidebar
 * that is roughly one pixel per slot, so a range input alone cannot land on a chosen spike — you
 * aim at a rush hour and get the lull beside it. There are therefore three ways in, each suited to
 * a different intent: click or drag the chart to go somewhere you can see, step between peaks to
 * visit the rushes in order without hunting for them, and the slider or arrow keys for single slots.
 *
 * ⚠️ **Routes are real, head counts are not**, and the panel says so above the numbers rather than
 * below them. The cohorts, their timings and their paths all come from measured data; how many
 * people are in each cohort is derived seats times an invented fill factor.
 */
export function FlowPanel({
  meta,
  state,
  onChange,
}: {
  meta: FlowMeta;
  state: FlowState;
  onChange: (next: FlowState) => void;
}) {
  const { t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const slotsPerDay = meta.slots / meta.days;
  const perStep = meta.slotMinutes;

  const describe = useCallback(
    (slot: number) => {
      const day = t(`occupancy.day.${DAY_KEYS[Math.floor(slot / slotsPerDay)]}`);
      const minutes = (slot % slotsPerDay) * perStep;
      const hh = meta.firstHour + Math.floor(minutes / 60);
      const mm = minutes % 60;
      return `${day} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    },
    [slotsPerDay, perStep, meta.firstHour, t]
  );

  const label = state.slot === null ? t('flow.wholeWeek') : describe(state.slot);
  const walking = state.slot === null ? null : (meta.slotTotals[state.slot] ?? 0);
  const peak = Math.max(...meta.slotTotals, 1);
  const peakLabel = useMemo(() => describe(meta.peakSlot), [describe, meta.peakSlot]);

  // Every rush in the week, in order. `>= prev && > next` takes the last slot of a plateau, so a
  // rush that holds steady for half an hour is offered once rather than twice.
  const peaks = useMemo(() => {
    const floor = peak * PEAK_FLOOR;
    const found: number[] = [];
    for (let i = 0; i < meta.slotTotals.length; i += 1) {
      const value = meta.slotTotals[i];
      if (value < floor) continue;
      if (value >= (meta.slotTotals[i - 1] ?? 0) && value > (meta.slotTotals[i + 1] ?? 0)) {
        found.push(i);
      }
    }
    return found;
  }, [meta.slotTotals, peak]);

  const stepPeak = (direction: 1 | -1) => {
    if (!peaks.length) return;
    const from = state.slot ?? -1;
    const next =
      direction > 0
        ? (peaks.find((p) => p > from) ?? peaks[0])
        : (peaks.filter((p) => p < from).pop() ?? peaks[peaks.length - 1]);
    onChange({ slot: next });
  };

  const slotAt = (clientX: number, element: SVGSVGElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = (clientX - rect.left) / (rect.width || 1);
    return Math.min(meta.slots - 1, Math.max(0, Math.floor(ratio * meta.slots)));
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const current = state.slot ?? meta.peakSlot;
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange({ slot: event.key === 'Home' ? 0 : meta.slots - 1 });
      return;
    }
    const jump: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      // An hour is four slots, which is the unit a timetable is actually written in.
      ArrowDown: -4,
      ArrowUp: 4,
      PageDown: -slotsPerDay,
      PageUp: slotsPerDay,
    };
    const delta = jump[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onChange({ slot: Math.min(meta.slots - 1, Math.max(0, current + delta)) });
  };

  const marked = hover ?? state.slot;

  return (
    <section className="mt-4" data-testid="flow-panel">
      <div
        data-testid="flow-provenance"
        className="rounded border border-sky-500/50 bg-sky-500/10 p-2.5 text-[0.68rem] leading-relaxed text-sky-100"
      >
        <p className="font-semibold uppercase tracking-[0.14em] text-sky-200">
          {t('flow.provenanceTitle')}
        </p>
        <p className="mt-1 text-sky-100/80">{t('flow.provenanceBody')}</p>
      </div>

      <dl className="mt-4 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('flow.transitions')}</dt>
          <dd className="font-medium tabular-nums">{meta.transitions}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('flow.courses')}</dt>
          <dd className="font-medium tabular-nums">{meta.courses}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-stone-400">{t('flow.peak')}</dt>
          <dd data-testid="flow-peak" className="font-medium tabular-nums">
            {peakLabel} · {Math.round(meta.slotTotals[meta.peakSlot])}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-[0.18em] text-stone-400">{t('flow.when')}</h3>
        <span data-testid="flow-slot-label" className="font-mono text-sm text-stone-100">
          {label}
        </span>
      </div>

      {/*
        The week, and the way in. The teaching rhythm is visible here before any ribbon moves, and
        because the chart is the control you can aim at a rush you can see rather than hunting for
        it with a slider.
      */}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="mt-2 w-full cursor-pointer touch-none rounded bg-stone-900/50 outline-none ring-sky-400/70 focus-visible:ring-2"
        data-testid="flow-timeline"
        role="slider"
        tabIndex={0}
        aria-label={t('flow.timeline')}
        aria-valuemin={0}
        aria-valuemax={meta.slots - 1}
        aria-valuenow={state.slot ?? meta.peakSlot}
        aria-valuetext={label}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          // ⚠️ MOVE FIRST, CAPTURE SECOND. `setPointerCapture` throws when the pointer id is not
          // active — which is exactly what a synthetic pointer does — and with the capture call
          // first that exception skipped `onChange` entirely, leaving a chart that rendered
          // perfectly and ignored every click. Capture is an enhancement for dragging; landing on
          // the slot you clicked is the feature, and it must not be hostage to it.
          dragging.current = true;
          onChange({ slot: slotAt(e.clientX, e.currentTarget) });
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // No capture available: dragging outside the chart just stops tracking, which is a
            // smaller loss than the click not working.
          }
        }}
        onPointerMove={(e) => {
          const slot = slotAt(e.clientX, e.currentTarget);
          setHover(slot);
          if (dragging.current) onChange({ slot });
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            // Nothing was captured — see onPointerDown.
          }
        }}
        onPointerLeave={() => setHover(null)}
      >
        {meta.slotTotals.map((value, i) => (
          <rect
            key={i}
            x={(i / meta.slots) * VB_W}
            y={BASE_Y - (value / peak) * CHART_H}
            width={VB_W / meta.slots}
            height={Math.max((value / peak) * CHART_H, value > 0 ? 0.8 : 0)}
            fill={i === state.slot ? '#f97316' : '#5a9bd8'}
            opacity={i === state.slot ? 1 : 0.75}
          />
        ))}

        {/* Every rush gets a dot, so what the step buttons visit is what you can see. */}
        {peaks.map((p) => (
          <circle
            key={p}
            cx={((p + 0.5) / meta.slots) * VB_W}
            cy={BASE_Y - (meta.slotTotals[p] / peak) * CHART_H - 2.6}
            r={1.1}
            fill={p === state.slot ? '#fdba74' : '#94a3b8'}
          />
        ))}

        {Array.from({ length: meta.days - 1 }, (_, d) => (
          <line
            key={d}
            x1={(((d + 1) * slotsPerDay) / meta.slots) * VB_W}
            y1={CHART_TOP - 3}
            x2={(((d + 1) * slotsPerDay) / meta.slots) * VB_W}
            y2={BASE_Y}
            stroke="#78716c"
            strokeWidth={0.4}
          />
        ))}

        {DAY_KEYS.slice(0, meta.days).map((key, d) => (
          <text
            key={key}
            x={((d + 0.5) * slotsPerDay * VB_W) / meta.slots}
            y={AXIS_Y}
            textAnchor="middle"
            fontSize={7}
            fill="#a8a29e"
          >
            {t(`occupancy.day.${key}`)}
          </text>
        ))}

        {marked !== null && (
          <line
            x1={((marked + 0.5) / meta.slots) * VB_W}
            y1={CHART_TOP - 3}
            x2={((marked + 0.5) / meta.slots) * VB_W}
            y2={BASE_Y}
            stroke={marked === state.slot ? '#f97316' : '#e7e5e4'}
            strokeWidth={0.6}
            opacity={marked === state.slot ? 1 : 0.6}
          />
        )}
      </svg>

      {/* Reads out whatever is under the pointer, so the week can be surveyed without committing. */}
      <p
        data-testid="flow-hover"
        className="mt-1 h-4 text-[0.68rem] tabular-nums text-stone-400"
        aria-hidden="true"
      >
        {hover === null
          ? ''
          : `${describe(hover)} · ${Math.round(meta.slotTotals[hover] ?? 0)} ${t('flow.walking')}`}
      </p>

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          data-testid="flow-prev-peak"
          onClick={() => stepPeak(-1)}
          disabled={!peaks.length}
          title={t('flow.prevPeak')}
          aria-label={t('flow.prevPeak')}
          className="rounded bg-stone-800 px-2 py-1 text-[0.68rem] leading-none text-stone-300 hover:bg-stone-700 disabled:opacity-40"
        >
          ◀
        </button>
        <button
          type="button"
          data-testid="flow-next-peak"
          onClick={() => stepPeak(1)}
          disabled={!peaks.length}
          title={t('flow.nextPeak')}
          aria-label={t('flow.nextPeak')}
          className="rounded bg-stone-800 px-2 py-1 text-[0.68rem] leading-none text-stone-300 hover:bg-stone-700 disabled:opacity-40"
        >
          ▶
        </button>
        <span className="text-[0.68rem] text-stone-500">
          {t('flow.peakCount', { count: peaks.length })}
        </span>
        <span data-testid="flow-walking" className="ml-auto text-xs tabular-nums text-stone-300">
          {walking === null ? '—' : `${Math.round(walking)} ${t('flow.walking')}`}
        </span>
      </div>

      {/* Single-slot adjustment, and the keyboard-native control for anyone not using a pointer. */}
      <input
        type="range"
        data-testid="flow-slot-slider"
        min={0}
        max={meta.slots - 1}
        value={state.slot ?? 0}
        aria-label={t('flow.when')}
        onChange={(e) => onChange({ slot: Number(e.target.value) })}
        className="mt-2 w-full accent-sky-400"
      />

      <button
        type="button"
        data-testid="flow-whole-week"
        onClick={() => onChange({ slot: state.slot === null ? meta.peakSlot : null })}
        className="mt-2 rounded bg-stone-800 px-2 py-1 text-[0.68rem] text-stone-300 hover:bg-stone-700"
      >
        {state.slot === null ? t('flow.showSlot') : t('flow.wholeWeek')}
      </button>

      <p className="mt-3 text-[0.65rem] leading-relaxed text-stone-500">{t('flow.note')}</p>
    </section>
  );
}
