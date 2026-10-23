/**
 * The fourth tab: the Power BI guidelines, and the questionnaire in Setup
 * that tailors them. Content and answer handling are checked as data; the
 * views run against the offline fixtures.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import { I18nProvider } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { UM_PATHS } from '@/um/domain/profile';
import { SECTIONS, type GuideItem, type GuideSection } from '@/um/guidelines/content';
import { SECTIONS_DE } from '@/um/guidelines/content.de';
import { MAX_TEXT, SETTING_GUIDELINES, answeredGroups, cleanAnswers, defaultValue, isQuestion, progressOf, readConventions, sameAnswers, summaryText, teamAnswer, toStored } from '@/um/guidelines/conventions';
import { FIGURE_IDS, FIGURE_PLACES } from '@/um/guidelines/figureIds';
import { countRules, plainText, searchGuide, sectionsFor, textParts, tokensIn } from '@/um/guidelines/guide';
import { GUIDELINE_QUESTIONS, QUESTION_CATEGORIES } from '@/um/guidelines/questions';
import { CATEGORIES_DE, QUESTIONS_DE } from '@/um/guidelines/questions.de';
import { optionLabel, questionWords } from '@/um/guidelines/words';
import { UmProvider } from '@/um/hooks/UmContext';
import { OfflineAuthService } from '@/um/services/offlineAuth';
import { createUmServices, type UmServices } from '@/um/services/services';
import { umRouteElements } from '@/um/UmRoutes';

// Every wording a drawing asks for in German and does not find is noted here.
const { missingGerman } = vi.hoisted(() => ({ missingGerman: new Set<string>() }));
vi.mock('@/um/guidelines/figures.de', async (original) => {
  const actual = await original<typeof import('@/um/guidelines/figures.de')>();
  return {
    FIGURES_DE: new Proxy(actual.FIGURES_DE, {
      get(target, key) {
        if (typeof key === 'string' && !(key in target)) missingGerman.add(key);
        return target[key as string];
      },
    }),
  };
});

vi.mock('@/um/services/excelClient', () => ({
  readSheet: vi.fn(),
  writeSheet: vi.fn(async () => new Blob()),
  downloadBlob: vi.fn(),
}));

// The questionnaire keeps unsaved answers for the browser tab; no test inherits another's.
beforeEach(() => window.sessionStorage.clear());

type Persona = 'admin' | 'owner' | 'user';

function renderApp(persona: Persona, path: string, options: { locale?: 'en' | 'de'; services?: UmServices } = {}) {
  const search = `?as=${persona}`;
  const services = options.services ?? createUmServices({ mock: true, adminUserIds: [] }, search);
  render(
    <I18nProvider initialLocale={options.locale ?? 'en'}>
      <AuthProvider authService={new OfflineAuthService(search)}>
        <MemoryRouter initialEntries={[path]}>
          <UmProvider services={services}>
            <Routes>
              <Route element={<UmLayout />}>{umRouteElements()}</Route>
              <Route path="*" element={<Navigate to={UM_PATHS.workspaces} replace />} />
            </Routes>
          </UmProvider>
        </MemoryRouter>
      </AuthProvider>
    </I18nProvider>
  );
  return services;
}

function everyItem(items: readonly GuideItem[]): GuideItem[] {
  return items.flatMap((item) => [item, ...everyItem(item.children ?? [])]);
}
const ALL_ITEMS = SECTIONS.flatMap((s) => s.subs.flatMap((sub) => everyItem(sub.items)));
const textsOf = (sections: GuideSection[]) => [
  ...sections.flatMap((s) => [s.title, ...s.subs.flatMap((sub) => [sub.title, sub.intro ?? '', sub.link?.label ?? ''])]),
  ...sections.flatMap((s) => s.subs.flatMap((sub) => everyItem(sub.items))).flatMap((item) => [item.title ?? '', item.text ?? '', item.link?.label ?? '']),
];
const ALL_TEXTS = textsOf(SECTIONS);

/** Everything about the guide except its words. */
function shape(sections: GuideSection[]): unknown {
  const item = (it: GuideItem): unknown => ({
    marker: it.marker,
    q: it.q,
    title: !!it.title,
    text: !!it.text,
    tokens: [...tokensIn(it.title), ...tokensIn(it.text)].sort(),
    href: it.link?.href,
    children: (it.children ?? []).map(item),
  });
  return sections.map((s) => ({ id: s.id, num: s.num, icon: s.icon, subs: s.subs.map((sub) => ({ num: sub.num, intro: !!sub.intro, href: sub.link?.href, items: sub.items.map(item) })) }));
}

