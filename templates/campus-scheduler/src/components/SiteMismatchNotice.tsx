import { useI18n } from '@/i18n';

/**
 * Says plainly that the planner backend belongs to the other university.
 *
 * ⚠️ THE POINT IS TO REPLACE A CONFIDENT WRONG ANSWER, NOT TO DECORATE AN EMPTY PANEL.
 * One backend carries one `SCHEDULER_SITE` while the header offers two universities, so with LMU
 * selected the calendar asked for cohorts the backend has never heard of (`no cohort matches
 * 'MIS-INFO-1'`) and came back empty, and the assistant would have answered LMU questions from
 * OTH's 80 teachers and 30 cohorts without any hint that it had switched universities.
 *
 * Shown wherever backend-fed content would otherwise appear, so no route into that content ends
 * in a dead button or a blank week.
 */
export function SiteMismatchNotice({ serving, expected }: { serving: string; expected: string }) {
  const { t } = useI18n();

  return (
    <div
      data-testid="site-mismatch"
      role="status"
      className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-auto rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      {/* ⚠️ The stone scale here is INVERTED against Tailwind's: `stone-900` is the PAGE colour in
          light mode and `stone-100` is the primary text. This panel shipped with `text-stone-900`
          on a pale amber fill — the page colour on the page — and nothing caught it, because the
          notice only renders for the university the backend is not serving. */}
      <p className="text-sm font-semibold text-stone-100">{t('backend.mismatchTitle')}</p>
      <p className="text-xs leading-relaxed text-stone-300">
        {t('backend.mismatch', { serving: serving.toUpperCase(), expected })}
      </p>
    </div>
  );
}
