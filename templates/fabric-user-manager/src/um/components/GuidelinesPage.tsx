import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useI18n, type Locale, type Translate } from '@/i18n';
import { UM_PATHS } from '@/um/domain/profile';
import { type GuideItem, type GuideLink, type GuideSection, type GuideSub, type SectionIcon } from '@/um/guidelines/content';
import { answeredGroups, progressOf, teamAnswer } from '@/um/guidelines/conventions';
import { MeterList, ProgressRing } from '@/um/guidelines/charts';
import { FIGURE_PLACES, type FigureId } from '@/um/guidelines/figureIds';
import { Figure } from '@/um/guidelines/figureRegistry';
import { countRules, rulesIn, searchGuide, sectionsFor, textParts, tokensIn } from '@/um/guidelines/guide';
import type { Answer } from '@/um/guidelines/questions';
import { useConventions } from '@/um/guidelines/useConventions';
import { useUm } from '@/um/hooks/UmContext';

const ICONS: Record<SectionIcon, ReactElement> = {
  integration: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </>
  ),
  modeling: (
    <>
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="16.5" y="2.5" width="5" height="5" rx="1" />
      <rect x="2.5" y="16.5" width="5" height="5" rx="1" />
      <rect x="16.5" y="16.5" width="5" height="5" rx="1" />
      <path d="M7.5 7.5 9 9M16.5 7.5 15 9M7.5 16.5 9 15M16.5 16.5 15 15" />
    </>
  ),
  report: <path d="M4 20V4M4 20h16M8 17v-6M12 17V7M16 17v-4" />,
};

