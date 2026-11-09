// MockupKitchen filter panel (right, 300 px at Full HD): period, comparison,
// plan and forecast versions, market and product filters, share link.

import { Check, Link2, RotateCcw, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { ScenarioSwatch } from '@finance/components/ibcs/Ibcs';
import { Switch } from '@finance/components/Tile';
import { useCockpit } from '@finance/hooks/cockpit.context';
import type { FcVersion, PlanVersion, RefScen } from '@finance/lib/cockpit/cube';
import { MONTH_SHORT } from '@finance/lib/cockpit/format';
import type { PeriodKind } from '@finance/lib/cockpit/view';
import { cn } from '@finance/lib/utils';

export function FilterPanel() {
  const { cube, view, setView, scenName } = useCockpit();
  const [copied, setCopied] = useState(false);

  const regions = [...new Set(cube.markets.map((m) => m.region))];
  const categories = [...new Set(cube.products.map((p) => p.kategorie))];
  const hasFilter = view.markets.length > 0 || view.products.length > 0;

  const toggle = (list: 'markets' | 'products', names: string[]) => {
    const cur = new Set(view[list]);
    const allIn = names.every((n) => cur.has(n));
    for (const n of names) {
      if (allIn) cur.delete(n);
      else cur.add(n);
    }
    setView({ [list]: [...cur] });
  };

  return (
    <aside aria-label="Filter" className="flex flex-col gap-400 rounded-xl bg-secondary p-400">
      <Section title="Period">
        <Switch<PeriodKind>
          label="Period"
          value={view.period}
          onChange={(period) => setView({ period, month: period === 'month' && !view.month ? cube.lastAc : view.month })}
          options={[
            { id: 'ytd', label: 'YTD', title: `Jan..${MONTH_SHORT[cube.lastAc - 1]} ${cube.year}` },
            { id: 'fy', label: 'Year', title: `Full year ${cube.year}, actuals + forecast` },
            { id: 'month', label: 'Month' },
          ]}
        />
        {view.period === 'month' && (
          <div className="mt-200 grid grid-cols-6 gap-100" role="radiogroup" aria-label="Month">
            {MONTH_SHORT.map((m, i) => {
              const mm = i + 1;
              const on = (view.month || cube.lastAc) === mm;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setView({ month: mm })}
                  title={mm <= cube.lastAc ? 'Actual' : 'Forecast'}
                  className={cn(
                    'rounded-sm py-100 text-100 font-medium focus-visible:outline-2 focus-visible:outline-ring',
                    on ? 'bg-foreground text-background' : 'bg-card hover:bg-accent',
                    mm > cube.lastAc && !on && 'text-muted-foreground italic'
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-200 text-100 text-muted-foreground">
          Actuals to {MONTH_SHORT[cube.lastAc - 1]} {cube.year}, forecast after that.
        </p>
      </Section>

      <Section title="Compare with">
        <Switch<RefScen>
          label="Reference scenario"
          value={view.ref}
          onChange={(ref) => setView({ ref })}
          options={[
            { id: 'PY', label: 'Prior year' },
            { id: 'PL', label: 'Plan' },
            { id: 'FC', label: 'Forecast' },
          ]}
        />
      </Section>

      <Section title="Versions">
        <Version
          code="PL"
          label="Plan"
          value={view.plan}
          options={(['PL1', 'PL2'] as PlanVersion[]).map((id) => ({ id, name: cube.scenarioNames[id] ?? id }))}
          onChange={(plan) => setView({ plan: plan as PlanVersion })}
        />
        <Version
          code="FC"
          label="Forecast"
          value={view.fc}
          options={(['FC3', 'FC2', 'FC1'] as FcVersion[]).map((id) => ({ id, name: cube.scenarioNames[id] ?? id }))}
          onChange={(fc) => setView({ fc: fc as FcVersion })}
        />
        <p className="text-100 text-muted-foreground">Active: {scenName('PL')} · {scenName('FC')}</p>
      </Section>

      <Section title="Districts" count={view.markets.length} onClear={() => setView({ markets: [] })}>
        {regions.map((r) => {
          const lands = cube.markets.filter((m) => m.region === r).map((m) => m.land);
          return (
            <div key={r} className="mb-200">
              <CheckRow label={r} strong checked={lands.every((l) => view.markets.includes(l))} partial={lands.some((l) => view.markets.includes(l))} onClick={() => toggle('markets', lands)} />
              <div className="ml-400 grid grid-cols-2 gap-x-200">
                {lands.map((l) => (
                  <CheckRow key={l} label={l} checked={view.markets.includes(l)} onClick={() => toggle('markets', [l])} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Categories" count={view.products.length} onClear={() => setView({ products: [] })}>
        {categories.map((c) => {
          const prods = cube.products.filter((p) => p.kategorie === c).map((p) => p.produkt);
          return (
            <div key={c} className="mb-200">
              <CheckRow label={c} strong checked={prods.every((p) => view.products.includes(p))} partial={prods.some((p) => view.products.includes(p))} onClick={() => toggle('products', prods)} />
              <div className="ml-400">
                {prods.map((p) => (
                  <CheckRow key={p} label={p} checked={view.products.includes(p)} onClick={() => toggle('products', [p])} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <div className="flex flex-col gap-200">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              window.prompt('Copy link:', window.location.href);
            }
          }}
          className="inline-flex h-[36px] w-full items-center justify-center gap-200 rounded-md bg-primary text-300 font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Link2 className="icon-size-200" aria-hidden="true" /> {copied ? 'Link copied' : 'Share this view'}
        </button>
        <button
          type="button"
          disabled={!hasFilter}
          onClick={() => setView({ markets: [], products: [] })}
          className="inline-flex h-[32px] w-full items-center justify-center gap-200 rounded-md border border-input bg-card text-200 font-medium hover:bg-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <RotateCcw className="icon-size-100" aria-hidden="true" /> Clear all filters
        </button>
      </div>
    </aside>
  );
}

function Section({ title, count, onClear, children }: { title: string; count?: number; onClear?: () => void; children: ReactNode }) {
  return (
    <section>
      <div className="mb-200 flex items-center justify-between">
        <h3 className="font-monospace text-100 font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
          {count ? <span className="ml-100 rounded-full bg-primary px-200-nudge text-primary-foreground">{count}</span> : null}
        </h3>
        {count && onClear ? (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-100 text-100 text-muted-foreground hover:text-foreground">
            <X className="icon-size-100" aria-hidden="true" /> clear
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Version({
  code,
  label,
  value,
  options,
  onChange,
}: {
  code: 'PL' | 'FC';
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="mb-200 flex items-center gap-200 text-200">
      <ScenarioSwatch code={code} />
      <span className="w-[64px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[30px] min-w-0 flex-1 rounded-md border border-input bg-card px-200 text-200 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.id} · {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckRow({ label, checked, partial, strong, onClick }: { label: string; checked: boolean; partial?: boolean; strong?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked ? true : partial ? 'mixed' : false}
      onClick={onClick}
      className="flex w-full items-center gap-200 rounded-sm py-[3px] text-left text-200 hover:bg-card focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        className={cn(
          'flex size-[14px] shrink-0 items-center justify-center rounded-sm border',
          checked ? 'border-primary bg-primary text-primary-foreground' : partial ? 'border-primary bg-accent' : 'border-input bg-card'
        )}
        aria-hidden="true"
      >
        {checked && <Check className="size-[10px]" strokeWidth={3} />}
      </span>
      <span className={cn('truncate', strong && 'font-semibold')}>{label}</span>
    </button>
  );
}
