// IBCS KPI table (ChartKitchen renderIbcsTable): all KPIs grouped, scenarios
// as columns, relative variances as pins on a shared scale per column.
// Mixed units, so absolute variances stay numbers (no bars across units).

import { Fragment, useId, useMemo } from 'react';

import { IbcsDefs, PinHead, RefAxis, ScenarioSwatch } from '@finance/components/ibcs/Ibcs';
import { Tile } from '@finance/components/Tile';
import { useCockpit } from '@finance/hooks/cockpit.context';
import type { RefScen } from '@finance/lib/cockpit/cube';
import { fmt, fmtDelta, fmtRel, periodLabel, relDelta, unitLabel } from '@finance/lib/cockpit/format';
import { C, relCap } from '@finance/lib/cockpit/ibcs';
import { favourable, type KpiDef } from '@finance/lib/cockpit/kpis';
import { cn } from '@finance/lib/utils';

const REFS: RefScen[] = ['PL', 'PY', 'FC'];

export function KpiTable() {
  const { catalogue, value, view, setView, months, cube, primary, scenName } = useCockpit();
  const uid = useId().replace(/:/g, '');

  const rows = useMemo(
    () =>
      catalogue.map((k) => {
        const a = value(k, 'ACT');
        const refs = Object.fromEntries(REFS.map((r) => [r, value(k, r)])) as Record<RefScen, number>;
        return { k, a, refs };
      }),
    [catalogue, value]
  );

  const caps = useMemo(() => {
    const out = {} as Record<RefScen, number>;
    for (const r of REFS) out[r] = relCap(rows.map((x) => favourable(x.k, relDelta(x.a, x.refs[r]))));
    return out;
  }, [rows]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = m.get(r.k.group);
      if (arr) arr.push(r);
      else m.set(r.k.group, [r]);
    }
    return [...m.entries()];
  }, [rows]);

  // Scenario order is always PL, PY, AC, FC.
  const shown: RefScen[] = view.ref === 'FC' ? ['PL', 'FC'] : ['PL', 'PY'];

  return (
    <Tile
      title="All KPIs"
      sub={`${primary} vs ${shown.join(', ')} · ${periodLabel(months, cube.year)} · click a row to select the KPI`}
    >
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <IbcsDefs uid={uid} />
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-200 tabular">
          <thead>
            <tr className="border-b-[1.2px] border-[color:var(--ibcs-ac)] align-bottom text-right">
              <th className="py-200 pr-300 text-left font-semibold">KPI</th>
              <th className="px-200 py-200 text-left font-normal text-muted-foreground">Unit</th>
              {shown.map((r) => (
                <th key={r} className="px-200 py-200 font-semibold" title={scenName(r)}>
                  <span className="inline-flex items-center gap-100">
                    <ScenarioSwatch code={r} /> {r}
                  </span>
                </th>
              ))}
              <th className="px-200 py-200 font-semibold">
                <span className="inline-flex items-center gap-100">
                  <ScenarioSwatch code={primary} /> {primary}
                </span>
              </th>
              {shown.map((r) => (
                <Fragment key={r}>
                  <th className="px-200 py-200 font-semibold">Δ{r}</th>
                  <th className="px-200 py-200 text-center font-semibold">Δ{r}%</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, items]) => (
              <Fragment key={group}>
                <tr>
                  <td colSpan={3 + shown.length * 3} className="pt-300 pb-100 text-left font-monospace text-100 font-semibold tracking-wide text-muted-foreground uppercase">
                    {group}
                  </td>
                </tr>
                {items.map(({ k, a, refs }) => (
                  <Row key={k.id} k={k} a={a} refs={refs} shown={shown} caps={caps} uid={uid} selected={view.kpi === k.id} onSelect={() => setView({ kpi: k.id })} minuend={primary === 'FC' ? 'FC' : 'AC'} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Tile>
  );
}

function Row({
  k,
  a,
  refs,
  shown,
  caps,
  uid,
  selected,
  onSelect,
  minuend,
}: {
  k: KpiDef;
  a: number;
  refs: Record<RefScen, number>;
  shown: RefScen[];
  caps: Record<RefScen, number>;
  uid: string;
  selected: boolean;
  onSelect: () => void;
  minuend: 'AC' | 'FC';
}) {
  return (
    <tr
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-selected={selected}
      className={cn(
        'cursor-pointer border-b border-border/70 text-right hover:bg-[color:var(--color-hover)] focus-visible:outline-2 focus-visible:outline-ring',
        selected && 'bg-accent/60 font-semibold'
      )}
    >
      <td className="py-[5px] pr-300 text-left">
        <span className={cn(selected && 'text-primary')}>{k.label}</span>
      </td>
      <td className="px-200 text-left text-muted-foreground">{unitLabel(k)}</td>
      {shown.map((r) => (
        <td key={r} className="px-200 text-[color:var(--ibcs-cat)]">
          {fmt(k, refs[r])}
        </td>
      ))}
      <td className="px-200 font-semibold">{fmt(k, a)}</td>
      {shown.map((r) => {
        const d = a - refs[r];
        const g = favourable(k, d) >= 0;
        const rr = relDelta(a, refs[r]);
        return (
          <Fragment key={r}>
            <td className="px-200" style={{ color: Number.isFinite(d) ? (g ? C.good : C.bad) : undefined }}>
              {fmtDelta(k, d)}
            </td>
            <td className="px-200">
              {/* direction by sign (a cost increase points right), colour by impact */}
              <PinCell rel={rr} label={fmtRel(rr)} max={caps[r]} good={g} uid={uid} minuend={minuend} refCode={r} />
            </td>
          </Fragment>
        );
      })}
    </tr>
  );
}

function PinCell({
  rel,
  label,
  max,
  good,
  uid,
  minuend,
  refCode,
}: {
  rel: number;
  label: string;
  max: number;
  good: boolean;
  uid: string;
  minuend: 'AC' | 'FC';
  refCode: RefScen;
}) {
  const W = 132;
  const half = 52;
  const reach = 40;
  const fin = Number.isFinite(rel);
  const capped = fin && Math.abs(rel) > max;
  const len = fin ? Math.min(reach, (Math.abs(rel) / (max || 1)) * reach) : 0;
  const x = rel >= 0 ? half + len : half - len;
  const col = good ? C.good : C.bad;
  return (
    <svg viewBox={`0 0 ${W} 18`} className="ml-auto h-[18px] w-[132px]" aria-label={label}>
      <RefAxis code={refCode} orient="v" at={half} from={0} to={18} />
      {fin && (
        <>
          <line x1={half} x2={x} y1={9} y2={9} stroke={col} strokeWidth={2} />
          {capped ? (
            <path d={rel >= 0 ? `M${x},5 L${x + 7},9 L${x},13 Z` : `M${x},5 L${x - 7},9 L${x},13 Z`} fill={col} />
          ) : (
            <PinHead cx={x} cy={9} r={3.6} minuend={minuend} uid={uid} />
          )}
          <text x={W - 2} y={13} textAnchor="end" fontSize={10.5} fill={col}>
            {label}
          </text>
        </>
      )}
    </svg>
  );
}
