/**
 * More drawings of the guidelines page, chosen by Alexander on 2026-10-12
 * from two proposals each. Same rules as figures.tsx: hand-built, made-up
 * numbers, words in English here and looked up in figures.de.ts for German.
 */
import { useId, type ReactNode } from 'react';

import { Box, Code, FieldRow, Frame, Line, Panel, Wire, signed, useWords, BAD, FONT, GOOD, GRID, INK, MUTED, SOFT } from './figures';

const pair = 'grid gap-3 sm:grid-cols-2';

function Arrow({ a, b, both, color = MUTED }: { a: readonly [number, number]; b: readonly [number, number]; both?: boolean; color?: string }) {
  // An id of its own, so no two arrowheads in the page share one.
  const id = `head-${useId().replace(/:/g, '')}`;
  return (
    <g>
      <defs>
        <marker id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill={color} />
        </marker>
      </defs>
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={1.4} markerEnd={`url(#${id})`} markerStart={both ? `url(#${id})` : undefined} />
    </g>
  );
}

export function FilterDirection() {
  const { l } = useWords();
  const star = (both: boolean) => (
    <>
      <Arrow a={[81, 30]} b={[113, 47]} both={both} color={both ? BAD : MUTED} />
      <Arrow a={[81, 82]} b={[113, 63]} both={both} color={both ? BAD : MUTED} />
      <Arrow a={[216, 55]} b={[187, 55]} both={both} color={both ? BAD : MUTED} />
      <Box x={48} y={24} label="Date" />
      <Box x={48} y={88} label="Subject" />
      <Box x={252} y={55} label="University" w={68} />
      <Box x={150} y={55} label="Students" fact w={74} h={28} />
    </>
  );
  return (
    <Frame title="Filters flow one way" caption="From the dimension to the fact. Both directions let every dimension filter every other one through the fact table, with slow and surprising results.">
      <div className={pair}>
        <Panel verdict="Do" good title="Single direction">
          <svg viewBox="0 0 300 110" className="h-auto w-full" role="img" aria-label={l('Dimensions filter the fact table in one direction')} style={FONT}>
            {star(false)}
          </svg>
        </Panel>
        <Panel verdict="Avoid" title="Both directions">
          <svg viewBox="0 0 300 110" className="h-auto w-full" role="img" aria-label={l('Filters in both directions between dimensions and fact')} style={FONT}>
            {star(true)}
          </svg>
        </Panel>
      </div>
    </Frame>
  );
}