describe('guideline content', () => {
  it('has three areas with unique ids and topic numbers', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Data Integration', 'Data Modeling', 'Data Visualization']);
    expect(SECTIONS.map((s) => s.num)).toEqual(['1', '2', '3']);
    // The style guide is the last topic of the model area, not an area of its own.
    expect(SECTIONS[1].subs[SECTIONS[1].subs.length - 1].title).toBe('Tabular Style Guide');
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    const nums = SECTIONS.flatMap((s) => s.subs.map((sub) => sub.num));
    expect(new Set(nums).size).toBe(nums.length);
    for (const s of SECTIONS) for (const sub of s.subs) expect(sub.num.startsWith(`${s.num}.`)).toBe(true);
  });

  it('refers only to questions that exist', () => {
    const referenced = [...ALL_ITEMS.flatMap((item) => (item.q ? [item.q] : [])), ...ALL_TEXTS.flatMap((text) => tokensIn(text))];
    expect(referenced.length).toBeGreaterThan(30);
    for (const qid of referenced) expect(isQuestion(qid), qid).toBe(true);
  });

  it('places every drawing once, at a topic or a rule that exists, the same in both languages', () => {
    const figures = Object.values(FIGURE_PLACES).flat();
    // Every drawing is used, and none twice.
    expect([...figures].sort()).toEqual([...FIGURE_IDS].sort());
    for (const guide of [sectionsFor('en'), sectionsFor('de')]) {
      const places = new Set(guide.flatMap((s) => s.subs.flatMap((sub) => [sub.num, ...sub.items.map((item) => item.place ?? '')])));
      for (const place of Object.keys(FIGURE_PLACES)) expect(places.has(place), place).toBe(true);
    }
    // A rule keeps its place when a search narrows the list around it.
    const found = searchGuide(sectionsFor('en'), 'nested IF', {}).flatMap((s) => s.subs.flatMap((sub) => sub.items.map((item) => item.place)));
    expect(found).toEqual(['2.6/3']);
    // Also when only something below the rule matches.
    const below = searchGuide(sectionsFor('en'), 'Outlined bar', {}).flatMap((s) => s.subs.flatMap((sub) => sub.items.map((item) => item.place)));
    expect(below).toEqual(['3.3/3']);
  });

  it('links only to https addresses', () => {
    const links = [...SECTIONS.flatMap((s) => s.subs.flatMap((sub) => (sub.link ? [sub.link] : []))), ...ALL_ITEMS.flatMap((item) => (item.link ? [item.link] : []))];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.href.startsWith('https://')).toBe(true);
  });

  it('is the same guide in German: same structure, markers, question links, drawings and addresses', () => {
    expect(shape(SECTIONS_DE)).toEqual(shape(SECTIONS));
    for (const sub of SECTIONS_DE.flatMap((s) => s.subs)) if (sub.link) expect(sub.link.label.length).toBeGreaterThan(5);
    expect(sectionsFor('de').map((s) => s.title)).toEqual(SECTIONS_DE.map((s) => s.title));
    expect(sectionsFor('en').map((s) => s.title)).toEqual(SECTIONS.map((s) => s.title));
    // Translated, not copied: the area titles differ, and most of the prose does.
    for (let i = 0; i < SECTIONS.length; i += 1) expect(SECTIONS_DE[i].title).not.toBe(SECTIONS[i].title);
    const en = textsOf(SECTIONS);
    const same = textsOf(SECTIONS_DE).filter((text, i) => text !== '' && text === en[i]);
    expect(same.length).toBeLessThan(25);
  });

  it('uses no em or en dashes in its prose, and neither do the questions', () => {
    const dash = /[–—]/;
    for (const text of [...ALL_TEXTS, ...textsOf(SECTIONS_DE)]) expect(dash.test(text), text).toBe(false);
    for (const words of Object.values(QUESTIONS_DE)) expect(dash.test([words.label, words.question, words.help ?? '', words.placeholder ?? '', ...(words.options ?? [])].join(' ')), words.label).toBe(false);
    for (const q of GUIDELINE_QUESTIONS) expect(dash.test([q.label, q.question, q.help ?? '', q.placeholder ?? '', ...(q.options ?? [])].join(' ')), q.id).toBe(false);
  });

  it('counts what says something as a rule, not a bare heading', () => {
    expect(countRules([{ marker: '', title: 'Heading', children: [{ text: 'a' }, { text: 'b' }] }])).toBe(2);
    expect(countRules([{ title: 'Create explicit measures.' }])).toBe(1);
    expect(countRules([{ title: 'Rule', text: 'with text', children: [{ text: 'detail' }] }])).toBe(2);
  });
});

