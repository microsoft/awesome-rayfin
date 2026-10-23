/**
 * The drawings of the guidelines page.
 *
 * Hand-built SVG and plain markup, no chart library: the app is meant to be
 * self-hosted and audited, and these drawings follow the very rules they
 * illustrate (horizontal for structure, vertical for time, solid for actual,
 * lighter for previous year, outlined for plan, red and green only for
 * deviations). Color is never the only signal: every verdict carries text.
 *
 * All numbers are made up. They are in the style of a higher-education
 * report (students by subject group and winter semester).
 *
 * The words are written here in English and looked up in `figures.de.ts`
 * for German; numbers follow the language too.
 */
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { FIGURES_DE } from './figures.de';

const INK = '#1e293b';
const SOFT = '#a9b5c6';
const GRID = '#e2e8f0';
const MUTED = '#64748b';
const GOOD = '#15803d';
const BAD = '#FF0000';
const FONT = { fontFamily: '"Segoe UI", system-ui, sans-serif' };

type Pair = readonly [string, number];

const SUBJECTS: readonly Pair[] = [
  ['Law, Economics, Social Sciences', 12.4],
  ['Engineering', 9.8],
  ['Mathematics, Natural Sciences', 6.1],
  ['Humanities', 4.3],
  ['Medicine, Health', 3.2],
  ['Other', 1.9],
];

const SEMESTERS: readonly Pair[] = [
  ['19/20', 34.1],
  ['20/21', 35.6],
  ['21/22', 36.2],
  ['22/23', 36.0],
  ['23/24', 36.9],
  ['24/25', 37.7],
];

/** Winter semester, actual, previous year, plan. */
const SCENARIOS: readonly (readonly [string, number, number, number])[] = [
  ['21/22', 36.2, 35.6, 36.0],
  ['22/23', 36.0, 36.2, 36.8],
  ['23/24', 36.9, 36.0, 36.5],
  ['24/25', 37.7, 36.9, 37.2],
];

const DEVIATIONS: readonly Pair[] = [
  ['Medicine, Health', 4.1],
  ['Law, Economics, Social Sciences', 3.4],
  ['Engineering', 1.2],
  ['Mathematics, Natural Sciences', -0.8],
  ['Other', -1.5],
  ['Humanities', -2.6],
];

/** The words and number format of the drawings in one language. */
interface Words {
  l: (en: string) => string;
  n: (value: number) => string;
  de: boolean;
}

const EN_WORDS: Words = { l: (en) => en, n: (value) => value.toFixed(1), de: false };
const DE_WORDS: Words = { l: (en) => FIGURES_DE[en] ?? en, n: (value) => value.toFixed(1).replace('.', ','), de: true };
const WordsContext = createContext<Words>(EN_WORDS);
const useWords = () => useContext(WordsContext);

