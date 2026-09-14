import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n';
import {
  loadPlanQuality,
  summarise,
  type CohortQuality,
  type PlanQualityModel,
} from './planQualityData';

/**
 * Planqualität — REQUIREMENTS §5.1's last two rules, on screen.
 *
 * The app could already prove a plan is conflict-free. A planner's next question is whether it is
 * any good: where students wait through Hohlstunden, how long their days run, who crosses the city,
 * and what got parked in the 08:00 and 18:30 slots nobody wants.
 *
 * ⚠️ A LENS, not a separate view. Selecting a cohort re-scopes the week grid already on screen,
 * the same way the staffing lens does with a lecturer — one plan, several questions.
 */

export interface QualityState {
  cohortId: string | null;
}

export function QualityPanel({
  aoiId,
  state,
  onChange,
  onSelectCohort,
}: {
  aoiId: string;
  state: QualityState;
  onChange: (next: QualityState) => void;
  onSelectCohort?: (cohort: CohortQuality) => void;
}) {
  const { t, locale } = useI18n();
  const [model, setModel] = useState<PlanQualityModel | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setMissing(false);
    loadPlanQuality(aoiId)
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

  // A cohort id from another site means nothing here; drop it rather than show a dead selection.
  useEffect(() => {
    if (!model || !state.cohortId) return;
    if (!model.cohortDays.some((d) => d.cohortId === state.cohortId)) onChange({ cohortId: null });
  }, [model, state.cohortId, onChange]);

  const number = (value: number) => value.toLocaleString(locale);

  if (missing) {
    return (
      <p data-testid="quality-missing" className="mt-3 text-xs leading-relaxed text-stone-400">
        {t('quality.noData')}
      </p>
    );
  }
  if (!summary || !model) {
    return <p className="mt-3 text-xs text-stone-500">{t('calendar.loading')}</p>;
  }

  const worst = summary.cohorts.filter((c) => c.idleBlocks > 0 || c.tightTransfers > 0).slice(0, 8);

  return (
    <div data-testid="quality-panel" className="mt-3 space-y-4">
      <p className="text-xs leading-relaxed text-stone-400">{t('quality.intro')}</p>

      <dl className="grid grid-cols-2 gap-2">
        {[
          ['quality.idleBlocks', number(summary.idleBlocks), 'quality-idle'],
          [
            'quality.daysWithGap',
            `${number(summary.daysWithGap)} / ${number(summary.days)}`,
            'quality-gapdays',
          ],
          ['quality.longestDay', t('quality.blocks', { n: summary.longestDayBlocks }), 'quality-longest'],
          ['quality.campusChanges', number(summary.campusChanges), 'quality-campus'],
        ].map(([key, value, testId]) => (
          <div key={key} className="rounded border border-stone-700 p-2.5">
            <dt className="text-[0.6rem] uppercase tracking-[0.14em] text-stone-500">{t(key)}</dt>
            <dd data-testid={testId} className="mt-0.5 text-sm">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {/*
        Should be zero: the solver forbids a transfer whose walk exceeds the break. Shown anyway,
        because a constraint that is never displayed is one nobody notices has stopped working.
      */}
      <p
        data-testid="quality-tight"
        className={`rounded border p-2.5 text-[0.65rem] leading-relaxed ${
          summary.tightTransfers > 0
            ? 'border-red-400/70 bg-red-400/10 text-red-300'
            : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-300'
        }`}
      >
        {summary.tightTransfers > 0
          ? t('quality.tightBad', { n: summary.tightTransfers })
          : t('quality.tightGood')}
      </p>

      <div>
        <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-amber-400">
          {t('quality.unpopular')}
        </h3>
        <p data-testid="quality-unpopular" className="mt-1 text-xs">
          {t('quality.unpopularCount', {
            n: summary.unpopularSessions,
            threshold: model.unpopularThreshold,
          })}
        </p>
      </div>

      {worst.length > 0 && (
        <div>
          <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-400">
            {t('quality.worstCohorts')}
          </h3>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-stone-500">
            {t('quality.worstBlurb')}
          </p>
          <ul data-testid="quality-cohorts" className="mt-2 space-y-1.5">
            {worst.map((cohort) => (
              <li key={cohort.cohortId}>
                <button
                  type="button"
                  data-testid={`quality-cohort-${cohort.cohortId}`}
                  aria-pressed={state.cohortId === cohort.cohortId}
                  onClick={() => {
                    onChange({ cohortId: cohort.cohortId });
                    onSelectCohort?.(cohort);
                  }}
                  className={`w-full rounded border px-2 py-1.5 text-left transition ${
                    state.cohortId === cohort.cohortId
                      ? 'border-stone-300 bg-stone-800'
                      : 'border-stone-700 hover:border-stone-500'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {cohort.programme ?? cohort.cohortId} · {cohort.semester}
                    </span>
                    <span className="shrink-0 text-[0.6rem] text-stone-400">
                      {t('quality.blocks', { n: cohort.idleBlocks })}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[0.65rem] text-stone-400">
                    {t('quality.cohortDetail', {
                      days: cohort.daysWithGap,
                      total: cohort.days,
                      head: cohort.headcount ?? 0,
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The limitation, on screen rather than buried in a comment. cohort_group records sizes and
        not membership, so a per-student day is not derivable — and inventing one produced 147
        impossible transfers in a plan that is genuinely conflict-free. This is precisely the
        mapping an Untis export supplies (REQUIREMENTS §4.2).
      */}
      {!model.studentGroupMappingModelled && (
        <p
          data-testid="quality-limitation"
          className="rounded border border-stone-700 bg-stone-800/50 p-2.5 text-[0.65rem] leading-relaxed text-stone-400"
        >
          {t('quality.limitation', { combos: model.groupCheck.combinations })}
        </p>
      )}

      {/*
        ⚠️ TRANSLATED, not taken from `model.syntheticWarning`. The generator writes that field in
        German, so the English build displayed a German sentence. The field stays in the JSON as
        provenance for anyone reading the data; the SCREEN gets the reader's language.
      */}
      <p className="text-[0.65rem] leading-relaxed text-amber-200">{t('quality.synthetic')}</p>
    </div>
  );
}
