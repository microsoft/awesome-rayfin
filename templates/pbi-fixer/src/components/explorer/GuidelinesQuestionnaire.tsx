// Interactive "Customize these guidelines for your team" questionnaire shown at
// the top of the Guidelines tab. 50 optional questions (single-choice,
// multi-select, free text). The user can finish at any time; answers are saved
// to localStorage and surfaced as a "Your team's conventions" summary that
// refines the standard guidelines below.

import { useEffect, useMemo, useState } from 'react';
import {
  makeStyles,
  shorthands,
  tokens,
  Button,
  RadioGroup,
  Radio,
  Checkbox,
  Input,
  Textarea,
  ProgressBar,
  Body1,
  Body1Strong,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import {
  Sparkle20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
  ArrowLeft16Regular,
  ArrowRight16Regular,
  Checkmark16Regular,
  Copy16Regular,
  ArrowResetRegular,
  Edit16Regular,
} from '@fluentui/react-icons';
import {
  GUIDELINE_QUESTIONS,
  QUESTION_CATEGORIES,
  formatAnswerValue,
  type Answer,
} from './guidelinesQuestions';

const STORAGE_KEY = 'pbi-fixer:guidelines-answers:v1';

interface Store {
  answers: Record<string, Answer>;
  completed: boolean;
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      return { answers: parsed.answers ?? {}, completed: Boolean(parsed.completed) };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { answers: {}, completed: false };
}

const useStyles = makeStyles({
  panel: {
    ...shorthands.borderRadius('12px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '12px',
    width: '100%',
    ...shorthands.padding('14px', '18px'),
    ...shorthands.border('none'),
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    ':hover': { backgroundColor: tokens.colorNeutralBackground2Hover },
  },
  headerIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    flexShrink: 0,
    ...shorthands.borderRadius('8px'),
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '2px',
    flexGrow: 1,
    minWidth: 0,
  },
  chevron: {
    display: 'flex',
    alignItems: 'center',
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  body: {
    ...shorthands.padding('0', '18px', '18px', '18px'),
    display: 'flex',
    flexDirection: 'column',
    rowGap: '14px',
  },
  intro: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '10px',
  },
  introActions: {
    display: 'flex',
    columnGap: '8px',
  },
  progressRow: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '6px',
  },
  progressMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    color: tokens.colorNeutralForeground3,
  },
  questionCard: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '10px',
    ...shorthands.padding('16px'),
    ...shorthands.borderRadius('10px'),
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  category: {
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: tokens.colorBrandForeground1,
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '2px',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    columnGap: '8px',
    flexWrap: 'wrap',
  },
  navSpacer: { flexGrow: 1 },
  summary: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '14px',
  },
  summaryActions: {
    display: 'flex',
    columnGap: '8px',
    flexWrap: 'wrap',
  },
  summaryGroup: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '6px',
  },
  summaryGroupTitle: {
    color: tokens.colorBrandForeground1,
  },
  summaryItem: {
    display: 'flex',
    columnGap: '8px',
    ...shorthands.padding('6px', '10px'),
    ...shorthands.borderRadius('6px'),
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderLeft('3px', 'solid', tokens.colorBrandStroke1),
  },
  summaryLabel: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground2,
    minWidth: '180px',
  },
  emptyNote: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
  },
});

