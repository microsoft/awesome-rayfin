/**
 * Reading the guideline content: filling in the organization's answers,
 * counting rules and searching. Pure, so it can be tested without a browser.
 */
import type { Locale } from '@/i18n';

import { SECTIONS, type GuideItem, type GuideSection, type GuideSub } from './content';
import { SECTIONS_DE } from './content.de';
import { defaultValue, teamAnswer } from './conventions';
import type { Answer } from './questions';

/** Every rule gets the place it has in its topic, which survives searching. */
function placed(sections: GuideSection[]): GuideSection[] {
  return sections.map((section) => ({
    ...section,
    subs: section.subs.map((sub) => ({ ...sub, items: sub.items.map((item, index) => ({ ...item, place: `${sub.num}/${index + 1}` })) })),
  }));
}

const GUIDES: Record<Locale, GuideSection[]> = { en: placed(SECTIONS), de: placed(SECTIONS_DE) };

/** The guide in the language of the interface. */
export function sectionsFor(locale: Locale): GuideSection[] {
  return GUIDES[locale] ?? GUIDES.en;
}

const TOKEN = /(\{\{[a-z0-9-]+\}\})/i;
const TOKEN_ID = /^\{\{([a-z0-9-]+)\}\}$/i;

export type TextPart = { kind: 'text'; text: string } | { kind: 'team' | 'default'; text: string; qid: string };

/** A text split into plain parts and filled-in answers. */
export function textParts(text: string, answers: Record<string, Answer>, locale: Locale = 'en'): TextPart[] {
  return text
    .split(TOKEN)
    .filter((part) => part !== '')
    .map((part) => {
      const qid = TOKEN_ID.exec(part)?.[1];
      if (!qid) return { kind: 'text', text: part };
      const team = teamAnswer(answers, qid, locale);
      return team ? { kind: 'team', text: team, qid } : { kind: 'default', text: defaultValue(qid, locale), qid };
    });
}

export function plainText(text: string | undefined, answers: Record<string, Answer>, locale: Locale = 'en'): string {
  return text
    ? textParts(text, answers, locale)
        .map((p) => p.text)
        .join('')
    : '';
}

/** The question ids a text refers to. */
export function tokensIn(text: string | undefined): string[] {
  return text ? text.split(TOKEN).flatMap((part) => TOKEN_ID.exec(part)?.[1] ?? []) : [];
}

/** Rules are the items that say something themselves; pure headings are not counted. */
export function countRules(items: readonly GuideItem[]): number {
  return items.reduce((n, item) => n + (item.text || !item.children?.length ? 1 : 0) + countRules(item.children ?? []), 0);
}

export function rulesIn(section: GuideSection): number {
  return section.subs.reduce((n, sub) => n + countRules(sub.items), 0);
}

function itemMatches(item: GuideItem, needle: string, answers: Record<string, Answer>, locale: Locale): boolean {
  return `${plainText(item.title, answers, locale)} ${plainText(item.text, answers, locale)} ${item.link?.label ?? ''}`.toLowerCase().includes(needle);
}

function filterItems(items: readonly GuideItem[], needle: string, answers: Record<string, Answer>, locale: Locale): GuideItem[] {
  return items.flatMap((item) => {
    // An item that matches is shown whole, with everything below it.
    if (itemMatches(item, needle, answers, locale)) return [item];
    const children = filterItems(item.children ?? [], needle, answers, locale);
    return children.length > 0 ? [{ ...item, children }] : [];
  });
}

/** The sections narrowed to what mentions the query. An empty query returns everything. */
export function searchGuide(sections: readonly GuideSection[], query: string, answers: Record<string, Answer>, locale: Locale = 'en'): GuideSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sections];
  return sections.flatMap((section) => {
    const subs = section.subs.flatMap((sub): GuideSub[] => {
      if (`${sub.num} ${sub.title} ${plainText(sub.intro, answers, locale)}`.toLowerCase().includes(needle)) return [sub];
      const items = filterItems(sub.items, needle, answers, locale);
      return items.length > 0 ? [{ ...sub, items }] : [];
    });
    return subs.length > 0 ? [{ ...section, subs }] : [];
  });
}