function Icon({ name }: { name: SectionIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const anchor = (id: string) => `guideline-${id}`;

function jumpTo(id: string) {
  document.getElementById(anchor(id))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

/** A text with the organization's answers filled in and marked. */
function Filled({ text, answers, t, locale }: { text: string; answers: Record<string, Answer>; t: Translate; locale: Locale }) {
  return (
    <>
      {textParts(text, answers, locale).map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'team' ? (
          <mark key={index} title={t('um.gl.teamValue')} className="rounded bg-blue-50 px-1 font-semibold break-words text-blue-800 ring-1 ring-inset ring-blue-600/20">
            {part.text}
          </mark>
        ) : (
          <span key={index} title={t('um.gl.defaultValue')} className="border-b border-dotted border-slate-400 text-slate-600">
            {part.text}
          </span>
        )
      )}
    </>
  );
}

function External({ link, t }: { link: GuideLink; t: Translate }) {
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">
      {link.label}
      <span aria-hidden="true">{' ↗'}</span>
      <span className="sr-only">{` (${t('um.gl.external')})`}</span>
    </a>
  );
}

function Items({
  items,
  answers,
  nested,
  t,
  locale,
  draw,
}: {
  items: readonly GuideItem[];
  answers: Record<string, Answer>;
  nested?: boolean;
  t: Translate;
  locale: Locale;
  /** Draws one drawing; only rules of the first level carry any. */
  draw?: (id: FigureId) => ReactElement;
}) {
  return (
    <ul className={nested ? 'mt-2 space-y-1.5 border-l-2 border-slate-200 pl-4' : 'space-y-2.5'}>
      {items.map((item, index) => {
        // The answer is shown beside the rule unless the text already carries it.
        const inline = [...tokensIn(item.title), ...tokensIn(item.text)];
        const team = item.q && !inline.includes(item.q) ? teamAnswer(answers, item.q, locale) : null;
        const heading = item.marker === '' && !item.text;
        const drawings = draw && item.place ? (FIGURE_PLACES[item.place] ?? []) : [];
        return (
          <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-slate-700">
            {item.marker !== '' && <span className="w-5 shrink-0 font-mono text-xs leading-6 text-slate-400">{item.marker ?? '•'}</span>}
            <div className="min-w-0 flex-1">
              {item.title && (
                <strong className={`font-semibold text-slate-900 ${heading ? 'text-[0.9375rem]' : ''}`}>
                  <Filled text={item.title} answers={answers} t={t} locale={locale} />
                  {item.text && !/[.:?!]$/.test(item.title) && '.'}
                </strong>
              )}
              {item.title && item.text && ' '}
              {item.text && <Filled text={item.text} answers={answers} t={t} locale={locale} />}
              {item.link && (
                <>
                  {' '}
                  <External link={item.link} t={t} />
                </>
              )}
              {team && (
                <span className="ml-2 inline-block max-w-full rounded-xl bg-blue-50 px-2 py-0.5 align-middle text-xs font-medium break-words text-blue-800 ring-1 ring-inset ring-blue-600/20">
                  <span className="font-normal text-blue-700">{`${t('um.gl.yours')}: `}</span>
                  {team}
                </span>
              )}
              {item.children && <Items items={item.children} answers={answers} nested t={t} locale={locale} />}
              {drawings.length > 0 && <div className="mt-3 mb-2 space-y-3">{drawings.map((id) => draw?.(id))}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Topic({ sub, answers, t, locale }: { sub: GuideSub; answers: Record<string, Answer>; t: Translate; locale: Locale }) {
  const team = useCallback((qid: string) => teamAnswer(answers, qid, locale), [answers, locale]);
  const stored = useCallback((qid: string) => teamAnswer(answers, qid), [answers]);
  const draw = (id: FigureId) => <Figure key={id} id={id} team={team} stored={stored} locale={locale} />;
  const topicDrawings = FIGURE_PLACES[sub.num] ?? [];
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <header className="flex items-baseline gap-3">
        <span className="font-mono text-sm font-semibold text-blue-700">{sub.num}</span>
        <h4 className="text-base font-semibold text-slate-900">{sub.title}</h4>
      </header>
      {(sub.intro || sub.link) && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          {sub.intro && <Filled text={sub.intro} answers={answers} t={t} locale={locale} />}
          {sub.link && (
            <>
              {' '}
              <External link={sub.link} t={t} />
            </>
          )}
        </p>
      )}
      {topicDrawings.length > 0 && <div className="mt-4 space-y-3">{topicDrawings.map(draw)}</div>}
      {sub.items.length > 0 && (
        <div className="mt-4">
          <Items items={sub.items} answers={answers} t={t} locale={locale} draw={draw} />
        </div>
      )}
    </article>
  );
}

function Area({ section, answers, t, locale }: { section: GuideSection; answers: Record<string, Answer>; t: Translate; locale: Locale }) {
  const rules = section.subs.reduce((n, sub) => n + countRules(sub.items), 0);
  return (
    <section id={anchor(section.id)} aria-labelledby={`${anchor(section.id)}-title`} className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
          <Icon name={section.icon} />
        </span>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('um.gl.area', { num: section.num })}</p>
          <h3 id={`${anchor(section.id)}-title`} className="text-xl font-semibold tracking-tight text-slate-900">
            {section.title}
          </h3>
        </div>
        <span className="ml-auto text-xs text-slate-500">{t('um.gl.rules', { count: rules })}</span>
      </div>
      {section.subs.map((sub) => (
        <Topic key={sub.num} sub={sub} answers={answers} t={t} locale={locale} />
      ))}
    </section>
  );
}


/** The fourth tab: the Power BI guidelines, with the organization's own conventions filled in. */
export function GuidelinesPage() {
  const { t, locale } = useI18n();
  const { isAppAdmin } = useUm();
  const { conventions, loaded } = useConventions();
  const answers = conventions.answers;
  const [query, setQuery] = useState('');

  const guide = sectionsFor(locale);
  const totals = useMemo(() => ({ areas: guide.length, topics: guide.reduce((n, s) => n + s.subs.length, 0), rules: guide.reduce((n, s) => n + rulesIn(s), 0) }), [guide]);
  const sections = useMemo(() => searchGuide(guide, query, answers, locale), [guide, query, answers, locale]);
  const progress = useMemo(() => progressOf(answers, locale), [answers, locale]);
  const groups = useMemo(() => answeredGroups(answers, locale), [answers, locale]);
  const searching = query.trim() !== '';
  const found = sections.reduce((n, s) => n + s.subs.length, 0);
  const savedAt = conventions.updatedAt ? new Date(conventions.updatedAt).toLocaleDateString(locale, { dateStyle: 'medium' }) : '';

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-6 text-white shadow-sm sm:p-8">
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{t('um.gl.kicker')}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">{t('um.gl.title')}</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/90">{t('um.gl.tagline')}</p>
            <dl className="mt-6 grid max-w-md grid-cols-3 gap-3">
              {(['areas', 'topics', 'rules'] as const).map((key) => (
                <div key={key} className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/20">
                  <dd className="text-2xl font-semibold tabular-nums">{totals[key]}</dd>
                  <dt className="text-xs text-white/80">{t(`um.gl.stat.${key}`)}</dt>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/80">{t('um.gl.rulesPerArea')}</p>
            <MeterList onDark rows={guide.map((s) => ({ name: `${s.num} ${s.title}`, value: rulesIn(s), text: String(rulesIn(s)) }))} />
          </div>
        </div>
      </section>

      {loaded && (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6" aria-label={t(progress.answered > 0 ? 'um.gl.tailored.title' : 'um.gl.standard.title')}>
          {progress.answered > 0 ? (
            <div className="grid items-center gap-6 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,20rem)]">
              <ProgressRing answered={progress.answered} total={progress.total} label={t('um.glq.ring', { answered: progress.answered, total: progress.total })} />
              <div>
                <h3 className="text-base font-semibold text-slate-900">{t('um.gl.tailored.title')}</h3>
                <p className="mt-1 text-sm text-slate-600">{t('um.gl.tailored.text', { answered: progress.answered, total: progress.total })}</p>
                {conventions.updatedBy && savedAt && <p className="mt-1 text-xs text-slate-500">{t('um.gl.tailored.saved', { by: conventions.updatedBy, at: savedAt })}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => jumpTo('conventions')} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    {t('um.gl.conventions.nav')}
                  </button>
                  {isAppAdmin && (
                    <Link to={UM_PATHS.guidelinesSetup} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                      {t('um.gl.edit')}
                    </Link>
                  )}
                </div>
              </div>
              <MeterList rows={progress.byCategory.map((c) => ({ name: c.label, value: c.answered, of: c.total, text: `${c.answered} / ${c.total}` }))} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{t('um.gl.standard.title')}</h3>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  {t('um.gl.standard.text')}
                  {isAppAdmin && ` ${t('um.gl.standard.admin')}`}
                </p>
              </div>
              {isAppAdmin && (
                <Link to={UM_PATHS.guidelinesSetup} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                  {t('um.gl.tailor')}
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 p-2 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        <nav aria-label={t('um.gl.contents')} className="flex flex-wrap gap-1">
          {guide.map((s) => (
            <button key={s.id} type="button" onClick={() => jumpTo(s.id)} className="rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              <span className="mr-1.5 font-mono text-xs font-semibold text-blue-700">{s.num}</span>
              {s.title}
            </button>
          ))}
        </nav>
        <div className="ml-auto min-w-36 flex-1 sm:max-w-52">
          <label className="sr-only" htmlFor="um-guidelines-search">
            {t('um.gl.search.label')}
          </label>
          <input
            id="um-guidelines-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('um.gl.search.placeholder')}
            className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800"
          />
        </div>
      </div>

      {searching && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600" role="status">
          {found > 0 ? t('um.gl.search.count', { count: found }) : t('um.gl.search.none')}
          <button type="button" onClick={() => setQuery('')} className="text-blue-700 underline underline-offset-2">
            {t('um.gl.search.clear')}
          </button>
        </div>
      )}

      {sections.map((section) => (
        <Area key={section.id} section={section} answers={answers} t={t} locale={locale} />
      ))}

      {!searching && groups.length > 0 && (
        <section id={anchor('conventions')} aria-labelledby="guideline-conventions-title" className="scroll-mt-24 space-y-4">
          <div>
            <h3 id="guideline-conventions-title" className="text-xl font-semibold tracking-tight text-slate-900">
              {t('um.gl.conventions.title')}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('um.gl.conventions.intro')}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <div key={group.category} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h4 className="text-sm font-semibold text-blue-700">{group.category}</h4>
                <dl className="mt-2 divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <div key={item.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 py-1.5 text-sm">
                      <dt className="text-slate-500">{item.label}</dt>
                      <dd className="break-words font-medium text-slate-900">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-slate-200 pt-6">
        <p className="text-base font-medium text-slate-800">{t('um.gl.closing')}</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t('um.gl.sources')}</p>
      </footer>
    </div>
  );
}
