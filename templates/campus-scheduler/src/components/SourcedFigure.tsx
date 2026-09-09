import { useI18n } from '@/i18n';
import type { Fact } from '@/data/facts';

/**
 * Renders a figure together with its citation.
 *
 * If the fact has no source, this deliberately renders a loud, ugly defect marker instead of a
 * clean number — PLAN §4.8. Making an unsourced figure *look* broken is the enforcement
 * mechanism; a lint rule would be easy to ignore, a red box in the demo is not.
 */
export function SourcedFigure({ fact }: { fact: Fact<number> }) {
  const { t, locale } = useI18n();
  const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');
  const unit = fact.unit ? ` ${fact.unit}` : '';

  // A reconstruction is shown as the range the authority published, never as one confident
  // number — PLAN §4.8.
  const formatted = fact.range
    ? `${nf.format(fact.range[0])}–${nf.format(fact.range[1])}${unit}`
    : `${nf.format(fact.value)}${unit}`;

  if (!fact.source) {
    return (
      <span
        data-testid="unsourced-figure"
        title={t('source.pending')}
        className="inline-flex items-baseline gap-2 rounded border border-amber-500/70 bg-amber-100/70 px-2 py-0.5"
      >
        <span className="font-semibold text-stone-900">{formatted}</span>
        <span className="text-[0.65rem] uppercase tracking-wider text-amber-700">
          {t('source.pending')}
        </span>
      </span>
    );
  }

  const citation = [
    fact.source.issuer,
    String(fact.source.year),
    fact.source.reconstruction ? t('facts.reconstruction') : null,
    fact.source.status,
  ]
    .filter(Boolean)
    .join(' · ');

  // `inline`, not `inline-flex`. As a flex box the figure is one unbreakable item, so a sentence
  // that continues after it — "… bei 500 m³/s." — pushed its own full stop onto a line of its own.
  // Inline lets the citation wrap as text and keeps the punctuation attached to it.
  return (
    <span data-testid="sourced-figure" className="inline">
      <span className="font-semibold text-stone-900">{formatted}</span>{' '}
      <span className="text-xs text-stone-500" title={fact.source.title}>
        {t('source.label')}: {citation}
      </span>
    </span>
  );
}
