import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n';
import {
  loadStaffing,
  summarise,
  type LecturerLoad,
  type LoadStatus,
  type StaffingModel,
} from './staffingData';

/**
 * Lehrdeputat — who is carrying this plan, and is it more than their contract.
 *
 * ⚠️ This is a LENS, not a second tool. The whole point of borrowing the Einsatzplanung question
 * is that it is asked of the SAME plan the rest of the app already shows: a lecturer here is the
 * same lecturer the week grid can be scoped to, teaching in the same rooms the twin lights up.
 * Selecting one therefore drives both — `onSelectLecturer` opens their week and focuses their
 * rooms — rather than opening a separate staffing screen that happens to sit in the same window.
 *
 * The figures are a join, not an invention: `course.sws` against `teacher.contractSws`, both
 * already written by the timetable generator. See `tools/data/build_staffing.py`.
 */

const STATUS_STYLE: Record<LoadStatus, string> = {
  over: 'border-red-400/70 bg-red-400/10 text-red-300',
  tight: 'border-amber-400/70 bg-amber-400/10 text-amber-200',
  balanced: 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300',
  light: 'border-stone-600 bg-stone-800/60 text-stone-300',
  idle: 'border-sky-400/60 bg-sky-500/10 text-sky-100',
};

export interface StaffingState {
  lecturerId: string | null;
}

export function StaffingPanel({
  aoiId,
  state,
  onChange,
  onSelectLecturer,
}: {
  aoiId: string;
  state: StaffingState;
  onChange: (next: StaffingState) => void;
  /** Show this lecturer's week and light their rooms in the twin. */
  onSelectLecturer?: (lecturer: LecturerLoad) => void;
}) {
  const { t, locale } = useI18n();
  const [model, setModel] = useState<StaffingModel | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setMissing(false);
    loadStaffing(aoiId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) setMissing(true);
        else setModel(loaded);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [aoiId]);

  const summary = useMemo(() => (model ? summarise(model) : null), [model]);

  /**
   * Drop a selection this site does not have.
   *
   * A `?teacher=` link can outlive the plan it was made from, or be sent between the two
   * universities — an OTH lecturer id means nothing at LMU. Validation has to happen here because
   * this is where the roster actually is; the shell that reads the URL has no way to know.
   */
  useEffect(() => {
    if (!model || !state.lecturerId) return;
    if (!model.teachers.some((t) => t.teacherId === state.lecturerId)) {
      onChange({ lecturerId: null });
    }
  }, [model, state.lecturerId, onChange]);

  const number = (value: number, digits = 0) =>
    value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const percent = (value: number) =>
    value.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 });

  if (missing) {
    return (
      <p data-testid="staffing-missing" className="mt-3 text-xs leading-relaxed text-stone-400">
        {t('staffing.noData')}
      </p>
    );
  }
  if (!summary || !model) {
    return <p className="mt-3 text-xs text-stone-500">{t('calendar.loading')}</p>;
  }

  const row = (lecturer: LecturerLoad) => (
    <li key={lecturer.teacherId}>
      <button
        type="button"
        data-testid={`staffing-lecturer-${lecturer.teacherId}`}
        aria-pressed={state.lecturerId === lecturer.teacherId}
        onClick={() => {
          onChange({ lecturerId: lecturer.teacherId });
          onSelectLecturer?.(lecturer);
        }}
        className={`w-full rounded border px-2 py-1.5 text-left transition ${
          state.lecturerId === lecturer.teacherId
            ? 'border-stone-300 bg-stone-800'
            : 'border-stone-700 hover:border-stone-500'
        }`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium">{lecturer.name}</span>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.6rem] font-medium ${
              STATUS_STYLE[lecturer.status]
            }`}
          >
            {percent(lecturer.ratio)}
          </span>
        </span>
        <span className="mt-0.5 block text-[0.65rem] text-stone-400">
          {t('staffing.ofContract', {
            planned: number(lecturer.plannedSws),
            contract: number(lecturer.contractSws),
          })}
          {lecturer.courseCount > 0 && ` · ${t('staffing.courses', { n: lecturer.courseCount })}`}
        </span>
      </button>
    </li>
  );

  return (
    <div data-testid="staffing-panel" className="mt-3 space-y-4">
      <p className="text-xs leading-relaxed text-stone-400">{t('staffing.intro')}</p>

      <div className="rounded border border-stone-700 p-3">
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-500">
          {t('staffing.total')}
        </p>
        <p className="mt-1 text-sm">
          {t('staffing.ofContract', {
            planned: number(summary.plannedSws),
            contract: number(summary.contractSws),
          })}{' '}
          <span className="text-stone-400">= {percent(summary.ratio)}</span>
        </p>
        <p className="mt-1 text-[0.65rem] leading-relaxed text-stone-500">
          {t('staffing.spread', {
            over: summary.over.length,
            idle: summary.idle.length,
            total: summary.lecturers.length,
          })}
        </p>
      </div>

      {summary.over.length > 0 && (
        <div>
          <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-red-300">
            {t('staffing.overHeading')}
          </h3>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-stone-400">
            {t('staffing.overBlurb')}
          </p>
          <ul data-testid="staffing-over" className="mt-2 space-y-1.5">
            {summary.over.map(row)}
          </ul>
        </div>
      )}

      {summary.idle.length > 0 && (
        <div>
          <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-sky-100">
            {t('staffing.idleHeading')}
          </h3>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-stone-400">
            {t('staffing.idleBlurb')}
          </p>
          <ul data-testid="staffing-idle" className="mt-2 space-y-1.5">
            {summary.idle.slice(0, 8).map(row)}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-400">
          {t('staffing.byFaculty')}
        </h3>
        <ul className="mt-2 space-y-1.5">
          {summary.faculties.map((faculty) => (
            <li
              key={faculty.facultyId}
              className="flex items-baseline justify-between gap-2 rounded border border-stone-700 px-2 py-1.5 text-xs"
            >
              <span className="truncate">{faculty.name}</span>
              <span className="shrink-0 text-stone-400">
                {percent(faculty.ratio)} · {t('staffing.overShort', { n: faculty.over })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/*
        Why there is no professorale Quote here. The Einsatzplanung app's central rule is that at
        least half of teaching must be delivered by professors — but every lecturer this dataset
        generates is a professor, so the figure would read 100% and measure nothing. Saying that is
        more useful than showing a green light that cannot go red.
      */}
      {!model.lecturerTypesModelled && (
        <p
          data-testid="staffing-no-quota"
          className="rounded border border-stone-700 bg-stone-800/50 p-2.5 text-[0.65rem] leading-relaxed text-stone-400"
        >
          {t('staffing.noQuota')}
        </p>
      )}

      {/* Translated rather than echoed from the data file — see QualityPanel. */}
      <p className="text-[0.65rem] leading-relaxed text-amber-200">{t('staffing.synthetic')}</p>
    </div>
  );
}
