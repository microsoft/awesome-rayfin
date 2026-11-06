import { useMemo, useState } from 'react';

import { MonthColumns, Waterfall, type MonthPoint, type Step } from '@/components/charts';
import { PageTitle, Panel } from '@/components/layout';
import { StatementTable } from '@/components/StatementTable';
import { fmtDeltaK, fmtDeltaPct, monthLabel } from '@/domain/format';
import { periodMonths, statementRows } from '@/domain/statements';
import { statementLines, visibleLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useMarked } from '@/hooks/useMarked';

const BRIDGE: [string, string][] = [
  ['N-REV', 'Net revenue'],
  ['N-COGS', 'Cost of goods sold'],
  ['N-OPEX', 'Operating expenses'],
  ['N-OOR', 'Other operating'],
  ['N-DA', 'Depreciation'],
  ['N-FIN', 'Financial result'],
  ['N-TAX', 'Income taxes'],
];

/** One block open at a time: opening a line closes every open line that is not one of its ancestors. */
export function toggleBlock(expanded: ReadonlySet<string>, id: string, parentOf: (id: string) => string | null): Set<string> {
  if (expanded.has(id)) {
    const next = new Set(expanded);
    next.delete(id);
    return next;
  }
  const ancestors = new Set<string>();
  for (let p = parentOf(id); p; p = parentOf(p)) ancestors.add(p);
  return new Set([...[...expanded].filter((e) => ancestors.has(e)), id]);
}

export function IncomePage() {
  const { snapshot, current, period, comparison, currentCode, selection } = useFinance();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lines = useMemo(() => statementLines(snapshot, current, 'PL', period), [snapshot, current, period]);
  const shown = useMemo(() => visibleLines(lines, expanded), [lines, expanded]);
  const marked = useMarked('PL');
  const parentOf = (id: string) => snapshot.accounts.find((a) => a.id === id)?.parentId ?? null;

  const ni = lines.find((l) => l.account.id === 'F-NI');
  const d = comparison === 'PL' ? ni?.dPl : ni?.dPy;
  const r = comparison === 'PL' ? ni?.rPl : ni?.rPy;
  const message =
    d === undefined
      ? ''
      : `Net income ${fmtDeltaK(d)} kEUR (${fmtDeltaPct(r)}) ${d >= 0 ? 'above' : 'below'} ${comparison === 'PL' ? 'budget' : 'previous year'}`;

  // Chart line: the selected P&L line, else net revenue.
  const chartId = selection?.statement === 'PL' ? selection.accountId : 'N-REV';
  const chartAccount = snapshot.accounts.find((a) => a.id === chartId);
  const year = period.month.slice(0, 4);
  const points: MonthPoint[] = useMemo(
    () =>
      snapshot.months
        .filter((m) => m.id.startsWith(year))
        .map((m) => {
          const p = { month: m.id, mode: 'MTD' as const };
          return {
            month: m.id,
            cur: statementRows(snapshot, current, 'PL', p)[chartId],
            isForecast: m.id > snapshot.meta.cutoff,
            pl: statementRows(snapshot, snapshot.values.PL, 'PL', p)[chartId],
            py: statementRows(snapshot, snapshot.values.PY, 'PL', p)[chartId],
          };
        }),
    [snapshot, current, chartId, year]
  );

  const steps: Step[] = useMemo(() => {
    const ref = comparison === 'PL' ? 'pl' : 'py';
    const get = (id: string, k: 'cur' | 'pl' | 'py') => lines.find((l) => l.account.id === id)?.[k] ?? 0;
    const hatched = currentCode !== 'AC';
    return [
      { label: `Net income ${comparison}`, value: get('F-NI', ref), kind: comparison === 'PL' ? 'total-pl' : 'total-py' },
      ...BRIDGE.map(([id, label]): Step => ({ label, value: get(id, 'cur') - get(id, ref), kind: 'step', goodUp: true, hatched })),
      { label: `Net income ${currentCode}`, value: get('F-NI', 'cur'), kind: 'total-cur', hatched },
    ];
  }, [lines, comparison, currentCode]);

  const months = periodMonths(period);
  const span = months.length > 1 ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : monthLabel(months[0]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <PageTitle statement="Income statement" span={span} message={message} />
      <div className="grid min-h-0 grid-cols-[minmax(0,58fr)_minmax(0,42fr)] gap-4">
        <Panel>
          <StatementTable lines={shown} expanded={expanded} onToggle={(id) => setExpanded((e) => toggleBlock(e, id, parentOf))} marked={marked} />
        </Panel>
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Panel title={`${chartAccount?.name ?? ''} by month, ${year}, kEUR`}>
            <MonthColumns points={points} comparison={comparison} goodUp={chartAccount?.goodUp ?? true} />
          </Panel>
          <Panel title={`Net income bridge ${comparison} → ${currentCode}, ${span}, kEUR`}>
            <Waterfall steps={steps} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
