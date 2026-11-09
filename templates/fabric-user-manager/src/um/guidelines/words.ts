/**
 * The questions in the language of the interface. What is stored stays the
 * English choice; only what is shown changes.
 */
import type { Locale } from '@/i18n';

import type { GuidelineQuestion } from './questions';
import { CATEGORIES_DE, QUESTIONS_DE, type QuestionWords } from './questions.de';

export function questionWords(q: GuidelineQuestion, locale: Locale): QuestionWords {
  const de = locale === 'de' ? QUESTIONS_DE[q.id] : undefined;
  return {
    label: de?.label ?? q.label,
    question: de?.question ?? q.question,
    help: de?.help ?? q.help,
    placeholder: de?.placeholder ?? q.placeholder,
    options: de?.options ?? q.options,
  };
}

/** How one stored choice is shown. An unknown choice is shown as it is. */
export function optionLabel(q: GuidelineQuestion, option: string, locale: Locale): string {
  const index = (q.options ?? []).indexOf(option);
  return (index >= 0 ? questionWords(q, locale).options?.[index] : undefined) ?? option;
}

export function categoryLabel(category: string, locale: Locale): string {
  return (locale === 'de' ? CATEGORIES_DE[category] : undefined) ?? category;
}
