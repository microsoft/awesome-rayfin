import { useMemo } from 'react';

import { fmtDeltaK, fmtDeltaPct, fmtDeltaPp, fmtK, fmtPct } from '@/domain/format';
import type { Line } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useSize } from '@/hooks/useSize';

import { relCap, ScenarioLabel, toneOf, VarianceBar, VariancePin } from './ibcs';

const MIN_ROW = 18;
const MAX_ROW = 26;
const HEAD = 30;

interface Props {
  lines: Line[];
  expanded: ReadonlySet<string>;
  onToggle?(id: string): void;
  /** Lines that carry comments or adjustments get a small marker. */
  marked: ReadonlySet<string>;
  /** Head of the PY column; the balance sheet compares with the previous year-end. */
  pyLabel?: string;
}

/**
 * An IBCS statement table: columns PL, PY, current (AC / FC / AC&FC), then the variance against the chosen
 * comparison as a bar with its value and as a pin with its percentage. Row height follows the panel height:
 * the table fills its panel and never scrolls.
 */
export function StatementTable({ lines, expanded, onToggle, marked, pyLabel = 'PY' }: Props) {
  const { currentCode, comparison, selection, select } = useFinance();
  const [ref, size] = useSize<HTMLDivElement>();
  const rowH = Math.max(MIN_ROW, Math.min(MAX_ROW, Math.floor((size.height - HEAD) / Math.max(1, lines.length))));
  const font = rowH >= 22 ? 13 : rowH >= 20 ? 12 : 11;

  const delta = (l: Line) => (comparison === 'PL' ? l.dPl : l.dPy);
  const relative = (l: Line) => (comparison === 'PL' ? l.rPl : l.rPy);
  const absMax = useMemo(() => Math.max(1, ...lines.filter((l) => !l.isKpi).map((l) => Math.abs(delta(l) ?? 0))), [lines, comparison]); // eslint-disable-line react-hooks/exhaustive-deps
  const relMax = useMemo(() => relCap(lines.map(relative)), [lines, comparison]); // eslint-disable-line react-hooks/exhaustive-deps

  const barW = Math.max(50, Math.min(130, Math.floor(size.width * 0.12)));
  const pinW = Math.max(44, Math.min(90, Math.floor(size.width * 0.08)));
  const hatched = currentCode !== 'AC';

  return (
    <div ref={ref} className="panel h-full">
      <table className="w-full table-fixed border-collapse" style={{ fontSize: font }}>
        <colgroup>
          <col />
          <col style={{ width: 70 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: barW + 8 }} />
          <col style={{ width: 62 }} />
          <col style={{ width: pinW + 8 }} />
          <col style={{ width: 60 }} />
        </colgroup>
        <thead>
          <tr style={{ height: HEAD }} className="border-b-2 border-ink text-[11px] uppercase text-muted">
            <th className="text-left font-semibold">kEUR</th>
            <th className="num px-2">
              <ScenarioLabel s="PL" />
            </th>
            <th className="num px-2">
              <ScenarioLabel s="PY">{pyLabel}</ScenarioLabel>
            </th>
            <th className="num px-2">
              <ScenarioLabel s={currentCode} />
            </th>
            <th className="num px-2" colSpan={2}>
              Δ{comparison}
            </th>
            <th className="num px-2" colSpan={2}>
              Δ{comparison}%
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const a = l.account;
            const strong = a.rowType !== 'Account' && a.rowType !== 'KPI';
            const total = a.rowType === 'Formula' || a.parentId === null;
            const d = delta(l);
            const tone = toneOf(d, l.goodUp);
            const r = relative(l);
            const isSel = selection?.accountId === a.id && selection.statement === a.statement;
            const canExpand = l.hasChildren && onToggle;
            return (
              <tr
                key={a.id}
                style={{ height: rowH }}
                className={`cursor-pointer ${total && a.rowType !== 'KPI' ? 'border-t border-ink' : ''} ${isSel ? 'bg-select' : 'hover:bg-soft'}`}
                onClick={() => select({ statement: a.statement, accountId: a.id })}
                aria-selected={isSel}
              >
                <td className={`truncate pr-2 ${strong ? 'font-semibold' : ''} ${a.rowType === 'KPI' ? 'italic text-muted' : ''}`} style={{ paddingLeft: 4 + l.depth * 14 }} title={a.name}>
                  {canExpand ? (
                    <button
                      type="button"
                      className="mr-1 inline-block w-3 text-muted"
                      aria-label={expanded.has(a.id) ? `Collapse ${a.name}` : `Expand ${a.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(a.id);
                      }}
                    >
                      {expanded.has(a.id) ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="mr-1 inline-block w-3" />
                  )}
                  {a.name}
                  {marked.has(a.id) && <span className="ml-1 text-[10px] text-muted" title="Comments or adjustments">●</span>}
                </td>
                <td className="num px-2">{l.isKpi ? fmtPct(l.pl) : fmtK(l.pl)}</td>
                <td className="num px-2 text-muted">{l.isKpi ? fmtPct(l.py) : fmtK(l.py)}</td>
                <td className={`num px-2 ${strong ? 'font-semibold' : ''}`}>{l.isKpi ? fmtPct(l.cur) : fmtK(l.cur)}</td>
                <td className="px-1" style={{ width: barW }}>
                  {!l.isKpi && <VarianceBar value={d} max={absMax} width={barW} tone={tone} hatched={hatched} />}
                </td>
                <td className="num w-[64px] pr-2">
                  {l.isKpi ? fmtDeltaPp(d) : fmtDeltaK(d)}
                </td>
                <td className="px-1" style={{ width: pinW }}>
                  {!l.isKpi && <VariancePin value={r} max={relMax} width={pinW} tone={tone} minuend={currentCode} />}
                </td>
                <td className="num w-[58px] pr-1 text-muted">{fmtDeltaPct(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