const signed = (v: number, n: (value: number) => string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

function Frame({ title, caption, children }: { title: string; caption?: string; children: ReactNode }) {
  const { l } = useWords();
  return (
    <figure className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <figcaption className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{l(title)}</figcaption>
      {children}
      {caption && <p className="mt-3 text-xs leading-relaxed text-slate-500">{l(caption)}</p>}
    </figure>
  );
}

type Advice = 'do' | 'maybe' | 'avoid';

const ADVICE: Record<Advice, { tone: string; sign: string }> = {
  do: { tone: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30', sign: '✓' },
  maybe: { tone: 'bg-amber-50 text-amber-900 ring-amber-600/30', sign: '~' },
  avoid: { tone: 'bg-white text-[#FF0000] ring-[#FF0000]', sign: '✕' },
};

function Verdict({ good, advice, children }: { good?: boolean; advice?: Advice; children: ReactNode }) {
  const { tone, sign } = ADVICE[advice ?? (good ? 'do' : 'avoid')];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone}`}>
      <span aria-hidden="true">{sign}</span>
      {children}
    </span>
  );
}

function Panel({ verdict, good, title, children }: { verdict?: string; good?: boolean; title?: string; children: ReactNode }) {
  const { l } = useWords();
  return (
    <div className="flex flex-col rounded-lg bg-white p-3 ring-1 ring-slate-200">
      {(verdict || title) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {verdict && <Verdict good={!!good}>{l(verdict)}</Verdict>}
          {title && <span className="text-xs font-medium text-slate-700">{l(title)}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const pair = 'grid gap-3 sm:grid-cols-2';

// ---------------------------------------------------------------------------
// Chart pieces
// ---------------------------------------------------------------------------

function HBars({ rows, label }: { rows: readonly Pair[]; label: string }) {
  const { l, n } = useWords();
  const max = Math.max(...rows.map((r) => r[1]));
  const rowH = 24;
  const labelW = 178;
  const barW = 140;
  const height = rows.length * rowH + 4;
  return (
    <svg viewBox={`0 0 370 ${height}`} className="h-auto w-full" role="img" aria-label={l(label)} style={FONT}>
      {rows.map(([name, value], i) => (
        <g key={name} transform={`translate(0 ${i * rowH + 2})`}>
          <text x={labelW - 8} y={15} textAnchor="end" fontSize={11} fill={INK}>
            {l(name)}
          </text>
          <rect x={labelW} y={4} width={(value / max) * barW} height={14} fill={INK} />
          <text x={labelW + (value / max) * barW + 6} y={15} fontSize={11} fill={INK}>
            {n(value)}
          </text>
        </g>
      ))}
      <line x1={labelW} y1={0} x2={labelW} y2={height} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function VCols({ rows, label, highlightLast }: { rows: readonly Pair[]; label: string; highlightLast?: boolean }) {
  const { l, n } = useWords();
  const max = Math.max(...rows.map((r) => r[1]));
  const base = 132;
  const top = 22;
  const step = 370 / rows.length;
  const colW = Math.min(36, step * 0.6);
  return (
    <svg viewBox="0 0 370 156" className="h-auto w-full" role="img" aria-label={l(label)} style={FONT}>
      {rows.map(([name, value], i) => {
        const h = (value / max) * (base - top);
        const x = i * step + (step - colW) / 2;
        const last = highlightLast && i === rows.length - 1;
        return (
          <g key={name}>
            <rect x={x} y={base - h} width={colW} height={h} fill={last || !highlightLast ? INK : SOFT} />
            <text x={x + colW / 2} y={base - h - 5} textAnchor="middle" fontSize={11} fill={INK} fontWeight={last ? 600 : 400}>
              {n(value)}
            </text>
            <text x={x + colW / 2} y={base + 15} textAnchor="middle" fontSize={11} fill={MUTED}>
              {name}
            </text>
          </g>
        );
      })}
      <line x1={0} y1={base} x2={370} y2={base} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function Sparkline({ values, width = 120, height = 32 }: { values: readonly number[]; width?: number; height?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={INK} strokeWidth={1.5} />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} fill={INK} />
    </svg>
  );
}

function Pie({ rows, label }: { rows: readonly Pair[]; label: string }) {
  const { l } = useWords();
  const total = rows.reduce((n, r) => n + r[1], 0);
  const shades = ['#1e293b', '#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0'];
  const r = 56;
  const cx = 64;
  const cy = 64;
  const slices = rows.reduce<{ name: string; d: string; fill: string }[]>((acc, [name, value], i) => {
    const start = rows.slice(0, i).reduce((n, row) => n + row[1], 0) / total;
    const end = start + value / total;
    const point = (f: number) => `${cx + r * Math.sin(2 * Math.PI * f)} ${cy - r * Math.cos(2 * Math.PI * f)}`;
    acc.push({ name, fill: shades[i % shades.length], d: `M ${cx} ${cy} L ${point(start)} A ${r} ${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)} Z` });
    return acc;
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <svg viewBox="0 0 128 128" className="h-28 w-28 shrink-0" role="img" aria-label={l(label)}>
        {slices.map((s) => (
          <path key={s.name} d={s.d} fill={s.fill} stroke="#fff" strokeWidth={1} />
        ))}
      </svg>
      <ul className="space-y-0.5 text-[11px] text-slate-600">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-slate-300" style={{ background: s.fill }} aria-hidden="true" />
            {l(s.name)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

function Dots({ value, label }: { value: 1 | 2 | 3; label: string }) {
  const { l, de } = useWords();
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={`${l(label)}: ${value} ${de ? 'von' : 'of'} 3`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`inline-block h-2.5 w-2.5 rounded-full ${n <= value ? 'bg-slate-800' : 'bg-slate-200'}`} />
      ))}
    </span>
  );
}

function StorageModes() {
  const { l } = useWords();
  const criteria = ['Freshness of data', 'Query speed', 'Modeling features', 'Ease of setup'];
  const modes: { name: string; advice: Advice; verdict: string; note: string; scores: (1 | 2 | 3)[] }[] = [
    { name: 'Import', advice: 'do', verdict: 'The default', note: 'A copy in memory, as fresh as the last refresh. Start here.', scores: [1, 3, 3, 3] },
    { name: 'Direct Lake', advice: 'maybe', verdict: 'If needed', note: 'For very large data, or data that must be fresher than a refresh allows. Reads Delta tables in OneLake.', scores: [3, 3, 2, 2] },
    { name: 'Direct Query', advice: 'avoid', verdict: 'Almost never', note: 'Every visual waits for the source. Only when data cannot be copied or must be live to the second.', scores: [3, 1, 2, 2] },
  ];
  return (
    <Frame title="Three ways to connect" caption="Import first. Direct Lake when Import cannot do the job. Direct Query almost never. The dots are a rough orientation, not a benchmark; more dots are better.">
      <div className="grid gap-3 sm:grid-cols-3">
        {modes.map((mode) => (
          <Panel key={mode.name}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">{mode.name}</p>
              <Verdict advice={mode.advice}>{l(mode.verdict)}</Verdict>
            </div>
            <p className="mt-1 min-h-16 text-xs text-slate-500">{l(mode.note)}</p>
            <ul className="mt-2 space-y-1.5">
              {criteria.map((criterion, i) => (
                <li key={criterion} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                  {l(criterion)}
                  <Dots value={mode.scores[i]} label={criterion} />
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </Frame>
  );
}

function Cardinality() {
  const { l, de } = useWords();
  const rows: { name: string; value: number }[] = [
    { name: 'One DateTime column', value: 31_536_000 },
    { name: 'Split: time column', value: 86_400 },
    { name: 'Split: date column', value: 365 },
  ];
  const scale = (v: number) => (Math.log10(v) / 8) * 200;
  return (
    <Frame title="Why date and time are split" caption="Distinct values for one year of timestamps to the second. Logarithmic scale. Fewer distinct values compress better.">
      <svg viewBox="0 0 470 84" className="h-auto w-full max-w-xl" role="img" aria-label={l('Distinct values: one DateTime column 31,536,000; split into a time column 86,400 and a date column 365')} style={FONT}>
        {rows.map((row, i) => (
          <g key={row.name} transform={`translate(0 ${i * 28})`}>
            <text x={142} y={17} textAnchor="end" fontSize={12} fill={INK}>
              {l(row.name)}
            </text>
            <rect x={150} y={5} width={scale(row.value)} height={16} fill={INK} />
            <text x={150 + scale(row.value) + 8} y={17} fontSize={12} fill={INK} fontWeight={600}>
              {row.value.toLocaleString(de ? 'de-DE' : 'en-US')}
            </text>
          </g>
        ))}
        <line x1={150} y1={0} x2={150} y2={84} stroke={INK} strokeWidth={1} />
      </svg>
    </Frame>
  );
}

function Box({ x, y, w = 62, h = 24, label, fact }: { x: number; y: number; w?: number; h?: number; label: string; fact?: boolean }) {
  const { l } = useWords();
  return (
    <g>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={4} fill={fact ? INK : '#fff'} stroke={INK} strokeWidth={1.2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fill={fact ? '#fff' : INK} fontWeight={fact ? 600 : 400}>
        {l(label)}
      </text>
    </g>
  );
}

function Link({ a, b }: { a: readonly [number, number]; b: readonly [number, number] }) {
  return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={MUTED} strokeWidth={1.2} />;
}

function SchemaShapes() {
  const { l } = useWords();
  const c = [110, 75] as const;
  const dims: readonly (readonly [string, number, number])[] = [
    ['Date', 40, 22],
    ['Subject', 180, 22],
    ['University', 40, 128],
    ['Student', 180, 128],
  ];
  return (
    <Frame title="Shapes of a model" caption="One fact table in the middle, one step to every dimension: fewer joins, simpler DAX, better compression.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel verdict="Do" good title="Star schema">
          <svg viewBox="0 0 220 150" className="h-auto w-full" role="img" aria-label={l('Star schema: a fact table linked directly to four dimensions')} style={FONT}>
            {dims.map(([name, x, y]) => (
              <Link key={name} a={c} b={[x, y]} />
            ))}
            {dims.map(([name, x, y]) => (
              <Box key={name} x={x} y={y} label={name} />
            ))}
            <Box x={c[0]} y={c[1]} label="Students" fact w={78} h={28} />
          </svg>
        </Panel>
        <Panel verdict="Avoid where possible" title="Snowflake">
          <svg viewBox="0 0 220 150" className="h-auto w-full" role="img" aria-label={l('Snowflake schema: dimensions that hang off other dimensions')} style={FONT}>
            <Link a={c} b={[52, 75]} />
            <Link a={c} b={[168, 75]} />
            <Link a={[52, 75]} b={[40, 22]} />
            <Link a={[168, 75]} b={[180, 22]} />
            <Link a={[168, 75]} b={[180, 128]} />
            <Link a={[40, 22]} b={[110, 22]} />
            <Box x={40} y={22} label="State" w={70} />
            <Box x={110} y={22} label="Country" w={56} />
            <Box x={180} y={22} label="Group" />
            <Box x={180} y={128} label="Faculty" />
            <Box x={36} y={75} label="Univ." w={50} />
            <Box x={182} y={75} label="Subject" w={54} />
            <Box x={c[0]} y={c[1]} label="Students" fact w={74} h={28} />
          </svg>
        </Panel>
        <Panel verdict="Avoid" title="One flat table">
          <svg viewBox="0 0 220 150" className="h-auto w-full" role="img" aria-label={l('Flat table: every attribute repeated in one wide table')} style={FONT}>
            <rect x={14} y={30} width={192} height={92} rx={4} fill="#fff" stroke={INK} strokeWidth={1.2} />
            <rect x={14} y={30} width={192} height={18} rx={4} fill={INK} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <line key={i} x1={38 + i * 24} y1={30} x2={38 + i * 24} y2={122} stroke={i === 0 ? '#fff' : GRID} strokeWidth={1} />
            ))}
            {[0, 1, 2, 3].map((i) => (
              <line key={i} x1={14} y1={66 + i * 18} x2={206} y2={66 + i * 18} stroke={GRID} strokeWidth={1} />
            ))}
            <text x={110} y={140} textAnchor="middle" fontSize={10.5} fill={MUTED}>
              {l('facts and attributes in every row')}
            </text>
          </svg>
        </Panel>
      </div>
    </Frame>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">{children}</pre>;
}

function DaxDivide() {
  return (
    <Frame title="Division in DAX" caption="DIVIDE handles a zero or blank denominator itself. It returns blank, or the alternative you name as third argument.">
      <div className={pair}>
        <Panel verdict="Avoid">
          <Code>{'Success Rate =\nIFERROR ( [Passed Exams] / [Exams], 0 )'}</Code>
        </Panel>
        <Panel verdict="Do" good>
          <Code>{'Success Rate =\nDIVIDE ( [Passed Exams], [Exams], 0 )'}</Code>
        </Panel>
      </div>
    </Frame>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
      <path d="M1.5 4a1 1 0 0 1 1-1h3l1.5 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#f1c453" stroke="#b68a17" strokeWidth={0.8} />
    </svg>
  );
}

/** One line of a field list. Names of model objects are not translated. */
function FieldRow({ kind, name, level = 0 }: { kind: 'table' | 'folder' | 'measure' | 'column'; name: string; level?: number }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-slate-700" style={{ paddingLeft: level * 14 }}>
      {kind === 'folder' ? (
        <FolderIcon />
      ) : (
        <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${kind === 'table' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-300'}`} aria-hidden="true">
          {kind === 'table' ? 'T' : kind === 'measure' ? '∑' : 'c'}
        </span>
      )}
      <span className={kind === 'table' ? 'font-semibold text-slate-900' : ''}>{name}</span>
    </li>
  );
}