describe('the question bank', () => {
  it('has fifty questions with unique ids in known groups', () => {
    expect(GUIDELINE_QUESTIONS).toHaveLength(50);
    expect(new Set(GUIDELINE_QUESTIONS.map((q) => q.id)).size).toBe(50);
    for (const q of GUIDELINE_QUESTIONS) {
      expect(QUESTION_CATEGORIES).toContain(q.category);
      if (q.type !== 'text') expect(q.options?.length ?? 0).toBeGreaterThan(1);
    }
  });
});

describe('the questions in German', () => {
  it('has words for every question, and for every choice in the same order', () => {
    expect(Object.keys(QUESTIONS_DE).sort()).toEqual(GUIDELINE_QUESTIONS.map((q) => q.id).sort());
    expect(Object.keys(CATEGORIES_DE)).toEqual([...QUESTION_CATEGORIES]);
    for (const q of GUIDELINE_QUESTIONS) {
      const de = QUESTIONS_DE[q.id];
      expect(de.options?.length ?? 0, q.id).toBe(q.options?.length ?? 0);
      expect(!!de.help, q.id).toBe(!!q.help);
      expect(de.label.length, q.id).toBeGreaterThan(0);
      expect(de.question.endsWith('?'), q.id).toBe(true);
    }
  });

  it('shows a stored English choice in German without changing what is stored', () => {
    const q = GUIDELINE_QUESTIONS.find((g) => g.id === 'hide-keys')!;
    expect(optionLabel(q, 'No', 'de')).toBe('Nein');
    expect(optionLabel(q, 'No', 'en')).toBe('No');
    expect(optionLabel(q, 'something else', 'de')).toBe('something else');
    // A few pairs by name, so a reordered list does not pass on count alone.
    const byId = (id: string) => GUIDELINE_QUESTIONS.find((g) => g.id === id)!;
    expect(optionLabel(byId('page-size'), '1280×720 (16:9, default)', 'de')).toBe('1280×720 (16:9, Standard)');
    expect(optionLabel(byId('remove-unused'), 'Ad-hoc', 'de')).toBe('Bei Gelegenheit');
    expect(optionLabel(byId('db-type-prefixes'), 'None', 'de')).toBe('Keine');
    expect(optionLabel(byId('schema-approach'), 'Snowflake allowed', 'de')).toBe('Schneeflocke erlaubt');
    expect(optionLabel(byId('fiscal-start'), 'July', 'de')).toBe('Juli');
    expect(questionWords(q, 'de').label).toBe('Schlüsselspalten ausblenden');
    const answers = cleanAnswers({ 'hide-keys': { choice: 'No' }, 'db-type-prefixes': { choices: ['FACT_', 'None'], other: 'STG_' }, 'fiscal-usage': { choice: 'Both' } });
    expect(teamAnswer(answers, 'hide-keys', 'de')).toBe('Nein');
    expect(teamAnswer(answers, 'db-type-prefixes', 'de')).toBe('FACT_, Keine, STG_');
    expect(teamAnswer(answers, 'db-type-prefixes')).toBe('FACT_, None, STG_');
    expect(answeredGroups(answers, 'de').map((g) => g.category)).toEqual(['Tabellen & Schema', 'Kalender & Zeit', 'Spalten & Schlüssel']);
    expect(progressOf(answers, 'de').byCategory[0]).toMatchObject({ category: 'Naming & General', label: 'Benennung & Allgemeines' });
    expect(summaryText(answers, 'de')).toContain('- Geschäftsjahr: Beides');
    expect(defaultValue('measure-table-name', 'de')).toBe('Measure');
    expect(defaultValue('schema-approach', 'de')).toBe('Striktes Sternschema');
  });
});

