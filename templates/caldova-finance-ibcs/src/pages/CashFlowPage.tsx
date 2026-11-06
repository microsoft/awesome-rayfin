import { useMemo } from 'react';

import { Waterfall, type Step } from '@/components/charts';
import { PageTitle, Panel } from '@/components/layout';
import { StatementTable } from '@/components/StatementTable';
import { fmtDeltaK, fmtK, monthLabel } from '@/domain/format';
import { periodMonths, statementRows } from '@/domain/statements';
import { statementLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useMarked } from '@/hooks/useMarked';

const STEPS: [string, string][] = [
  ['C-OP-NI', 'Net income'],
  ['C-OP-DA', 'Depreciation'],
  ['C-OP-REC', 'Receivables'],
  ['C-OP-INV', 'Inventories'],
  ['C-OP-PAY', 'Payables'],
  ['C-OP-PR', 'Provisions'],
  ['C-IN-FLEET', 'Vehicles'],
  ['C-IN-EQUIP', 'Equipment & IT'],
  ['C-FI-LOAN', 'Loan repayments'],
  ['C-FI-DIV', 'Dividends'],
];

export function CashFlowPage() {
  const { snapshot, current, period, comparison, currentCode } = useFinance();
  const lines = useMemo(() => statementLines(snapshot, current, 'CF', period), [snapshot, current, period]);
  const all = useMemo(() => new Set(lines.filter((l) => l.hasChildren).map((l) => l.account.id)), [lines]);
  const marked = useMarked('CF');

  const cf = statementRows(snapshot, current, 'CF', period);
  const bs = statementRows(snapshot, current, 'BS', { month: period.month, mode: 'MTD' });
  const reconciled = Math.abs((cf['C-CLOSE'] ?? NaN) - (bs['B-CA-CASH'] ?? NaN)) < 0.5 && Math.abs(cf['C-OPEN'] + cf['C-NET'] - cf['C-CLOSE']) < 0.5;
  const hatched = currentCode !== 'AC';

  // Cash movements are not variances: the steps are drawn in ink, the totals in scenario notation.
  const steps: Step[] = [
    { label: 'Opening cash', value: cf['C-OPEN'] ?? 0, kind: 'total-cur', hatched: false },
    ...STEPS.map(([id, label]): Step => ({ label, value: cf[id] ?? 0, kind: 'step', hatched })),
    { label: 'Closing cash', value: cf['C-CLOSE'] ?? 0, kind: 'total-cur', hatched },
  ];

  const op = lines.find((l) => l.account.id === 'C-OP');
  const dOp = comparison === 'PL' ? op?.dPl : op?.dPy;
  const message =
    dOp === undefined
      ? ''
      : `Operating cash flow ${fmtK(op?.cur)} kEUR, ${fmtDeltaK(dOp)} kEUR vs ${comparison === 'PL' ? 'budget' : 'previous year'}`;
  const months = periodMonths(period);
  const span = months.length > 1 ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : monthLabel(months[0]);

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <PageTitle statement="Cash flow statement (indirect)" span={span} message={message} />
      <div className="grid min-h-0 grid-cols-[minmax(0,58fr)_minmax(0,42fr)] gap-4">
        <Panel>
          <StatementTable lines={lines} expanded={all} marked={marked} />
        </Panel>
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <Panel title={`Cash bridge ${currentCode}, ${span}, kEUR`}>
            <Waterfall steps={steps} />
          </Panel>
          <div className={`flex items-center gap-2 border-t border-ink pt-2 text-[12px] ${reconciled ? '' : 'text-bad'}`} role="status">
            <span className="text-[16px]" aria-hidden="true">
              {reconciled ? '✓' : '✗'}
            </span>
            {reconciled
              ? `Closing cash ${fmtK(cf['C-CLOSE'])} kEUR equals the balance sheet cash at ${monthLabel(period.month)}; opening cash plus the cash flow equals closing cash.`
              : `Closing cash ${fmtK(cf['C-CLOSE'])} kEUR does not equal the balance sheet cash ${fmtK(bs['B-CA-CASH'])} kEUR.`}
          </div>
        </div>
      </div>
    </div>
  );
}
