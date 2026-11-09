import { useMemo } from 'react';

import { StructureColumns, type Stack } from '@/components/charts';
import { ScenarioMark } from '@/components/ibcs';
import { PageTitle, Panel } from '@/components/layout';
import { StatementTable } from '@/components/StatementTable';
import { fmtDays, fmtDeltaK, fmtDeltaPp, fmtPct, monthLabel } from '@/domain/format';
import { statementRows } from '@/domain/statements';
import { pyValues, statementLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useMarked } from '@/hooks/useMarked';

const ASSETS: [string, string][] = [
  ['B-FA', 'Non-current'],
  ['B-CA-INV', 'Inventories'],
  ['B-CA-REC', 'Receivables'],
  ['B-CA-CASH', 'Cash'],
];
const EQL: [string, string][] = [
  ['B-EQ', 'Equity'],
  ['B-LI-LOAN', 'Loans'],
  ['B-PR', 'Provisions'],
  ['B-LI-PAY', 'Payables'],
];

interface Kpi {
  label: string;
  cur?: number;
  py?: number;
  /** Is a higher value good? */
  goodUp: boolean;
  kind: 'days' | 'pct';
}

/** Working capital and structure KPIs from the month-end balances and the month's flows. */
export function workingCapital(bs: Record<string, number>, pl: Record<string, number>, days: number) {
  const revenue = pl['N-REV'];
  const cogs = -pl['N-COGS'];
  const dso = revenue ? (bs['B-CA-REC'] / revenue) * days : undefined;
  const dio = cogs ? (bs['B-CA-INV'] / cogs) * days : undefined;
  const dpo = cogs ? (bs['B-LI-PAY'] / cogs) * days : undefined;
  const ccc = dso !== undefined && dio !== undefined && dpo !== undefined ? dso + dio - dpo : undefined;
  const equityRatio = bs['B-ASSETS'] ? bs['B-EQ'] / bs['B-ASSETS'] : undefined;
  return { dso, dio, dpo, ccc, equityRatio };
}

const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate();

export function BalancePage() {
  const { snapshot, current, period, comparison, currentCode } = useFinance();
  const lines = useMemo(() => statementLines(snapshot, current, 'BS', period), [snapshot, current, period]);
  const all = useMemo(() => new Set(lines.filter((l) => l.hasChildren).map((l) => l.account.id)), [lines]);
  const marked = useMarked('BS');

  const monthEnd = { month: period.month, mode: 'MTD' as const };
  const prevYearEnd = `${Number(period.month.slice(0, 4)) - 1}-12`;
  const cur = statementRows(snapshot, current, 'BS', monthEnd);
  const pl = statementRows(snapshot, snapshot.values.PL, 'BS', monthEnd);
  const py = pyValues(snapshot, 'BS', period);
  const ref = comparison === 'PL' ? pl : py;

  const stack = (v: Record<string, number>, parts: [string, string][], code: Stack['code'], hatched?: boolean): Stack => ({
    label: '',
    code,
    hatched,
    parts: parts.map(([id, label]) => ({ label, value: v[id] ?? 0 })),
  });
  const hatched = currentCode !== 'AC';
  const refTitle = comparison === 'PL' ? `PL ${monthLabel(period.month)}` : `PY ${monthLabel(prevYearEnd)}`;
  const pairs = [
    { title: refTitle, left: stack(ref, ASSETS, comparison === 'PL' ? 'pl' : 'py'), right: stack(ref, EQL, comparison === 'PL' ? 'pl' : 'py') },
    { title: `${currentCode} ${monthLabel(period.month)}`, left: stack(cur, ASSETS, 'cur', hatched), right: stack(cur, EQL, 'cur', hatched) },
  ];

  const flow = (values: typeof current, m: string) => statementRows(snapshot, values, 'PL', { month: m, mode: 'MTD' });
  const wcCur = workingCapital(cur, flow(current, period.month), daysIn(period.month));
  const wcRef =
    comparison === 'PL'
      ? workingCapital(pl, flow(snapshot.values.PL, period.month), daysIn(period.month))
      : workingCapital(py, statementRows(snapshot, snapshot.values.PY, 'PL', { month: `${period.month.slice(0, 4)}-12`, mode: 'MTD' }), 31);
  const kpis: Kpi[] = [
    { label: 'DSO', cur: wcCur.dso, py: wcRef.dso, goodUp: false, kind: 'days' },
    { label: 'DIO', cur: wcCur.dio, py: wcRef.dio, goodUp: false, kind: 'days' },
    { label: 'DPO', cur: wcCur.dpo, py: wcRef.dpo, goodUp: true, kind: 'days' },
    { label: 'Cash conversion cycle', cur: wcCur.ccc, py: wcRef.ccc, goodUp: false, kind: 'days' },
    { label: 'Equity ratio', cur: wcCur.equityRatio, py: wcRef.equityRatio, goodUp: true, kind: 'pct' },
  ];

  const dEq = cur['B-EQ'] - (ref['B-EQ'] ?? 0);
  const dCash = cur['B-CA-CASH'] - (ref['B-CA-CASH'] ?? 0);
  const message = `Cash ${fmtDeltaK(dCash)} kEUR and equity ${fmtDeltaK(dEq)} kEUR vs ${comparison === 'PL' ? 'budget' : 'previous year-end'}`;

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <PageTitle statement="Balance sheet" span={`${monthLabel(period.month)} month end${comparison === 'PY' ? ` vs ${monthLabel(prevYearEnd)}` : ''}`} message={message} />
      <div className="grid min-h-0 grid-cols-[minmax(0,58fr)_minmax(0,42fr)] gap-4">
        <Panel>
          <StatementTable lines={lines} expanded={all} marked={marked} pyLabel="PY YE" />
        </Panel>
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <Panel title={`Structure, ${refTitle} vs ${currentCode} ${monthLabel(period.month)}, kEUR`}>
            <StructureColumns pairs={pairs} />
          </Panel>
          <Panel title="Working capital">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-ink text-[11px] uppercase text-muted">
                  <th className="text-left font-semibold" />
                  <th className="num px-2">
                    <ScenarioMark s={comparison} /> {comparison}
                  </th>
                  <th className="num px-2">
                    <ScenarioMark s={currentCode} /> {currentCode}
                  </th>
                  <th className="num px-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k) => {
                  const raw = k.cur !== undefined && k.py !== undefined ? k.cur - k.py : undefined;
                  // Compare what is shown: one decimal of days, one decimal of a percentage point.
                  const d = raw === undefined ? undefined : k.kind === 'days' ? Math.round(raw * 10) / 10 : Math.round(raw * 1000) / 1000;
                  const good = d === undefined || d === 0 ? undefined : (d > 0) === k.goodUp;
                  return (
                    <tr key={k.label} className="h-[22px]">
                      <td>{k.label}</td>
                      <td className="num px-2 text-muted">{k.kind === 'days' ? fmtDays(k.py) : fmtPct(k.py)}</td>
                      <td className="num px-2 font-semibold">{k.kind === 'days' ? fmtDays(k.cur) : fmtPct(k.cur)}</td>
                      <td className="num px-2">
                        <span className={good === undefined ? 'text-muted' : good ? 'text-good' : 'text-bad'}>
                          {k.kind === 'days' ? (d === undefined ? '' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtDays(Math.abs(d))}`) : fmtDeltaPp(d)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