describe('stored answers are treated as untrusted', () => {
  it('keeps only known questions, offered choices and bounded text', () => {
    const cleaned = cleanAnswers({
      'naming-casing': { choice: 'PascalCase', other: '  with exceptions\u0007 ' },
      'words-spaces': { choice: 'Maybe' },
      'db-type-prefixes': { choices: ['DIM_', 'DROP TABLE', 'FACT_', 'DIM_'] },
      'object-language': { text: 'x'.repeat(MAX_TEXT + 50) },
      'measure-table-name': { text: '   ' },
      'not-a-question': { choice: 'Yes' },
      'schema-approach': 'Strict star schema',
      'has-date-dim': { choice: 'Yes', other: 'ignored, the question offers no notes' },
    });
    expect(cleaned['naming-casing']).toEqual({ choice: 'PascalCase', other: 'with exceptions' });
    expect(cleaned['words-spaces']).toBeUndefined();
    // In the order the question offers them, each once.
    expect(cleaned['db-type-prefixes']).toEqual({ choices: ['FACT_', 'DIM_'] });
    expect(cleaned['object-language'].text).toHaveLength(MAX_TEXT);
    expect(cleaned['measure-table-name']).toBeUndefined();
    expect(cleaned['not-a-question']).toBeUndefined();
    expect(cleaned['schema-approach']).toBeUndefined();
    expect(cleaned['has-date-dim']).toEqual({ choice: 'Yes' });
  });

  it('reads only the questions it knows, whatever else the stored object carries', () => {
    const hostile = JSON.parse('{"__proto__":{"choice":"Yes"},"constructor":{"choice":"Yes"},"toString":{"text":"x"},"has-date-dim":{"choice":"Yes"}}') as unknown;
    expect(cleanAnswers(hostile)).toEqual({ 'has-date-dim': { choice: 'Yes' } });
    expect(({} as Record<string, unknown>).choice).toBeUndefined();
  });

  it('drops invisible characters and never cuts a character in half', () => {
    const cleaned = cleanAnswers({ 'object-language': { text: 'Eng\u202Elish\u200B\nGerman\u2028' }, 'extra-standards': { text: '😀'.repeat(MAX_TEXT + 5) } });
    expect(cleaned['object-language'].text).toBe('English German');
    expect(Array.from(cleaned['extra-standards'].text ?? '')).toHaveLength(MAX_TEXT);
    expect(cleaned['extra-standards'].text?.endsWith('😀')).toBe(true);
  });

  it('reads anything unexpected as "nothing set"', () => {
    for (const raw of [undefined, null, true, 'text', 42, [], { answers: 'x' }, { answers: null }]) expect(readConventions(raw).answers).toEqual({});
    expect(readConventions({ answers: {}, updatedAt: 'yesterday', updatedBy: 7 })).toEqual({ answers: {} });
  });

  it('round-trips what the questionnaire stores', () => {
    const stored = toStored({ 'page-size': { choice: '1280×720 (16:9, default)' }, 'extra-standards': { text: ' Reviews before release ' } }, 'ada@x.example', new Date('2026-10-12T09:00:00Z'));
    expect(stored).toEqual({ v: 1, answers: { 'page-size': { choice: '1280×720 (16:9, default)' }, 'extra-standards': { text: 'Reviews before release' } }, updatedBy: 'ada@x.example', updatedAt: '2026-10-12T09:00:00.000Z' });
    const back = readConventions(JSON.parse(JSON.stringify(stored)));
    expect(back).toEqual({ answers: stored.answers, updatedBy: 'ada@x.example', updatedAt: '2026-10-12T09:00:00.000Z' });
    expect(sameAnswers(back.answers, { 'extra-standards': { text: 'Reviews before release  ' }, 'page-size': { choice: '1280×720 (16:9, default)' } })).toBe(true);
  });

  it('reports progress per group and lists the answers', () => {
    const answers = cleanAnswers({ 'naming-casing': { choice: 'Title Case' }, 'measure-table-name': { text: 'Kennzahlen' }, 'fiscal-start': { other: 'March' } });
    const progress = progressOf(answers);
    expect(progress).toMatchObject({ answered: 3, total: 50 });
    expect(progress.byCategory.find((c) => c.category === 'Naming & General')).toEqual({ category: 'Naming & General', label: 'Naming & General', answered: 2, total: 10 });
    expect(progress.byCategory.reduce((n, c) => n + c.total, 0)).toBe(50);
    expect(answeredGroups(answers).map((g) => g.category)).toEqual(['Naming & General', 'Calendar & Time']);
    expect(summaryText(answers)).toContain('- Measure table name: Kennzahlen');
    expect(teamAnswer(answers, 'fiscal-start')).toBe('March');
    expect(teamAnswer(answers, 'ibcs')).toBeNull();
    expect(defaultValue('measure-table-name')).toBe('Measure');
    expect(defaultValue('naming-casing')).toBe('Title Case');
  });
});

