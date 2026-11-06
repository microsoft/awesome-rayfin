import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';

import type { Line, Mode, PnlModel } from '@finance/lib/pnl/engine';
import {
  deltaClass,
  fmtDelta,
  fmtDeltaPct,
  fmtDeltaPp,
  fmtPct,
  fmtValue,
  relDelta,
  type Unit,
} from '@finance/lib/pnl/format';
import { cn } from '@finance/lib/utils';

import { ScenarioLabel, VarianceBar, VariancePin } from './ibcs';

interface Props {
  model: PnlModel;
  mode: Mode;
  unit: Unit;
  simActive: boolean;
  selectedLine: string;
  onSelectLine: (id: string) => void;
  /** Extra controls in the tile header (the switch to the original visual). */
  toolbar?: ReactNode;
}

interface VisibleRow {
  line: Line;
  hasKids: boolean;
}

/** IBCS income statement: scenarios as columns, variances as integrated bars and pins. */
export function PnlTable({ model, mode, unit, simActive, selectedLine, onSelectLine, toolbar }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const rows: VisibleRow[] = useMemo(() => {
    const out: VisibleRow[] = [];
    const walk = (id: string) => {
      const l = model.lines.get(id);
      if (!l) return;
      // Hide empty branches (no values in any column) below the top level.
      if (l.depth > 0 && l.cols.base === 0 && l.cols.pl === 0 && l.cols.py === 0) return;
      out.push({ line: l, hasKids: l.children.length > 0 });
      if (open.has(id)) l.children.forEach(walk);
    };
    model.top.forEach(walk);
    return out;
  }, [model, open]);

  // One shared scale per variance column over the money rows (IBCS: same scale).
  const scale = useMemo(() => {
    let pl = 0,
      py = 0,
      sim = 0,
      plPct = 0;
    for (const { line: l } of rows) {
      if (l.isPercent || l.rowType === 'Separator') continue;
      pl = Math.max(pl, Math.abs(l.cols.base - l.cols.pl));
      py = Math.max(py, Math.abs(l.cols.base - l.cols.py));
      sim = Math.max(sim, Math.abs(l.cols.sim - l.cols.base));
      const r = relDelta(l.cols.base, l.cols.pl);
      if (Number.isFinite(r)) plPct = Math.max(plPct, Math.min(Math.abs(r), 0.5));
    }
    return { pl, py, sim, plPct };
  }, [rows]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const expandTop = () => setOpen(new Set(model.top));
  const collapseAll = () => setOpen(new Set());

  const baseLabel = mode === 'fy' ? 'ACFC' : 'AC';

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-200 border-b border-border px-400 py-300">
        <div>
          <h2 className="font-heading text-400 font-semibold">Income statement</h2>
          <p className="text-200 text-muted-foreground">
            {mode === 'fy' ? 'Fiscal year, actuals plus forecast' : 'Year to date, closed months'} · in{' '}
            {unit === 'mio' ? 'mEUR' : 'kEUR'} · costs as positive amounts
          </p>
        </div>
        <div className="flex flex-wrap gap-200">
          {toolbar}
          <button
            type="button"
            onClick={expandTop}
            className="inline-flex h-[30px] items-center gap-100 rounded-md border border-border px-300 text-200 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronsUpDown className="icon-size-100" aria-hidden="true" /> Open level 1
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex h-[30px] items-center gap-100 rounded-md border border-border px-300 text-200 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronsDownUp className="icon-size-100" aria-hidden="true" /> Collapse all
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-300">
          <thead>
            <tr className="border-b-2 border-foreground text-right align-bottom">
              <th className="sticky left-0 z-10 bg-card px-400 py-200 text-left text-200 font-medium text-muted-foreground">
                Line item
              </th>
              <th className="px-300 py-200"><ScenarioLabel s="PL" /></th>
              <th className="px-300 py-200"><ScenarioLabel s="PY" /></th>
              <th className="px-300 py-200"><ScenarioLabel s={baseLabel} /></th>
              <th className="px-300 py-200 text-center" colSpan={2}><span className="font-monospace text-100 font-medium">ΔPL</span></th>
              <th className="px-300 py-200 text-center"><span className="font-monospace text-100 font-medium">ΔPL %</span></th>
              <th className="px-300 py-200 text-center" colSpan={2}><span className="font-monospace text-100 font-medium">ΔPY</span></th>
              {simActive && (
                <>
                  <th className="border-l border-border bg-warm/5 px-300 py-200"><ScenarioLabel s="SIM" /></th>
                  <th className="bg-warm/5 px-300 py-200 text-center" colSpan={2}>
                    <span className="font-monospace text-100 font-medium text-sim">ΔSIM</span>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line: l, hasKids }) => (
              <Row
                key={l.id}
                l={l}
                unit={unit}
                hasKids={hasKids}
                isOpen={open.has(l.id)}
                onToggle={() => toggle(l.id)}
                simActive={simActive}
                scale={scale}
                selected={l.id === selectedLine}
                onSelect={() => onSelectLine(l.id)}
                baseLabel={baseLabel}
              />
            ))}
          </tbody>
        </table>
      </div>
      {model.unassigned.accounts > 0 && (
        <p className="border-t border-border px-400 py-200 text-200 text-muted-foreground">
          Note: {model.unassigned.accounts} accounts with a total of {fmtValue(model.unassigned.base, unit)}{' '}
          {unit === 'mio' ? 'mEUR' : 'kEUR'} are not assigned to any P&amp;L line in the account tree and are missing from the totals.
        </p>
      )}
    </div>
  );
}