export function LogicUpstream() {
  const { l } = useWords();
  const stations = [
    { name: 'Source', note: 'Raw data. Nothing to maintain here.' },
    { name: 'Warehouse', note: 'Joins, keys, business logic, history. Views on top.' },
    { name: 'Power Query', note: 'Only steps that fold back to the source.' },
    { name: 'DAX', note: 'Measures. No calculated columns or tables.' },
  ];
  return (
    <Frame title="Logic belongs upstream" caption="The further upstream a rule lives, short of the source itself, the more models share it and the less each model has to compute.">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-800">
        <span aria-hidden="true">{'◀'}</span>
        <span className="h-1 flex-1 rounded-full bg-gradient-to-r from-emerald-600 to-slate-200" />
        <span className="text-slate-500">{l('as far upstream as possible')}</span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-4">
        {stations.map((s, i) => (
          <li key={s.name} className={`rounded-lg p-3 ring-1 ${i === 1 ? 'bg-emerald-50 ring-emerald-600/30' : 'bg-white ring-slate-200'}`}>
            <p className="text-sm font-semibold text-slate-900">{l(s.name)}</p>
            <p className="mt-1 text-xs text-slate-600">{l(s.note)}</p>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export function NamePairs() {
  const { l } = useWords();
  const rows = [
    ['tblFactRevenue', 'Revenue', 'No technical prefix'],
    ['IsActive', 'Active Flag', "No 'Is'"],
    ['Sales Amount Total', 'Sales', "No 'Amount', no 'Total'"],
    ['RegionName', 'Region', "No redundant 'Name'"],
    ['rev_ytd_py', 'Revenue YTD PY', 'Title Case, words apart'],
  ];
  return (
    <Frame title="Names people can read" caption="A model is part of the front end. Its names are read far more often than they are written.">
      <Panel>
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 uppercase">
              <th className="pb-1.5 font-medium">{l('Avoid')}</th>
              <th className="pb-1.5 font-medium">{l('Do')}</th>
              <th className="pb-1.5 font-medium">{l('Why')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([avoid, good, why]) => (
              <tr key={avoid} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-xs break-words text-[#FF0000]">{avoid}</td>
                <td className="py-1.5 font-semibold text-slate-900">{good}</td>
                <td className="py-1.5 text-xs text-slate-500">{l(why)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Frame>
  );
}

export function MeasureAnatomy() {
  const { l } = useWords();
  const parts = [
    { text: 'Billed Revenue', role: 'base', note: 'what is measured' },
    { text: 'YTD', role: 'time scope', note: 'over which period' },
    { text: 'ΔPY', role: 'comparison', note: 'against what' },
    { text: '%', role: 'unit', note: 'always last' },
  ];
  return (
    <Frame title="Anatomy of a measure name" caption="Related measures share the base and differ only in the suffixes, so they sort together and explain themselves.">
      <Panel>
        <div className="flex flex-wrap items-start justify-center gap-x-3 gap-y-4 py-2">
          {parts.map((p) => (
            <div key={p.role} className="text-center">
              <p className="border-b-2 border-slate-800 px-1 pb-1 text-xl font-semibold text-slate-900">{p.text}</p>
              <p className="mt-1 text-xs font-semibold text-blue-700">{l(p.role)}</p>
              <p className="text-[11px] text-slate-500">{l(p.note)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </Frame>
  );
}

function MiniBars({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {[14, 22, 18, 26].map((h, i) => (
        <rect key={i} x={x + i * 9} y={y - h} width={6} height={h} fill={SOFT} />
      ))}
    </g>
  );
}

export function FilterPane() {
  return (
    <Frame title="Filters at the side, not on the page" caption="The filter pane costs no canvas and no extra queries. A wall of slicers costs both.">
      <div className={pair}>
        <Panel verdict="Avoid" title="A wall of slicers">
          <Wire label="Report page whose upper third is filled with slicers">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <rect key={i} x={8 + (i % 5) * 29} y={22 + Math.floor(i / 5) * 11} width={25} height={8} rx={1.5} fill="#fff" stroke={BAD} strokeWidth={0.8} />
            ))}
            <MiniBars x={12} y={82} />
            <MiniBars x={62} y={82} />
            <MiniBars x={112} y={82} />
          </Wire>
        </Panel>
        <Panel verdict="Do" good title="Filter pane, free canvas">
          <Wire label="Report page with the filter pane at the side and the whole canvas for visuals">
            {[0, 1, 2].map((i) => (
              <rect key={i} x={8 + i * 36} y={22} width={32} height={14} rx={2} fill="#f1f5f9" stroke={GRID} />
            ))}
            <MiniBars x={12} y={82} />
            <MiniBars x={54} y={82} />
            <MiniBars x={92} y={82} />
            <rect x={128} y={0} width={32} height={90} fill="#f1f5f9" />
            <line x1={128} y1={0} x2={128} y2={90} stroke={GRID} />
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={132} y={10 + i * 12} width={24} height={7} rx={1.5} fill="#fff" stroke={SOFT} strokeWidth={0.8} />
            ))}
          </Wire>
        </Panel>
      </div>
    </Frame>
  );
}

export function CanvasShare() {
  const { l } = useWords();
  const rows = [
    { name: 'Wall of slicers', slicers: 32 },
    { name: 'Filter pane', slicers: 0 },
  ];
  return (
    <Frame title="What the page is spent on" caption="Share of the canvas, made-up numbers. Every slicer is also a visual that sends its own query.">
      <Panel>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.name} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 text-xs text-slate-700">
              {l(r.name)}
              <span className="flex h-6 overflow-hidden rounded ring-1 ring-slate-300">
                {r.slicers > 0 && (
                  <span className="flex items-center justify-center bg-white font-semibold text-[#FF0000]" style={{ width: `${r.slicers}%`, boxShadow: 'inset 0 0 0 1.5px #FF0000' }}>
                    {`${l('slicers')} ${r.slicers} %`}
                  </span>
                )}
                <span className="flex flex-1 items-center justify-center bg-slate-800 font-semibold text-white">{`${l('visuals')} ${100 - r.slicers} %`}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </Frame>
  );
}

/** Month, actual in thousand, deviation to the previous year in percent. */
const MONTHS: readonly (readonly [string, number, number])[] = [
  ['Jul', 4.2, 5.0],
  ['Aug', 3.1, 3.3],
  ['Sep', 2.4, -4.0],
  ['Oct', 1.2, 9.1],
  ['Nov', 0.9, -10.0],
  ['Dec', 1.1, 10.0],
  ['Jan', 2.8, 3.7],
  ['Feb', 3.0, -3.2],
  ['Mar', 3.6, 2.9],
  ['Apr', 4.4, 4.8],
  ['May', 5.9, 7.3],
  ['Jun', 6.8, 6.3],
];

export function TimeDeviations() {
  const { l, n } = useWords();
  const width = 400;
  const step = width / MONTHS.length;
  const w = 20;
  const zero = 46;
  const base = 190;
  const h = (v: number) => (v / 6.8) * 84;
  const sign = (d: number) => signed(d, n);
  return (
    <Frame
      title="Time with its deviations"
      caption="Actual as columns, the deviation to the previous year in percent right above, in the same width and on the same time axis. Months with the year below. Applications in thousand, made-up numbers."
    >
      <Panel>
        <svg viewBox={`0 0 ${width} 226`} className="h-auto w-full max-w-xl" role="img" aria-label={l('Applications per month over two years as columns, with the deviation to the previous year in percent above each column')} style={FONT}>
          <text x={0} y={9} fontSize={9.5} fill={MUTED}>
            {'ΔPY %'}
          </text>
          <text x={0} y={96} fontSize={9.5} fill={MUTED}>
            AC
          </text>
          {MONTHS.map(([name, ac, d], i) => {
            const cx = i * step + step / 2;
            const dh = Math.abs(d) * 2.2;
            return (
              <g key={name}>
                <rect x={cx - w / 2} y={d >= 0 ? zero - dh : zero} width={w} height={dh} fill={d >= 0 ? GOOD : BAD} />
                <text x={cx} y={d >= 0 ? zero - dh - 3 : zero + dh + 10} textAnchor="middle" fontSize={9} fontWeight={600} fill={INK}>
                  {sign(d)}
                </text>
                <rect x={cx - w / 2} y={base - h(ac)} width={w} height={h(ac)} fill={INK} />
                <text x={cx} y={base - h(ac) - 4} textAnchor="middle" fontSize={9.5} fill={INK}>
                  {n(ac)}
                </text>
                <text x={cx} y={base + 13} textAnchor="middle" fontSize={9.5} fill={MUTED}>
                  {l(name)}
                </text>
              </g>
            );
          })}
          <line x1={0} y1={zero} x2={width} y2={zero} stroke={INK} strokeWidth={0.8} />
          <line x1={0} y1={base} x2={width} y2={base} stroke={INK} strokeWidth={1} />
          <line x1={width / 2} y1={base} x2={width / 2} y2={base + 30} stroke={SOFT} strokeWidth={1} />
          <text x={width / 4} y={base + 28} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK}>
            2025
          </text>
          <text x={(width * 3) / 4} y={base + 28} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK}>
            2026
          </text>
        </svg>
      </Panel>
    </Frame>
  );
}

export function DeviationTable() {
  const { l, n } = useWords();
  const rows: readonly (readonly [string, number, number])[] = [
    ['Law, Economics, Social Sciences', 12.4, 12.0],
    ['Engineering', 9.8, 9.7],
    ['Mathematics, Natural Sciences', 6.1, 6.2],
    ['Humanities', 4.3, 4.4],
    ['Medicine, Health', 3.2, 3.1],
    ['Other', 1.9, 2.0],
  ];
  const sign = (d: number) => signed(d, n);
  return (
    <Frame title="A table that shows its deviations" caption="Numbers for looking up, bars for seeing. Each deviation bar carries its value, and the deviation column is the one the eye finds first.">
      <Panel>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-right text-xs text-slate-500">
              <th className="py-1 text-left font-medium">{l('Students, thousand')}</th>
              <th className="py-1 font-medium">AC</th>
              <th className="py-1 font-medium">PY</th>
              <th className="w-40 py-1 text-center font-medium">{'ΔPY'}</th>
              <th className="py-1 font-medium">{'ΔPY %'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, ac, py]) => {
              const d = Math.round((ac - py) * 10) / 10;
              const pct = (d / py) * 100;
              const w = Math.abs(d) * 80;
              return (
                <tr key={name} className="border-b border-slate-100 text-right tabular-nums">
                  <td className="py-1 text-left text-slate-800">{l(name)}</td>
                  <td className="py-1 font-semibold text-slate-900">{n(ac)}</td>
                  <td className="py-1 text-slate-500">{n(py)}</td>
                  <td className="py-1">
                    <svg viewBox="0 0 160 20" className="h-5 w-full" role="img" aria-label={`${l(name)}: ${sign(d)}`} style={FONT}>
                      <rect x={d >= 0 ? 80 : 80 - w} y={4} width={w} height={12} fill={d >= 0 ? GOOD : BAD} />
                      <line x1={80} y1={0} x2={80} y2={20} stroke={INK} strokeWidth={1} />
                      <text x={d >= 0 ? 80 + w + 4 : 80 - w - 4} y={14.5} textAnchor={d >= 0 ? 'start' : 'end'} fontSize={12.5} fontWeight={600} fill={INK}>
                        {sign(d)}
                      </text>
                    </svg>
                  </td>
                  <td className="py-1 font-medium text-slate-900">{sign(pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </Frame>
  );
}

export function FormatCards() {
  const { l } = useWords();
  const cards = [
    ['Revenue', '32000.4567', '$32,000'],
    ['Customers', '1204.00', '1,204'],
    ['Margin', '0.03214', '3.2%'],
  ];
  return (
    <Frame title="As few decimals as the reader needs" caption="A number without format makes the reader do the rounding. Counts never have decimals.">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([name, raw, shown]) => (
          <Panel key={name} title={name}>
            <p className="text-xs">
              <span className="font-semibold text-[#FF0000]" aria-hidden="true">
                {'✕ '}
              </span>
              <span className="sr-only">{`${l('Avoid')}: `}</span>
              <span className="font-mono text-slate-500">{l(raw)}</span>
            </p>
            <p className="mt-1 text-2xl font-light text-slate-900">
              <span className="text-sm font-semibold text-emerald-700" aria-hidden="true">
                {'✓ '}
              </span>
              <span className="sr-only">{`${l('Do')}: `}</span>
              {l(shown)}
            </p>
          </Panel>
        ))}
      </div>
    </Frame>
  );
}

export function PageDensity() {
  const cell = (x: number, y: number, w: number, h: number, key: string): ReactNode => <rect key={key} x={x} y={y} width={w} height={h} rx={2} fill="#f1f5f9" stroke={GRID} />;
  return (
    <Frame title="What a larger page buys" caption="The same report, the same font size on screen: the larger page holds a third row without getting crowded.">
      <div className={pair}>
        <Panel title={'1280×720: six visuals'}>
          <Wire label="Report page with six visuals">{[0, 1, 2, 3, 4, 5].map((i) => cell(8 + (i % 3) * 49, 22 + Math.floor(i / 3) * 33, 45, 29, String(i)))}</Wire>
        </Panel>
        <Panel title={'1920×1080: nine visuals'}>
          <Wire label="Report page with nine visuals">{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => cell(8 + (i % 3) * 49, 22 + Math.floor(i / 3) * 22, 45, 18, String(i)))}</Wire>
        </Panel>
      </div>
    </Frame>
  );
}

export function SharedDimensions() {
  const { l } = useWords();
  return (
    <Frame title="Several stars, shared dimensions" caption="Two fact tables at their own grain, both filtered by the same Date and Subject. One model answers questions across both.">
      <Panel>
        <svg viewBox="0 0 360 130" className="mx-auto h-auto w-full max-w-md" role="img" aria-label={l('Two fact tables, students and exams, sharing the date and subject dimensions')} style={FONT}>
          <Line a={[180, 24]} b={[92, 65]} />
          <Line a={[180, 24]} b={[268, 65]} />
          <Line a={[180, 106]} b={[92, 65]} />
          <Line a={[180, 106]} b={[268, 65]} />
          <Line a={[30, 65]} b={[92, 65]} />
          <Line a={[330, 65]} b={[268, 65]} />
          <Box x={180} y={24} label="Date" />
          <Box x={180} y={106} label="Subject" />
          <Box x={34} y={65} label="University" w={66} />
          <Box x={326} y={65} label="Exam type" w={66} />
          <Box x={110} y={65} label="Students" fact w={74} h={28} />
          <Box x={250} y={65} label="Exams" fact w={74} h={28} />
        </svg>
      </Panel>
    </Frame>
  );
}

export function DaxSwitch() {
  return (
    <Frame title="SWITCH instead of nested IF" caption="One condition per line reads from top to bottom, and a new case is one more line.">
      <div className={pair}>
        <Panel verdict="Avoid">
          <Code>{'Rating =\nIF ( [Success Rate] >= 0.9, "High",\n  IF ( [Success Rate] >= 0.7, "Medium",\n    IF ( [Success Rate] >= 0.5, "Low",\n      "Critical" ) ) )'}</Code>
        </Panel>
        <Panel verdict="Do" good>
          <Code>{'Rating =\nSWITCH ( TRUE (),\n  [Success Rate] >= 0.9, "High",\n  [Success Rate] >= 0.7, "Medium",\n  [Success Rate] >= 0.5, "Low",\n  "Critical" )'}</Code>
        </Panel>
      </div>
    </Frame>
  );
}

export function DaxVar() {
  return (
    <Frame title="Name it once with VAR" caption="A variable is computed once, has a name that explains it, and makes the return line readable.">
      <div className={pair}>
        <Panel verdict="Avoid">
          <Code>{"Students ΔPY % =\nDIVIDE (\n  [Students] - CALCULATE ( [Students],\n      SAMEPERIODLASTYEAR ( 'Date'[Date] ) ),\n  CALCULATE ( [Students],\n      SAMEPERIODLASTYEAR ( 'Date'[Date] ) ) )"}</Code>
        </Panel>
        <Panel verdict="Do" good>
          <Code>{"Students ΔPY % =\nVAR Current = [Students]\nVAR Previous =\n  CALCULATE ( [Students],\n      SAMEPERIODLASTYEAR ( 'Date'[Date] ) )\nRETURN\n  DIVIDE ( Current - Previous, Previous )"}</Code>
        </Panel>
      </div>
    </Frame>
  );
}

export function HiddenKeys() {
  return (
    <Frame title="Show what people need, hide the plumbing" caption="Keys and raw fact columns stay in the model, hidden. The field list shows names a report author can use.">
      <div className={pair}>
        <Panel verdict="Avoid" title="Everything visible">
          <ul className="space-y-1">
            <FieldRow kind="table" name="Students" />
            <FieldRow kind="column" name="DateID" level={1} />
            <FieldRow kind="column" name="SubjectID" level={1} />
            <FieldRow kind="column" name="UniversityID" level={1} />
            <FieldRow kind="column" name="StudentCount" level={1} />
            <FieldRow kind="table" name="Subject" />
            <FieldRow kind="column" name="SubjectID" level={1} />
            <FieldRow kind="column" name="Subject" level={1} />
            <FieldRow kind="column" name="SubjectSort" level={1} />
          </ul>
        </Panel>
        <Panel verdict="Do" good title="Keys and raw columns hidden">
          <ul className="space-y-1">
            <FieldRow kind="table" name="Measure" />
            <FieldRow kind="measure" name="Students" level={1} />
            <FieldRow kind="measure" name="Students PY" level={1} />
            <FieldRow kind="table" name="Subject" />
            <FieldRow kind="column" name="Subject" level={1} />
            <FieldRow kind="column" name="Subject Group" level={1} />
          </ul>
        </Panel>
      </div>
    </Frame>
  );
}
