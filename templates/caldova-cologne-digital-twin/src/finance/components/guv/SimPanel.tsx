import { Info, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  VOLUME_ELASTICITY,
  type BridgeStep,
  type DivisionLever,
  type PnlModel,
  type SimParams,
} from '@finance/lib/pnl/engine';
import { deltaClass, fmtDelta, fmtValue, type Unit } from '@finance/lib/pnl/format';
import { cn } from '@finance/lib/utils';

import { ScenarioLabel } from './ibcs';

interface Props {
  model: PnlModel;
  sim: SimParams;
  onChange: (s: SimParams) => void;
  onReset: () => void;
  steps: BridgeStep[];
  unit: Unit;
  simActive: boolean;
  enabled: boolean;
  hasOpenMonths: boolean;
  openFrom: string;
  opexBlocks: string[];
  baseTaxRate: number;
}

export function SimPanel({
  model,
  sim,
  onChange,
  onReset,
  steps,
  unit,
  simActive,
  enabled,
  hasOpenMonths,
  openFrom,
}: Props) {
  const setDiv = (d: string, patch: Partial<DivisionLever>) =>
    onChange({
      ...sim,
      divisions: {
        ...sim.divisions,
        [d]: { price: sim.divisions[d]?.price ?? 0, volume: sim.divisions[d]?.volume ?? 0, ...patch },
      },
    });

  if (!enabled) {
    return (
      <aside className="rounded-lg border border-border bg-card p-400">
        <h2 className="font-heading text-400 font-semibold">Simulation</h2>
        <p className="mt-200 text-300 text-muted-foreground">
          The simulation works on the fiscal year. Switch to "Fiscal year" above and every lever is
          available.
        </p>
      </aside>
    );
  }

  return (
    <aside aria-label="Simulation" className="flex flex-col gap-300">
      <section className="rounded-lg border border-border bg-card p-400">
        <div className="flex items-start justify-between gap-200">
          <div>
            <h2 className="font-heading text-400 font-semibold">What if…</h2>
            <p className="text-200 text-muted-foreground">Levers work through to net income and every margin.</p>
          </div>
          <ScenarioLabel s="SIM" />
        </div>

        <div className="mt-300 flex rounded-md bg-muted p-100" role="radiogroup" aria-label="Period of effect">
          <ScopeBtn active={sim.scope === 'ytg'} disabled={!hasOpenMonths} onClick={() => onChange({ ...sim, scope: 'ytg' })}>
            Rest of year{hasOpenMonths ? ` from ${openFrom}` : ''}
          </ScopeBtn>
          <ScopeBtn active={sim.scope === 'fy' || !hasOpenMonths} onClick={() => onChange({ ...sim, scope: 'fy' })}>
            Whole year
          </ScopeBtn>
        </div>

        <Group title="Revenue by category" hint="Price moves net revenue, volume pulls cost of goods sold along.">
          {model.divisions.map((d) => (
            <div key={d} className="rounded-md border border-border p-200">
              <div className="text-200 font-medium">{d}</div>
              <Lever label="Price" value={sim.divisions[d]?.price ?? 0} min={-15} max={15} step={0.5} unit="%" onChange={(v) => setDiv(d, { price: v })} />
              <Lever label="Volume" value={sim.divisions[d]?.volume ?? 0} min={-25} max={25} step={0.5} unit="%" onChange={(v) => setDiv(d, { volume: v })} />
            </div>
          ))}
        </Group>

        {/* Caldova (decision 2026-10-20): only the volume and price levers. Cost, interest and tax levers of the
            cockpit stay in the engine at 0 and are not offered. */}

        <div className="mt-400 flex gap-200">
          <button
            type="button"
            onClick={onReset}
            disabled={!simActive}
            className="inline-flex h-[34px] flex-1 items-center justify-center gap-100 rounded-md border border-border text-200 font-medium hover:bg-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RotateCcw className="icon-size-100" aria-hidden="true" /> Reset
          </button>
        </div>
      </section>

      <Bridge steps={steps} unit={unit} active={simActive} />

      <details className="rounded-lg border border-border bg-card p-400 text-200 text-muted-foreground">
        <summary className="flex cursor-pointer items-center gap-100 font-medium text-foreground">
          <Info className="icon-size-100" aria-hidden="true" /> Simulation assumptions
        </summary>
        <ul className="mt-200 list-disc space-y-100 pl-400">
          <li>The base is AC+FC. With "Rest of year" the actual months stay unchanged and the levers act on the forecast only.</li>
          <li>
            Volume acts per category on revenue and cost of goods sold (merchandise at {VOLUME_ELASTICITY.Merchandise * 100}%); logistics, personnel and
            premises stay unchanged in the simulation.
          </li>
          <li>Price acts on revenue only, including sales deductions (pharmacy discounts).</li>
          <li>Taxes follow the simulated EBT at the base's effective tax rate.</li>
        </ul>
      </details>
    </aside>
  );
}

function ScopeBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-sm px-200 py-100 text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40',
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="mt-400 space-y-200">
      <legend className="font-monospace text-100 font-medium uppercase tracking-wide text-muted-foreground">{title}</legend>
      {hint && <p className="text-100 text-muted-foreground">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Lever({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const id = `lever-${label.replace(/\W+/g, '-')}-${min}`;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-200">
      <label htmlFor={id} className="truncate text-200">
        {label}
      </label>
      <span className={cn('font-monospace text-200 tabular', value ? 'font-semibold text-sim' : 'text-muted-foreground')}>
        {value > 0 ? '+' : value < 0 ? '−' : ''}
        {Math.abs(value).toLocaleString('en-GB', { maximumFractionDigits: 1 })}{unit}
      </span>
      <input
        id={id}
        type="range"
        className="lever col-span-2 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        title="Double-click resets to 0"
      />
    </div>
  );
}

/** Net income bridge from base to simulation (horizontal IBCS waterfall). */
function Bridge({ steps, unit, active }: { steps: BridgeStep[]; unit: Unit; active: boolean }) {
  if (steps.length === 0) return null;
  const base = steps[0].value;
  const end = steps[steps.length - 1].value;
  // Running positions for the floating bars (cumulative sum before each step).
  const rows = steps.map((s, i) => {
    if (i === 0 || i === steps.length - 1) return { ...s, from: 0, to: s.value, total: true };
    const from = steps.slice(0, i).reduce((a, x) => a + x.value, 0);
    return { ...s, from, to: from + s.value, total: false };
  });
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(...rows.map((r) => Math.max(r.from, r.to)));
  // Zoom on the moving part: start the axis below the smaller total.
  const axisLo = Math.max(lo, Math.min(base, end) * 0.85);
  const span = hi - axisLo || 1;
  const W = 300;
  const x = (v: number) => ((Math.max(v, axisLo) - axisLo) / span) * W;

  return (
    <section className="rounded-lg border border-border bg-card p-400">
      <h2 className="font-heading text-300 font-semibold">Net income bridge</h2>
      <p className="text-200 text-muted-foreground">
        Base AC+FC to simulation · in {unit === 'mio' ? 'mEUR' : 'kEUR'}
        {!active && ' · move a lever'}
      </p>
      <div className="mt-300 space-y-100">
        {rows.map((r) => {
          const left = x(Math.min(r.from, r.to));
          const width = Math.max(1, Math.abs(x(r.to) - x(r.from)));
          const good = r.value >= 0;
          return (
            <div key={r.key} className="grid grid-cols-[84px_1fr_64px] items-center gap-200 text-200">
              <span className={cn('truncate', r.total ? 'font-semibold' : 'text-muted-foreground')}>{r.label}</span>
              <div className="relative h-[14px]">
                <div
                  className={cn(
                    'absolute top-0 h-full',
                    r.key === 'base' && 'bg-ac',
                    r.key === 'sim' && 'hatch-sim border border-sim',
                    !r.total && (good ? 'bg-good' : 'bg-bad')
                  )}
                  style={{ left: `${(left / W) * 100}%`, width: `${(width / W) * 100}%` }}
                />
              </div>
              <span className={cn('text-right tabular', r.total ? 'font-semibold' : deltaClass(r.value))}>
                {r.total ? fmtValue(r.value, unit) : fmtDelta(r.value, unit)}
              </span>
            </div>
          );
        })}
      </div>
      {axisLo > 0 && <p className="mt-200 text-100 text-muted-foreground">Axis starts at {fmtValue(axisLo, unit)} (truncated).</p>}
    </section>
  );
}
