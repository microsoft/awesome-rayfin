/**
 * An organization's answers to the guideline questions.
 *
 * Stored once for everyone in the Hub's settings table, under one key. That
 * table can be written by any signed-in person, so what is read from it is
 * treated as untrusted: only known questions, only offered choices, bounded
 * free text. The answers change what the guidelines say, never what anyone
 * may do.
 */
import type { Locale } from '@/i18n';

import { GUIDELINE_QUESTIONS, QUESTION_CATEGORIES, formatAnswerValue, type Answer, type GuidelineQuestion } from './questions';
import { categoryLabel, optionLabel, questionWords } from './words';

export const SETTING_GUIDELINES = 'guidelines.answers';

/** Longest free text that is kept per answer. */
export const MAX_TEXT = 500;

export interface Conventions {
  answers: Record<string, Answer>;
  /** Who saved them last, and when (ISO). Shown, not relied upon. */
  updatedBy?: string;
  updatedAt?: string;
}

export const NO_CONVENTIONS: Conventions = { answers: {} };

const QUESTION_BY_ID = new Map(GUIDELINE_QUESTIONS.map((q) => [q.id, q]));

/**
 * Free text, bounded and trimmed. Control characters and line separators
 * become spaces; invisible format characters (direction overrides, zero-width
 * marks) are dropped, so an answer cannot read differently from what it is.
 */
function cleanText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return '';
  // Cut by characters, never through the middle of one.
  return Array.from(value.slice(0, max * 4))
    .slice(0, max)
    .join('')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .trim();
}

function cleanAnswer(q: GuidelineQuestion, raw: unknown): Answer | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const answer: Answer = {};
  if (q.type === 'text') {
    const text = cleanText(a.text);
    if (text) answer.text = text;
  } else {
    const options = q.options ?? [];
    if (q.type === 'single') {
      if (typeof a.choice === 'string' && options.includes(a.choice)) answer.choice = a.choice;
    } else if (Array.isArray(a.choices)) {
      const chosen = options.filter((o) => (a.choices as unknown[]).includes(o));
      if (chosen.length > 0) answer.choices = chosen;
    }
    if (q.allowOther) {
      const other = cleanText(a.other);
      if (other) answer.other = other;
    }
  }
  return Object.keys(answer).length > 0 ? answer : null;
}

/** Only what the question bank knows, in a shape the views can rely on. */
export function cleanAnswers(raw: unknown): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  if (!raw || typeof raw !== 'object') return answers;
  for (const q of GUIDELINE_QUESTIONS) {
    const answer = cleanAnswer(q, (raw as Record<string, unknown>)[q.id]);
    if (answer) answers[q.id] = answer;
  }
  return answers;
}

/** The stored value as conventions. Anything unexpected reads as "nothing set". */
export function readConventions(raw: unknown): Conventions {
  if (!raw || typeof raw !== 'object') return NO_CONVENTIONS;
  const stored = raw as Record<string, unknown>;
  const conventions: Conventions = { answers: cleanAnswers(stored.answers) };
  const by = cleanText(stored.updatedBy, 256);
  if (by) conventions.updatedBy = by;
  if (typeof stored.updatedAt === 'string' && !Number.isNaN(Date.parse(stored.updatedAt))) conventions.updatedAt = new Date(stored.updatedAt).toISOString();
  return conventions;
}

/** What is written: version, cleaned answers, who and when. */
export function toStored(answers: Record<string, Answer>, updatedBy: string, now: Date): { v: 1 } & Required<Conventions> {
  return { v: 1, answers: cleanAnswers(answers), updatedBy, updatedAt: now.toISOString() };
}

export function sameAnswers(a: Record<string, Answer>, b: Record<string, Answer>): boolean {
  return JSON.stringify(cleanAnswers(a)) === JSON.stringify(cleanAnswers(b));
}

/** The organization's answer to one question as text, or `null` when it has none. */
export function teamAnswer(answers: Record<string, Answer>, qid: string, locale: Locale = 'en'): string | null {
  const q = QUESTION_BY_ID.get(qid);
  return q ? formatAnswerValue(q, answers[qid], (option) => optionLabel(q, option, locale)) : null;
}

/** The standard that applies while a question is unanswered. */
export function defaultValue(qid: string, locale: Locale = 'en'): string {
  const q = QUESTION_BY_ID.get(qid);
  if (!q) return '';
  const words = questionWords(q, locale);
  if (words.options?.length) return words.options[0];
  return (words.placeholder ?? '').replace(/^(e\.g\.|z\.\s?B\.)\s*/i, '').trim();
}

export function isQuestion(qid: string): boolean {
  return QUESTION_BY_ID.has(qid);
}

export interface CategoryProgress {
  /** The group as the question bank names it. */
  category: string;
  /** The group as it is shown. */
  label: string;
  answered: number;
  total: number;
}

export interface Progress {
  answered: number;
  total: number;
  byCategory: CategoryProgress[];
}

export function progressOf(answers: Record<string, Answer>, locale: Locale = 'en'): Progress {
  const byCategory = QUESTION_CATEGORIES.map((category) => {
    const inCategory = GUIDELINE_QUESTIONS.filter((q) => q.category === category);
    return { category, label: categoryLabel(category, locale), total: inCategory.length, answered: inCategory.filter((q) => formatAnswerValue(q, answers[q.id]) !== null).length };
  });
  return { answered: byCategory.reduce((n, c) => n + c.answered, 0), total: GUIDELINE_QUESTIONS.length, byCategory };
}

export interface AnsweredGroup {
  category: string;
  items: { id: string; label: string; value: string }[];
}

/** The answered questions, grouped the way the questionnaire groups them. */
export function answeredGroups(answers: Record<string, Answer>, locale: Locale = 'en'): AnsweredGroup[] {
  return QUESTION_CATEGORIES.map((category) => ({
    category: categoryLabel(category, locale),
    items: GUIDELINE_QUESTIONS.filter((q) => q.category === category).flatMap((q) => {
      const value = teamAnswer(answers, q.id, locale);
      return value === null ? [] : [{ id: q.id, label: questionWords(q, locale).label, value }];
    }),
  })).filter((g) => g.items.length > 0);
}

/** The conventions as plain text, for pasting into a document or a mail. */
export function summaryText(answers: Record<string, Answer>, locale: Locale = 'en'): string {
  const lines = [locale === 'de' ? 'Power BI-Leitfaden: unsere Konventionen' : 'Power BI Guidelines: our conventions', ''];
  for (const group of answeredGroups(answers, locale)) {
    lines.push(group.category.toUpperCase());
    for (const item of group.items) lines.push(`- ${item.label}: ${item.value}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}