function MeasureFolders({ team }: FigureProps) {
  const table = team('measure-table-name') ?? 'Measure';
  return (
    <Frame title="Where measures live" caption="One measure table on top of the field list, display folders by topic, related measures named alike.">
      <div className={pair}>
        <Panel verdict="Avoid" title="Scattered over fact tables">
          <ul className="space-y-1">
            <FieldRow kind="table" name="Exams" />
            <FieldRow kind="measure" name="Passed" level={1} />
            <FieldRow kind="column" name="ExamID" level={1} />
            <FieldRow kind="table" name="Students" />
            <FieldRow kind="measure" name="Count of Students" level={1} />
            <FieldRow kind="measure" name="Stud PY" level={1} />
            <FieldRow kind="column" name="StudentID" level={1} />
          </ul>
        </Panel>
        <Panel verdict="Do" good title="One container, folders by topic">
          <ul className="space-y-1">
            <FieldRow kind="table" name={table} />
            <FieldRow kind="folder" name="Exams" level={1} />
            <FieldRow kind="measure" name="Passed Exams" level={2} />
            <FieldRow kind="measure" name="Success Rate" level={2} />
            <FieldRow kind="folder" name="Students" level={1} />
            <FieldRow kind="measure" name="Students" level={2} />
            <FieldRow kind="measure" name="Students PY" level={2} />
            <FieldRow kind="measure" name={'Students ΔPY %'} level={2} />
          </ul>
        </Panel>
      </div>
    </Frame>
  );
}