describe('filling in and searching', () => {
  const answers = cleanAnswers({ 'measure-table-name': { text: 'Kennzahlen' } });

  it('fills a text with the answer, or with the marked standard', () => {
    const text = 'Use the table "{{measure-table-name}}" and {{naming-casing}}.';
    expect(textParts(text, answers)).toEqual([
      { kind: 'text', text: 'Use the table "' },
      { kind: 'team', text: 'Kennzahlen', qid: 'measure-table-name' },
      { kind: 'text', text: '" and ' },
      { kind: 'default', text: 'Title Case', qid: 'naming-casing' },
      { kind: 'text', text: '.' },
    ]);
    expect(plainText(text, {})).toBe('Use the table "Measure" and Title Case.');
  });

  it('narrows the guide to what mentions the query, including filled-in answers', () => {
    expect(searchGuide(SECTIONS, '  ', answers)).toHaveLength(SECTIONS.length);
    const divide = searchGuide(SECTIONS, 'divide', answers);
    expect(divide.flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.6']);
    // A match on the topic title keeps the whole topic.
    // A match on a group inside the style guide keeps that group, not the whole topic.
    const hierarchies = searchGuide(SECTIONS, 'Hierarchies', answers);
    expect(hierarchies.flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.11']);
    expect(hierarchies[0].subs[0].items.map((item) => item.title)).toEqual(['Hierarchies']);
    expect(searchGuide(SECTIONS, 'Tabular Style Guide', answers).flatMap((s) => s.subs).find((sub) => sub.num === '2.11')?.items.length).toBe(9);
    expect(searchGuide(SECTIONS, 'kennzahlen', answers).flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.5']);
    expect(searchGuide(SECTIONS, 'kennzahlen', {})).toEqual([]);
    expect(searchGuide(SECTIONS, 'no such thing anywhere', answers)).toEqual([]);
  });
});

describe('the Power BI Guidelines tab', () => {
  it('is the fourth tab and shows the standard guide to everyone', async () => {
    renderApp('user', UM_PATHS.guidelines);
    const nav = await screen.findByRole('navigation', { name: 'Fabric User Manager' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Workspaces', 'Audiences', 'RLS / OLS', 'Power BI Guidelines']);
    expect(await screen.findByRole('heading', { level: 2, name: 'Power BI Guidelines' })).toBeInTheDocument();
    for (const section of SECTIONS) expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    // An ordinary user is not offered the questionnaire.
    expect(screen.queryByRole('link', { name: 'Tailor to your organization' })).not.toBeInTheDocument();
    // The drawings carry a text alternative.
    expect(screen.getByRole('img', { name: /Star schema: a fact table linked directly to four dimensions/ })).toBeInTheDocument();
    expect(screen.getAllByText('Avoid').length).toBeGreaterThan(2);
    // A drawing that belongs to a topic, and one that belongs to a rule.
    expect(screen.getByText('Three ways to connect')).toBeInTheDocument();
    expect(screen.getByText('Almost never')).toBeInTheDocument();
    expect(screen.getByText('Time with its deviations')).toBeInTheDocument();
  });

  it('searches the guide', async () => {
    const user = userEvent.setup();
    renderApp('user', UM_PATHS.guidelines);
    await user.type(await screen.findByRole('searchbox', { name: 'Search the guidelines' }), 'treatas');
    expect(screen.getByText('1 topics mention this.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'DAX' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Data Visualization' })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search the guidelines' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the guidelines' }), 'zzzz');
    expect(screen.getByText('Nothing in the guidelines mentions this.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Data Visualization' })).toBeInTheDocument();
  });

  it('shows stored conventions in the text, and ignores what does not belong there', async () => {
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=user');
    await services.store.setSetting(
      SETTING_GUIDELINES,
      { v: 1, answers: { 'measure-table-name': { text: 'Kennzahlen' }, 'hide-keys': { choice: 'No' }, 'ibcs': { choice: '<img src=x onerror=alert(1)>' }, 'extra-standards': { text: '<img src=x onerror=alert(1)>' } }, updatedBy: 'ada@x.example', updatedAt: '2026-10-12T09:00:00.000Z' },
      'ada@x.example'
    );
    renderApp('user', UM_PATHS.guidelines, { services });
    expect(await screen.findByRole('heading', { name: 'Tailored to your organization' })).toBeInTheDocument();
    expect(screen.getByText('3 of 50 conventions are set. They are marked in the text below.')).toBeInTheDocument();
    expect(screen.getByText(/Last saved by ada@x.example/)).toBeInTheDocument();
    // In the sentence, in the field list drawing and in the summary at the end.
    expect(screen.getAllByText('Kennzahlen').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTitle('Set by your organization')).toHaveTextContent('Kennzahlen');
    const summary = screen.getByRole('region', { name: "Your organization's conventions" });
    expect(within(summary).getByText('Hide key columns')).toBeInTheDocument();
    // A choice that was never offered is dropped. Free text is shown as text, never as markup.
    expect(within(summary).queryByText('IBCS standards')).not.toBeInTheDocument();
    expect(within(summary).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    // Not an admin: no way into the questionnaire.
    expect(screen.queryByRole('link', { name: 'Edit conventions' })).not.toBeInTheDocument();
  });

  it('is in German from the title to the drawings when the interface is', async () => {
    const user = userEvent.setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=user');
    await services.store.setSetting(SETTING_GUIDELINES, toStored({ 'hide-keys': { choice: 'No' } }, 'ada@x.example', new Date('2026-10-12T09:00:00Z')), 'ada@x.example');
    missingGerman.clear();
    renderApp('user', UM_PATHS.guidelines, { locale: 'de', services });
    expect(await screen.findByRole('heading', { level: 2, name: 'Power BI-Leitfaden' })).toBeInTheDocument();
    for (const section of SECTIONS_DE) expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Benennung: das Wichtigste' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Data Modeling' })).not.toBeInTheDocument();
    // The drawings: words and numbers.
    expect(screen.getByRole('img', { name: /Sternschema: eine Faktentabelle, direkt mit vier Dimensionen verbunden/ })).toBeInTheDocument();
    expect(screen.getAllByText('Vermeiden').length).toBeGreaterThan(2);
    expect(screen.getAllByText('12,4').length).toBeGreaterThan(0);
    expect(screen.getByText('31.536.000')).toBeInTheDocument();
    expect(screen.getByText('Drei Arten der Verbindung')).toBeInTheDocument();
    expect(screen.getByText('1.204')).toBeInTheDocument();
    expect(screen.getByText('Mär')).toBeInTheDocument();
    expect([...missingGerman]).toEqual([]);
    // A stored English choice is shown in German.
    expect(await screen.findByText('1 von 50 Konventionen sind festgelegt. Sie sind im Text unten markiert.')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Die Konventionen Ihrer Organisation' });
    expect(within(summary).getByText('Schlüsselspalten ausblenden')).toBeInTheDocument();
    expect(within(summary).getByText('Nein')).toBeInTheDocument();
    // Search runs over the German text.
    await user.type(screen.getByRole('searchbox', { name: 'Leitfaden durchsuchen' }), 'Sternschema');
    expect(screen.getByRole('heading', { level: 4, name: 'Schema' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Datenvisualisierung' })).not.toBeInTheDocument();
  });
});

describe('the questionnaire in Setup', () => {
  it('is for app admins only', async () => {
    renderApp('owner', UM_PATHS.guidelinesSetup);
    expect(await screen.findByText('Setup is for app admins.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save for everyone' })).not.toBeInTheDocument();
  });

  it('is reached from Setup', async () => {
    const user = userEvent.setup();
    renderApp('admin', UM_PATHS.setup);
    const section = (await screen.findByRole('heading', { level: 3, name: 'Power BI Guidelines' })).closest('section') as HTMLElement;
    await user.click(within(section).getByRole('link', { name: 'Open questionnaire' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tailor the guidelines' })).toBeInTheDocument();
  });

  it('saves answers for everyone, with who and when, and the guide shows them', async () => {
    const user = userEvent.setup();
    const services = renderApp('admin', UM_PATHS.guidelinesSetup);
    const save = await screen.findByRole('button', { name: 'Save for everyone' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Nothing answered yet')).toBeInTheDocument();

    await user.click(within(screen.getByRole('group', { name: 'Which casing convention do you use for visible object names?' })).getByRole('radio', { name: 'PascalCase' }));
    await user.type(screen.getByRole('textbox', { name: 'What do you name your measure container table?' }), 'Kennzahlen');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('2 of 50 answered')).toBeInTheDocument();

    // Another group: several choices at once.
    await user.click(within(screen.getByRole('navigation', { name: 'Question groups' })).getByRole('button', { name: /Tables & Schema/ }));
    await user.click(screen.getByRole('checkbox', { name: 'DIM_' }));
    await user.click(screen.getByRole('checkbox', { name: 'FACT_' }));

    expect(await services.store.getSetting(SETTING_GUIDELINES)).toBeUndefined();
    await user.click(save);
    expect(await screen.findByText('Saved. The guidelines now show these answers.')).toBeInTheDocument();
    expect(screen.getByText('Everything saved')).toBeInTheDocument();

    const stored = readConventions(await services.store.getSetting(SETTING_GUIDELINES));
    expect(stored.answers).toEqual({ 'naming-casing': { choice: 'PascalCase' }, 'measure-table-name': { text: 'Kennzahlen' }, 'db-type-prefixes': { choices: ['FACT_', 'DIM_'] } });
    expect(stored.updatedBy).toMatch(/@/);
    expect(Number.isNaN(Date.parse(stored.updatedAt ?? ''))).toBe(false);

    await user.click(screen.getByRole('link', { name: 'Power BI Guidelines' }));
    expect(await screen.findByText('3 of 50 conventions are set. They are marked in the text below.')).toBeInTheDocument();
    expect(screen.getAllByText('PascalCase').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Edit conventions' })).toBeInTheDocument();
  });

  it('clears one answer, discards changes and clears all', async () => {
    const user = userEvent.setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    await services.store.setSetting(SETTING_GUIDELINES, toStored({ 'naming-casing': { choice: 'snake_case' }, 'words-spaces': { choice: 'No' } }, 'ada@x.example', new Date('2026-10-01T08:00:00Z')), 'ada@x.example');
    renderApp('admin', UM_PATHS.guidelinesSetup, { services });
    await screen.findByRole('radio', { name: 'snake_case' });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked());
    expect(screen.getByText(/Last saved by ada@x.example/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear answer: Casing convention' }));
    expect(screen.getByRole('radio', { name: 'snake_case' })).not.toBeChecked();
    expect(screen.getByText('1 of 50 answered')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Clear all answers' }));
    expect(screen.getByText('0 of 50 answered')).toBeInTheDocument();
    // Nothing is removed for everyone until it is saved.
    expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).answers).toHaveProperty('naming-casing');
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    await waitFor(async () => expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).answers).toEqual({}));
  });

  it('does not write over answers somebody else saved in the meantime', async () => {
    const user = userEvent.setup();
    const services = renderApp('admin', UM_PATHS.guidelinesSetup);
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    const theirs = toStored({ 'naming-casing': { choice: 'Title Case' } }, 'bob@x.example', new Date('2026-10-12T10:00:00Z'));
    await services.store.setSetting(SETTING_GUIDELINES, theirs, 'bob@x.example');

    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    expect(await screen.findByText(/bob@x.example saved other answers in the meantime/)).toBeInTheDocument();
    expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).updatedBy).toBe('bob@x.example');

    await user.click(screen.getByRole('button', { name: 'Load their answers' }));
    expect(screen.getByRole('radio', { name: 'Title Case' })).toBeChecked();
    expect(screen.getByText('Everything saved')).toBeInTheDocument();
  });

  it('replaces their answers only when asked to', async () => {
    const user = userEvent.setup();
    const services = renderApp('admin', UM_PATHS.guidelinesSetup);
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    // Stored without a time, as another app or a hand edit might: still a conflict.
    await services.store.setSetting(SETTING_GUIDELINES, { answers: { 'naming-casing': { choice: 'Title Case' } } }, 'someone');
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    expect(await screen.findByText('Other answers were stored in the meantime. Saving now replaces them.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Saved. The guidelines now show these answers.')).toBeInTheDocument();
    expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).answers).toEqual({ 'naming-casing': { choice: 'camelCase' } });
  });

  it('can still save when the stored answers were removed or damaged', async () => {
    const user = userEvent.setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    await services.store.setSetting(SETTING_GUIDELINES, toStored({ 'naming-casing': { choice: 'snake_case' } }, 'ada@x.example', new Date('2026-10-01T08:00:00Z')), 'ada@x.example');
    renderApp('admin', UM_PATHS.guidelinesSetup, { services });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked());
    await user.click(screen.getByRole('radio', { name: 'camelCase' }));
    // Anybody signed in can write this row.
    await services.store.setSetting(SETTING_GUIDELINES, 'not an object', 'someone');

    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    expect(await screen.findByText(/The answers that were stored before cannot be read now/)).toBeInTheDocument();
    expect(await services.store.getSetting(SETTING_GUIDELINES)).toBe('not an object');
    // There is nothing of theirs to load, only the way forward.
    expect(screen.queryByRole('button', { name: 'Load their answers' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Saved. The guidelines now show these answers.')).toBeInTheDocument();
    expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).answers).toEqual({ 'naming-casing': { choice: 'camelCase' } });
  });

  it('does not claim "saved" when what is stored afterwards is something else', async () => {
    const user = userEvent.setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    renderApp('admin', UM_PATHS.guidelinesSetup, { services });
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    const write = services.store.setSetting.bind(services.store);
    vi.spyOn(services.store, 'setSetting').mockImplementation(async (key, _value, by) => write(key, toStored({ 'naming-casing': { choice: 'Title Case' } }, 'bob@x.example', new Date('2026-10-12T10:00:00Z')), by));
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    expect(await screen.findByText(/what is stored now is not what was sent/)).toBeInTheDocument();
    expect(screen.queryByText('Saved. The guidelines now show these answers.')).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('keeps unsaved answers when the admin looks at another tab and comes back', async () => {
    const user = userEvent.setup();
    const services = renderApp('admin', UM_PATHS.guidelinesSetup);
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    await user.click(screen.getByRole('link', { name: 'Power BI Guidelines' }));
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Tailor to your organization' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'camelCase' })).toBeChecked());
    expect(screen.getByText('Your unsaved answers from before are back in the form. They are not saved yet.')).toBeInTheDocument();
    expect(await services.store.getSetting(SETTING_GUIDELINES)).toBeUndefined();
    // Discarding forgets them for good.
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('radio', { name: 'camelCase' })).not.toBeChecked();
    expect(window.sessionStorage.getItem('um.guidelines.draft')).toBeNull();
  });

  it('asks in German and stores the same English choice', async () => {
    const user = userEvent.setup();
    const services = renderApp('admin', UM_PATHS.guidelinesSetup, { locale: 'de' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Leitfaden zuschneiden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Für alle speichern' })).toBeDisabled();
    expect(screen.getByText('Noch nichts beantwortet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Benennung & Allgemeines' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Trennen Sie Wörter in sichtbaren Objektnamen durch Leerzeichen?' })).getByRole('radio', { name: 'Nein' }));
    await user.click(screen.getByRole('button', { name: 'Für alle speichern' }));
    expect(await screen.findByText('Gespeichert. Der Leitfaden zeigt jetzt diese Antworten.')).toBeInTheDocument();
    expect(readConventions(await services.store.getSetting(SETTING_GUIDELINES)).answers).toEqual({ 'words-spaces': { choice: 'No' } });
  });

  it('says so when saving fails', async () => {
    const user = userEvent.setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    renderApp('admin', UM_PATHS.guidelinesSetup, { services });
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    vi.spyOn(services.store, 'setSetting').mockResolvedValue(false);
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    expect(await screen.findByText('The answers could not be saved. Nothing was changed.')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