export function GuidelinesQuestionnaire() {
  const styles = useStyles();
  const [store, setStore] = useState<Store>(loadStore);
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  const total = GUIDELINE_QUESTIONS.length;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [store]);

  const answeredCount = useMemo(
    () =>
      GUIDELINE_QUESTIONS.reduce(
        (n, q) => (formatAnswerValue(q, store.answers[q.id]) !== null ? n + 1 : n),
        0,
      ),
    [store.answers],
  );

  const setAnswer = (id: string, patch: Partial<Answer>) =>
    setStore((s) => ({
      ...s,
      answers: { ...s.answers, [id]: { ...s.answers[id], ...patch } },
    }));

  const finish = () => {
    setStore((s) => ({ ...s, completed: true }));
    setExpanded(false);
  };

  const startOrEdit = () => {
    setExpanded(true);
    // resume at the first unanswered question
    const next = GUIDELINE_QUESTIONS.findIndex(
      (q) => formatAnswerValue(q, store.answers[q.id]) === null,
    );
    setIndex(next === -1 ? 0 : next);
  };

  const clearAll = () => {
    setStore({ answers: {}, completed: false });
    setIndex(0);
    setExpanded(false);
  };

  const copySummary = async () => {
    const lines: string[] = ['Power BI Guidelines — Team Conventions', ''];
    for (const cat of QUESTION_CATEGORIES) {
      const inCat = GUIDELINE_QUESTIONS.filter(
        (q) => q.category === cat && formatAnswerValue(q, store.answers[q.id]) !== null,
      );
      if (inCat.length === 0) continue;
      lines.push(cat.toUpperCase());
      for (const q of inCat) {
        lines.push(`- ${q.label}: ${formatAnswerValue(q, store.answers[q.id])}`);
      }
      lines.push('');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n').trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard not available */
    }
  };

  const q = GUIDELINE_QUESTIONS[index];
  const a = store.answers[q.id];
  const isLast = index === total - 1;

  const renderControl = () => {
    if (q.type === 'text') {
      return (
        <Textarea
          value={a?.text ?? ''}
          placeholder={q.placeholder}
          resize="vertical"
          onChange={(_, d) => setAnswer(q.id, { text: d.value })}
        />
      );
    }

    if (q.type === 'multi') {
      const selected = new Set(a?.choices ?? []);
      return (
        <div className={styles.options}>
          {q.options?.map((opt) => (
            <Checkbox
              key={opt}
              label={opt}
              checked={selected.has(opt)}
              onChange={(_, d) => {
                const next = new Set(selected);
                if (d.checked) next.add(opt);
                else next.delete(opt);
                setAnswer(q.id, { choices: [...next] });
              }}
            />
          ))}
          {q.allowOther && (
            <Input
              placeholder="Other / notes…"
              value={a?.other ?? ''}
              onChange={(_, d) => setAnswer(q.id, { other: d.value })}
            />
          )}
        </div>
      );
    }

    // single
    return (
      <div className={styles.options}>
        <RadioGroup
          value={a?.choice ?? ''}
          onChange={(_, d) => setAnswer(q.id, { choice: d.value })}
        >
          {q.options?.map((opt) => (
            <Radio key={opt} value={opt} label={opt} />
          ))}
        </RadioGroup>
        {q.allowOther && (
          <Input
            placeholder={q.placeholder ?? 'Other / notes…'}
            value={a?.other ?? ''}
            onChange={(_, d) => setAnswer(q.id, { other: d.value })}
          />
        )}
      </div>
    );
  };

  const renderSummary = () => {
    const groups = QUESTION_CATEGORIES.map((cat) => ({
      cat,
      items: GUIDELINE_QUESTIONS.filter(
        (gq) => gq.category === cat && formatAnswerValue(gq, store.answers[gq.id]) !== null,
      ),
    })).filter((g) => g.items.length > 0);

    return (
      <div className={styles.summary}>
        <Body1>
          These are your team's conventions. They refine the standard guidelines below — where
          your answer differs from the default, treat your convention as the rule for your
          organization.
        </Body1>
        {groups.length === 0 ? (
          <Body1 className={styles.emptyNote}>No answers captured yet.</Body1>
        ) : (
          groups.map((g) => (
            <div key={g.cat} className={styles.summaryGroup}>
              <Subtitle2 className={styles.summaryGroupTitle}>{g.cat}</Subtitle2>
              {g.items.map((gq) => (
                <div key={gq.id} className={styles.summaryItem}>
                  <Body1Strong className={styles.summaryLabel}>{gq.label}</Body1Strong>
                  <Body1>{formatAnswerValue(gq, store.answers[gq.id])}</Body1>
                </div>
              ))}
            </div>
          ))
        )}
        <div className={styles.summaryActions}>
          <Button appearance="primary" icon={<Edit16Regular />} onClick={startOrEdit}>
            Edit answers
          </Button>
          <Button
            icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
            onClick={copySummary}
          >
            {copied ? 'Copied!' : 'Copy summary'}
          </Button>
          <Button appearance="subtle" icon={<ArrowResetRegular />} onClick={clearAll}>
            Clear all
          </Button>
        </div>
      </div>
    );
  };

  const renderWizard = () => (
    <>
      <div className={styles.progressRow}>
        <ProgressBar value={(index + 1) / total} thickness="large" />
        <div className={styles.progressMeta}>
          <Caption1>
            Question {index + 1} of {total}
          </Caption1>
          <Caption1>{answeredCount} answered</Caption1>
        </div>
      </div>

      <div className={styles.questionCard}>
        <Caption1 className={styles.category}>{q.category}</Caption1>
        <Body1Strong>{q.question}</Body1Strong>
        {q.help && <Caption1>{q.help}</Caption1>}
        {renderControl()}
      </div>

      <div className={styles.nav}>
        <Button
          icon={<ArrowLeft16Regular />}
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          Back
        </Button>
        <Button appearance="subtle" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>
          Skip
        </Button>
        <div className={styles.navSpacer} />
        <Button appearance="subtle" icon={<Checkmark16Regular />} onClick={finish}>
          Finish now
        </Button>
        {isLast ? (
          <Button appearance="primary" icon={<Checkmark16Regular />} onClick={finish}>
            Done
          </Button>
        ) : (
          <Button
            appearance="primary"
            iconPosition="after"
            icon={<ArrowRight16Regular />}
            onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          >
            Next
          </Button>
        )}
      </div>
    </>
  );

  const renderCollapsedBody = () => {
    if (answeredCount > 0) return renderSummary();
    return (
      <div className={styles.intro}>
        <Body1>
          Answer up to {total} optional questions — naming conventions, Dim/Fact prefixes, empty
          measure tables, fiscal-year start and more — to tailor these guidelines to your team.
          Every question is optional and you can finish at any time.
        </Body1>
        <div className={styles.introActions}>
          <Button appearance="primary" icon={<Sparkle20Regular />} onClick={startOrEdit}>
            Start questionnaire
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.panel}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className={styles.headerIcon}>
          <Sparkle20Regular />
        </span>
        <span className={styles.headerText}>
          <Body1Strong>Customize these guidelines for your team</Body1Strong>
          <Caption1>
            {answeredCount > 0
              ? `${answeredCount} of ${total} answered${store.completed ? ' · completed' : ''}`
              : 'Optional · finish anytime'}
          </Caption1>
        </span>
        <span className={styles.chevron}>
          {expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        </span>
      </button>

      <div className={styles.body}>{expanded ? renderWizard() : renderCollapsedBody()}</div>
    </div>
  );
}
