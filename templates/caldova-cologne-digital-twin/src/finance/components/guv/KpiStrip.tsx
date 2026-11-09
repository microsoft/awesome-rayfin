import type { Line, Mode, PnlModel } from '@finance/lib/pnl/engine';
import { deltaClass, fmtDelta, fmtDeltaPct, fmtPct, fmtValue, relDelta, type Unit } from '@finance/lib/pnl/format';
import { cn } from '@finance/lib/utils';

import { ScenarioMark } from './ibcs';

// Caldova P&L line names (tools/data/generate_finance.py), see lib/pnl/engine.ts.
const CARDS: { line: string; margin?: string }[] = [
  { line: 'Revenue' },
  { line: 'Gross profit', margin: 'Gross margin %' },
  { line: 'EBITDA', margin: 'EBITDA margin %' },
  { line: 'EBIT' },
  { line: 'Net income', margin: 'Return on sales %' },
];

const LABEL: Record<string, string> = {
  Revenue: 'Revenue',
  'Gross profit': 'Gross profit',
  EBITDA: 'EBITDA',
  EBIT: 'EBIT',
  'Net income': 'Net income',
};

export function KpiStrip({
  model,
  mode,
  unit,
  simActive,
}: {
  model: PnlModel;
  mode: Mode;
  unit: Unit;
  simActive: boolean;
}) {
  const byName = new Map<string, Line>();
  for (const l of model.lines.values()) if (l.depth === 0) byName.set(l.name, l);
  return (
    <div className="grid grid-cols-2 gap-300 md:grid-cols-3 xl:grid-cols-5">
      {CARDS.map(({ line, margin }) => {
        const l = byName.get(line);
        if (!l) return null;
        const m = margin ? byName.get(margin) : undefined;
        return <Card key={line} label={LABEL[line] ?? line} l={l} margin={m} mode={mode} unit={unit} simActive={simActive} />;
      })}
    </div>
  );
}

function Card({
  label,
  l,
  margin,
  mode,
  unit,
  simActive,
}: {
  label: string;
  l: Line;
  margin?: Line;
  mode: Mode;
  unit: Unit;
  simActive: boolean;
}) {
  const v = l.cols.base;
  const dPl = v - l.cols.pl;
  const dPy = v - l.cols.py;
  const dSim = l.cols.sim - v;
  const max = Math.max(Math.abs(v), Math.abs(l.cols.pl), Math.abs(l.cols.py), Math.abs(l.cols.sim), 1);
  const w = (x: number) => `${(Math.abs(x) / max) * 100}%`;
  return (
    <article className="flex flex-col rounded-lg border border-border bg-card p-300">
      <div className="flex items-baseline justify-between gap-200">
        <h3 className="text-200 font-medium text-muted-foreground">{label}</h3>
        {margin && <span className="font-monospace text-100 text-muted-foreground">{fmtPct(margin.cols.base)}</span>}
      </div>
      <div className="mt-100 flex items-baseline gap-200">
        <span className="font-numeric text-hero-700 leading-hero-700 font-semibold tabular">{fmtValue(v, unit)}</span>
        <span className="font-monospace text-100 text-muted-foreground">{mode === 'fy' ? 'AC+FC' : 'AC'}</span>
      </div>
      {/* IBCS mini bars: PY, PL, AC+FC (and SIM) on one scale */}
      <div className="mt-200 space-y-100" aria-hidden="true">
        <div className="h-[5px] bg-py" style={{ width: w(l.cols.py) }} />
        <div className="h-[5px] border border-pl" style={{ width: w(l.cols.pl) }} />
        <div className={cn('h-[7px]', mode === 'fy' ? 'flex overflow-hidden' : 'bg-ac')} style={{ width: w(v) }}>
          {mode === 'fy' && v !== 0 && (
            <>
              {/* Actual months solid, forecast months hatched (real split) */}
              <span className="h-full bg-ac" style={{ width: `${Math.min(100, (l.cols.ac / v) * 100)}%` }} />
              <span className="hatch h-full flex-1 border border-fc" />
            </>
          )}
        </div>
        {simActive && <div className="hatch-sim h-[5px] border border-sim" style={{ width: w(l.cols.sim) }} />}
      </div>
      <dl className="mt-200 grid grid-cols-[auto_1fr] gap-x-200 text-200 tabular">
        <dt className="flex items-center gap-100 text-muted-foreground"><ScenarioMark s="PL" />ΔPL</dt>
        <dd className={cn('text-right', deltaClass(dPl))}>
          {fmtDelta(dPl, unit)} <span className="text-100">({fmtDeltaPct(relDelta(v, l.cols.pl))})</span>
        </dd>
        <dt className="flex items-center gap-100 text-muted-foreground"><ScenarioMark s="PY" />ΔPY</dt>
        <dd className={cn('text-right', deltaClass(dPy))}>
          {fmtDelta(dPy, unit)} <span className="text-100">({fmtDeltaPct(relDelta(v, l.cols.py))})</span>
        </dd>
        {simActive && (
          <>
            <dt className="flex items-center gap-100 text-sim"><ScenarioMark s="SIM" />SIM</dt>
            <dd className="text-right">
              <span className="font-semibold text-sim">{fmtValue(l.cols.sim, unit)}</span>{' '}
              <span className={cn('text-100', deltaClass(dSim))}>{fmtDelta(dSim, unit)}</span>
            </dd>
          </>
        )}
      </dl>
    </article>
  );
}