function Wire({ children, label }: { children: ReactNode; label: string }) {
  const { l } = useWords();
  return (
    <svg viewBox="0 0 160 90" className="h-auto w-full rounded-md ring-1 ring-slate-300" role="img" aria-label={l(label)}>
      <rect width={160} height={90} fill="#fff" />
      <rect x={8} y={7} width={46} height={4} fill={INK} />
      <rect x={8} y={14} width={30} height={3} fill={SOFT} />
      {children}
    </svg>
  );
}

function ThreeLayers() {
  const { l } = useWords();
  const layers: { step: string; name: string; note: string; wire: ReactElement }[] = [
    {
      step: '1',
      name: 'Overview',
      note: 'All KPIs at a glance, with deviations.',
      wire: (
        <Wire label="Overview page: a row of KPI cards above a table">
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={8 + i * 37} y={24} width={32} height={20} rx={2} fill="#f1f5f9" stroke={GRID} />
              <rect x={12 + i * 37} y={29} width={16} height={5} fill={INK} />
              <rect x={12 + i * 37} y={37} width={10} height={2.5} fill={i === 2 ? BAD : GOOD} />
            </g>
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={8} y={51 + i * 7} width={144} height={3} fill={i === 0 ? SOFT : GRID} />
          ))}
        </Wire>
      ),
    },
    {
      step: '2',
      name: 'Analysis',
      note: 'One KPI or KPI group, visualized.',
      wire: (
        <Wire label="Analysis page: one large column chart with a small side chart">
          {[30, 38, 34, 44, 40, 50, 46, 56].map((h, i) => (
            <rect key={i} x={10 + i * 12} y={80 - h} width={8} height={h} fill={i === 7 ? INK : SOFT} />
          ))}
          <line x1={8} y1={80} x2={106} y2={80} stroke={INK} strokeWidth={0.8} />
          {[26, 20, 14, 9].map((w, i) => (
            <rect key={i} x={118} y={30 + i * 12} width={w} height={7} fill={INK} />
          ))}
          <line x1={118} y1={26} x2={118} y2={80} stroke={INK} strokeWidth={0.8} />
        </Wire>
      ),
    },
    {
      step: '3',
      name: 'Details',
      note: 'Tables or small multiples.',
      wire: (
        <Wire label="Details page: a dense table">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <g key={i}>
              <rect x={8} y={24 + i * 8} width={144} height={0.6} fill={GRID} />
              <rect x={8} y={27 + i * 8} width={34 - (i % 3) * 5} height={2.6} fill={i === 0 ? INK : SOFT} />
              <rect x={70} y={27 + i * 8} width={16} height={2.6} fill={i === 0 ? INK : SOFT} />
              <rect x={100} y={27 + i * 8} width={16} height={2.6} fill={i === 0 ? INK : SOFT} />
              <rect x={134} y={27 + i * 8} width={18} height={2.6} fill={i === 0 ? INK : i % 3 === 1 ? BAD : GOOD} />
            </g>
          ))}
        </Wire>
      ),
    },
  ];
  return (
    <Frame title="Three layers of a report" caption="From the big picture to the single row: each layer answers a different question, and navigation leads from one to the next.">
      <ol className="grid gap-3 sm:grid-cols-3">
        {layers.map((layer) => (
          <li key={layer.step} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
            {layer.wire}
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] text-white">{layer.step}</span>
              {l(layer.name)}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{l(layer.note)}</p>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function TitleConcept({ stored }: FigureProps) {
  const { l } = useWords();
  // The stored choice starts with the pixel size, in every language.
  const size = (stored('page-size') ?? '1920×1080').split(' ')[0];
  return (
    <Frame title="The three-line title" caption="Top left on every page: who, what, when. Built with measures, so it follows the filters.">
      <div className="relative mx-auto aspect-video w-full max-w-xl overflow-hidden rounded-lg bg-white p-4 ring-1 ring-slate-300">
        <span className="absolute right-3 top-3 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{size}</span>
        <div className="space-y-0.5 border-l-2 border-slate-800 pl-2.5">
          <p className="text-xs text-slate-700">
            {l('Beispiel-Universität, Faculty of Engineering')}
            <span className="ml-2 text-[10px] text-slate-400">{l('1 who')}</span>
          </p>
          <p className="text-xs text-slate-700">
            <strong className="font-semibold text-slate-900">{l('Students')}</strong>
            {l(' in thousand, actual')}
            <span className="ml-2 text-[10px] text-slate-400">{l('2 what')}</span>
          </p>
          <p className="text-xs text-slate-700">
            {l('Winter semesters 2019/20 to 2024/25')}
            <span className="ml-2 text-[10px] text-slate-400">{l('3 when')}</span>
          </p>
        </div>
        <div className="mt-3 max-w-sm">
          <VCols rows={SEMESTERS} label="Students per winter semester, in thousand" highlightLast />
        </div>
      </div>
    </Frame>
  );
}

function Orientation() {
  return (
    <Frame title="Structure lies, time stands" caption="Categories read like a list, from top to bottom. Time runs from left to right.">
      <div className={pair}>
        <Panel verdict="Do" good title="Structure: horizontal bars, sorted">
          <HBars rows={SUBJECTS} label="Students by subject group in thousand, horizontal bars sorted by size" />
        </Panel>
        <Panel verdict="Do" good title="Time: vertical columns">
          <VCols rows={SEMESTERS} label="Students per winter semester in thousand, vertical columns" />
        </Panel>
      </div>
    </Frame>
  );
}

function LegendKey({ kind, label }: { kind: 'ac' | 'py' | 'pl'; label: string }) {
  const { l } = useWords();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
        <rect x={1.5} y={1.5} width={11} height={11} fill={kind === 'ac' ? INK : kind === 'py' ? SOFT : '#fff'} stroke={kind === 'py' ? SOFT : INK} strokeWidth={1.5} />
      </svg>
      {l(label)}
    </span>
  );
}

function Scenarios() {
  const { l, n } = useWords();
  const base = 122;
  const top = 18;
  const min = 30;
  const max = 38;
  const h = (v: number) => ((v - min) / (max - min)) * (base - top);
  const step = 370 / SCENARIOS.length;
  const w = 20;
  return (
    <Frame title="One pattern per scenario" caption="The same fill always means the same thing, and the same order, on every page: outlined for plan, lighter for previous year, solid for actual.">
      <Panel>
        <svg viewBox="0 0 370 146" className="h-auto w-full max-w-md" role="img" aria-label={l('Students per winter semester: plan outlined, previous year in a lighter fill, actual solid')} style={FONT}>
          {SCENARIOS.map(([name, ac, py, pl], i) => {
            const x = i * step + (step - 3 * w - 8) / 2;
            return (
              <g key={name}>
                <rect x={x + 0.75} y={base - h(pl) + 0.75} width={w - 1.5} height={h(pl) - 0.75} fill="#fff" stroke={INK} strokeWidth={1.5} />
                <rect x={x + w + 4} y={base - h(py)} width={w} height={h(py)} fill={SOFT} />
                <rect x={x + 2 * w + 8} y={base - h(ac)} width={w} height={h(ac)} fill={INK} />
                <text x={x + 2 * w + 8 + w / 2} y={base - h(ac) - 5} textAnchor="middle" fontSize={11} fill={INK} fontWeight={600}>
                  {n(ac)}
                </text>
                <text x={x + (3 * w + 8) / 2} y={base + 15} textAnchor="middle" fontSize={11} fill={MUTED}>
                  {name}
                </text>
              </g>
            );
          })}
          <line x1={0} y1={base} x2={370} y2={base} stroke={INK} strokeWidth={1} />
        </svg>
        <div className="mt-1 flex flex-wrap gap-4">
          <LegendKey kind="pl" label="PL, plan" />
          <LegendKey kind="py" label="PY, previous year" />
          <LegendKey kind="ac" label="AC, actual" />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{l('Axis cut at 30 thousand to show the pattern. In a report, start bars at zero.')}</p>
      </Panel>
    </Frame>
  );
}

function Density() {
  return (
    <Frame title="Same numbers, more information" caption="A pie needs a legend and a guess at angles. Sorted bars carry label, value and rank in one line.">
      <div className={pair}>
        <Panel verdict="Avoid" title="Pie chart">
          <Pie rows={SUBJECTS} label="Students by subject group as a pie chart with a separate legend" />
        </Panel>
        <Panel verdict="Do" good title="Sorted bars with values">
          <HBars rows={SUBJECTS} label="Students by subject group in thousand as sorted bars" />
        </Panel>
      </div>
    </Frame>
  );
}

function KpiCard() {
  const { l } = useWords();
  const values = SEMESTERS.map((r) => r[1]);
  return (
    <Frame title="A number needs a reference" caption="The new card visual shows value, reference label and trend in one visual.">
      <div className={pair}>
        <Panel verdict="Avoid" title="Big number, no context">
          <p className="py-3 text-center text-4xl font-light text-slate-900">{l('37.7k')}</p>
          <p className="text-center text-xs text-slate-400">{l('Students')}</p>
        </Panel>
        <Panel verdict="Do" good title="Value, deviation, trend">
          <p className="text-xs text-slate-500">{l('Students, winter semester 2024/25')}</p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <p className="text-3xl font-light text-slate-900">{l('37.7k')}</p>
            <Sparkline values={values} />
          </div>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-semibold text-emerald-700">{l('▲ +2.2 %')}</span>
            {l(' vs. PY 36.9k')}
            <span className="mx-1.5 text-slate-300">|</span>
            <span className="font-semibold text-emerald-700">{l('▲ +1.3 %')}</span>
            {l(' vs. PL 37.2k')}
          </p>
        </Panel>
      </div>
    </Frame>
  );
}

function DeviationColors() {
  const { l, n } = useWords();
  const max = Math.max(...DEVIATIONS.map((r) => Math.abs(r[1])));
  const rowH = 24;
  const axis = 262;
  const half = 70;
  const height = DEVIATIONS.length * rowH + 4;
  return (
    <Frame title="Color means deviation" caption={'Students ΔPY in percent by subject group. Everything else stays neutral, so the eye lands on what changed. The sign says the same as the color.'}>
      <Panel>
        <svg viewBox={`0 0 400 ${height}`} className="h-auto w-full max-w-lg" role="img" aria-label={l('Deviation to previous year in percent by subject group: positive values green to the right, negative values red to the left')} style={FONT}>
          {DEVIATIONS.map(([name, value], i) => {
            const w = (Math.abs(value) / max) * half;
            const positive = value >= 0;
            return (
              <g key={name} transform={`translate(0 ${i * rowH + 2})`}>
                <text x={178} y={15} textAnchor="end" fontSize={11} fill={INK}>
                  {l(name)}
                </text>
                <rect x={positive ? axis : axis - w} y={4} width={w} height={14} fill={positive ? GOOD : BAD} />
                <text x={positive ? axis + w + 6 : axis - w - 6} y={15} textAnchor={positive ? 'start' : 'end'} fontSize={11} fill={INK} fontWeight={600}>
                  {signed(value, n)}
                </text>
              </g>
            );
          })}
          <line x1={axis} y1={0} x2={axis} y2={height} stroke={INK} strokeWidth={1} />
        </svg>
      </Panel>
    </Frame>
  );
}

// ---------------------------------------------------------------------------

export interface FigureProps {
  /** The organization's answer to a question as it is shown, or `null`. */
  team: (qid: string) => string | null;
  /** The same answer as it is stored, whatever the language. */
  stored: (qid: string) => string | null;
}

export {
  StorageModes,
  Cardinality,
  SchemaShapes,
  DaxDivide,
  MeasureFolders,
  ThreeLayers,
  TitleConcept,
  Orientation,
  Scenarios,
  Density,
  KpiCard,
  DeviationColors,
  // The pieces further drawings are built from.
  Box,
  Code,
  FieldRow,
  Frame,
  Link as Line,
  Panel,
  Wire,
  useWords,
  signed,
  WordsContext,
  EN_WORDS,
  DE_WORDS,
  BAD,
  FONT,
  GOOD,
  GRID,
  INK,
  MUTED,
  SOFT,
};