function Row({
  l,
  unit,
  hasKids,
  isOpen,
  onToggle,
  simActive,
  scale,
  selected,
  onSelect,
  baseLabel,
}: {
  l: Line;
  unit: Unit;
  hasKids: boolean;
  isOpen: boolean;
  onToggle: () => void;
  simActive: boolean;
  scale: { pl: number; py: number; sim: number; plPct: number };
  selected: boolean;
  onSelect: () => void;
  /** Scenario of the base column: the pin heads are drawn in its notation. */
  baseLabel: 'AC' | 'ACFC';
}) {
  if (l.rowType === 'Separator') {
    return (
      <tr aria-hidden="true">
        <td colSpan={simActive ? 12 : 9} className="h-300" />
      </tr>
    );
  }
  const isTop = l.depth === 0;
  const isFormula = l.rowType === 'Formula';
  const isKpi = l.rowType === 'KPI';
  const ds = l.displaySign;
  const show = (v: number) => (isKpi ? fmtPct(v) : fmtValue(ds * v, unit));
  const dPl = l.cols.base - l.cols.pl;
  const dPy = l.cols.base - l.cols.py;
  const dSim = l.cols.sim - l.cols.base;
  const showDelta = (v: number) => (isKpi ? fmtDeltaPp(v) : fmtDelta(ds * v, unit));
  const rel = relDelta(l.cols.base, l.cols.pl);
  const selectable = isTop && !isKpi;

  return (
    <Fragment>
      <tr
        className={cn(
          'border-b border-border/70 text-right tabular hover:bg-hover',
          isFormula && 'border-t-2 border-t-foreground font-semibold',
          isKpi && 'text-200 italic text-muted-foreground',
          isTop && !isFormula && !isKpi && 'font-medium',
          selected && 'bg-accent/50'
        )}
      >
        <td className={cn('sticky left-0 z-10 px-400 py-200 text-left', selected ? 'bg-accent' : 'bg-card')}>
          <div className="flex items-center gap-100" style={{ paddingLeft: l.depth * 14 }}>
            {hasKids ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${l.name}`}
                onClick={onToggle}
                className="rounded-sm p-100-nudge text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronRight className={cn('icon-size-100 transition-transform', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="inline-block w-[18px]" />
            )}
            {selectable ? (
              <button
                type="button"
                onClick={onSelect}
                title="Show in the monthly trend"
                className={cn(
                  'truncate text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring',
                  selected && 'text-primary'
                )}
              >
                {l.name}
              </button>
            ) : (
              <span className={cn('truncate', l.depth >= 4 && 'text-muted-foreground')}>{l.name}</span>
            )}
          </div>
        </td>
        <td className="px-300 py-200">{show(l.cols.pl)}</td>
        <td className="px-300 py-200 text-muted-foreground">{show(l.cols.py)}</td>
        <td className="px-300 py-200 font-semibold">{show(l.cols.base)}</td>
        <td className={cn('px-200 py-200', deltaClass(dPl))}>{showDelta(dPl)}</td>
        <td className="px-200 py-200">{!isKpi && <VarianceBar value={ds * dPl} good={dPl >= 0} max={scale.pl} />}</td>
        <td className="px-200 py-200">
          {!isKpi && (
            <div className="flex items-center justify-end gap-200">
              <span className={cn('text-200', deltaClass(rel))}>{fmtDeltaPct(ds * rel)}</span>
              <VariancePin value={ds * rel} good={rel >= 0} max={scale.plPct} width={56} minuend={baseLabel} />
            </div>
          )}
        </td>
        <td className={cn('px-200 py-200', deltaClass(dPy))}>{showDelta(dPy)}</td>
        <td className="px-200 py-200">{!isKpi && <VarianceBar value={ds * dPy} good={dPy >= 0} max={scale.py} width={70} />}</td>
        {simActive && (
          <>
            <td className="border-l border-border bg-warm/5 px-300 py-200 font-semibold text-sim">{show(l.cols.sim)}</td>
            <td className={cn('bg-warm/5 px-200 py-200', deltaClass(dSim))}>{showDelta(dSim)}</td>
            <td className="bg-warm/5 px-200 py-200">{!isKpi && <VarianceBar value={ds * dSim} good={dSim >= 0} max={scale.sim} width={70} />}</td>
          </>
        )}
      </tr>
    </Fragment>
  );
}
