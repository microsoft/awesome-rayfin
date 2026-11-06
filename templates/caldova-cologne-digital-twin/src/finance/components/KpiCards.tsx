// KPI card row (MockupKitchen "kpi" tiles, ChartKitchen IBCS card):
// status accent, hero value, Δ pill vs the chosen reference, reference rows
// with pins on one shared scale, and a 12-month sparkline. Click = select KPI.

import { useId, useMemo } from 'react';

import { IbcsDefs, PinHead, VariancePill } from '@finance/components/ibcs/Ibcs';
import { useCockpit } from '@finance/hooks/cockpit.context';
import type { RefScen } from '@finance/lib/cockpit/cube';
import { fmt, fmtDelta, fmtRel, relDelta, unitLabel } from '@finance/lib/cockpit/format';
import { C, relCap } from '@finance/lib/cockpit/ibcs';
import { favourable, HEADLINE, type KpiDef } from '@finance/lib/cockpit/kpis';
import { cn } from '@finance/lib/utils';

const REFS: RefScen[] = ['PL', 'PY', 'FC'];

export function KpiCards() {
  const { catalogue, value } = useCockpit();
  const cards = HEADLINE.map((id) => catalogue.find((k) => k.id === id)).filter((k): k is KpiDef => !!k);

  // One pin scale for all cards (IBCS: same scale), capped against outliers.
  const scale = useMemo(() => {
    const rel: number[] = [];
    for (const k of cards) {
      const a = value(k, 'ACT');
      for (const r of REFS) rel.push(favourable(k, relDelta(a, value(k, r))));
    }
    return relCap(rel);
  }, [cards, value]);

  return (
    <div className="grid grid-cols-2 gap-[18px] md:grid-cols-4 min-[1800px]:grid-cols-7" data-testid="fin-kpi-cards">
      {cards.map((k) => (
        <KpiCard key={k.id} kpi={k} scale={scale} />
      ))}
    </div>
  );
}

function KpiCard({ kpi, scale }: { kpi: KpiDef; scale: number }) {
  const { view, setView, value, primary, scenName } = useCockpit();
  const uid = useId().replace(/:/g, '');
  const selected = view.kpi === kpi.id;
  const a = value(kpi, 'ACT');
  const ref = value(kpi, view.ref);
  const rel = relDelta(a, ref);
  const good = favourable(kpi, a - ref) >= 0;
  const hasDelta = Number.isFinite(a) && Number.isFinite(ref);

  return (
    <button
      type="button"
      onClick={() => setView({ kpi: kpi.id })}
      aria-pressed={selected}
      className={cn(
        'tile relative overflow-hidden p-300 pl-400 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring',
        selected && 'ring-2 ring-primary'
      )}
    >
      <svg width={0} height={0} className="absolute" aria-hidden="true">
        <IbcsDefs uid={uid} />
      </svg>
      {/* status accent in the variance colour */}
      <span
        aria-hidden="true"
        className="absolute top-[7px] bottom-[7px] left-[6px] w-[4px] rounded-full"
        style={{ background: hasDelta ? (good ? C.good : C.bad) : 'var(--color-border)' }}
      />
      <div className="flex items-start justify-between gap-200">
        <div className="min-w-0">
          <div className="truncate text-100 font-semibold tracking-[0.06em] text-muted-foreground uppercase">{kpi.label}</div>
          <div className="text-100 text-muted-foreground">
            {unitLabel(kpi)} · {primary}
          </div>
        </div>
        {hasDelta && (
          <span className="shrink-0 whitespace-nowrap">
            <VariancePill value={rel} good={good}>
              {kpi.unit === 'pct' ? fmtDelta(kpi, a - ref) : fmtRel(rel)}
            </VariancePill>
          </span>
        )}
      </div>
      <div className="mt-100 flex items-end justify-between gap-200">
        <span
          className="font-numeric text-hero-700 leading-hero-700 font-bold tabular"
          style={{ color: primary === 'FC' ? C.fcInk : undefined }}
        >
          {fmt(kpi, a)}
        </span>
        <Sparkline kpi={kpi} uid={uid} good={good} />
      </div>
      <div className="mt-200 space-y-100">
        {REFS.map((r) => {
          const rv = value(kpi, r);
          const d = a - rv;
          const rr = relDelta(a, rv);
          const g = favourable(kpi, d) >= 0;
          return (
            <div
              key={r}
              className={cn('grid grid-cols-[34px_1fr_56px] items-center gap-200 text-200', r === view.ref && 'font-semibold')}
              title={`${scenName(r)}: ${fmt(kpi, rv)}`}
            >
              <span className="font-monospace text-100 text-muted-foreground">Δ{r}</span>
              <MiniPin rel={rr} max={scale} good={g} minuend={primary === 'FC' ? 'FC' : 'AC'} uid={uid} refCode={r} />
              <span className="text-right tabular" style={{ color: Number.isFinite(d) ? (g ? C.good : C.bad) : undefined }}>
                {fmtDelta(kpi, d)}
              </span>
            </div>
          );
        })}
      </div>
    </button>
  );
}

/** Pin on a mini reference axis (PY light bar, PL double line, FC single line). */
function MiniPin({
  rel,
  max,
  good,
  minuend,
  uid,
  refCode,
}: {
  rel: number;
  max: number;
  good: boolean;
  minuend: 'AC' | 'FC';
  uid: string;
  refCode: RefScen;
}) {
  const W = 90;
  const half = W / 2;
  const capped = Number.isFinite(rel) && Math.abs(rel) > max;
  const len = Number.isFinite(rel) ? Math.min(half - 6, (Math.abs(rel) / (max || 1)) * (half - 6)) : 0;
  const x = rel >= 0 ? half + len : half - len;
  const col = good ? C.good : C.bad;
  return (
    <svg viewBox={`0 0 ${W} 14`} className="h-[14px] w-full" aria-hidden="true">
      {refCode === 'PY' && <line x1={half} x2={half} y1={0} y2={14} stroke={C.py} strokeWidth={3} />}
      {refCode === 'PL' && (
        <g stroke={C.ac} strokeWidth={1}>
          <line x1={half - 1.4} x2={half - 1.4} y1={0} y2={14} />
          <line x1={half + 1.4} x2={half + 1.4} y1={0} y2={14} />
        </g>
      )}
      {refCode === 'FC' && <line x1={half} x2={half} y1={0} y2={14} stroke={C.ac} strokeWidth={1.4} />}
      {Number.isFinite(rel) && (
        <>
          <line x1={half} x2={x} y1={7} y2={7} stroke={col} strokeWidth={2} />
          {capped ? (
            <path d={rel >= 0 ? `M${x},3 L${x + 6},7 L${x},11 Z` : `M${x},3 L${x - 6},7 L${x},11 Z`} fill={col} />
          ) : (
            <PinHead cx={x} cy={7} r={3.2} minuend={minuend} uid={uid} />
          )}
        </>
      )}
    </svg>
  );
}

/** 12-month sparkline: AC solid, FC dashed, PY light, end dot in the variance colour. */
function Sparkline({ kpi, uid, good }: { kpi: KpiDef; uid: string; good: boolean }) {
  const { value, cube } = useCockpit();
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const act = months.map((m) => value(kpi, 'ACT', [m]));
  const py = months.map((m) => value(kpi, 'PY', [m]));
  const all = [...act, ...py].filter(Number.isFinite);
  if (all.length < 2) return null;
  const W = 84;
  const H = 30;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const x = (i: number) => 2 + (i / 11) * (W - 6);
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const path = (vals: number[], from: number, to: number) =>
    vals
      .map((v, i) => (i >= from && i <= to && Number.isFinite(v) ? `${i === from ? 'M' : 'L'}${x(i)},${y(v)}` : ''))
      .join(' ');
  const last = cube.lastAc - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[30px] w-[84px] shrink-0" aria-hidden="true">
      <path d={path(py, 0, 11)} fill="none" stroke={C.py} strokeWidth={1.4} />
      <path d={path(act, 0, last)} fill="none" stroke={C.ac} strokeWidth={2} />
      {last < 11 && <path d={path(act, last, 11)} fill="none" stroke={C.ac} strokeWidth={1.4} strokeDasharray="3 2" />}
      {Number.isFinite(act[last]) && (
        <circle cx={x(last)} cy={y(act[last])} r={2.6} fill={good ? C.good : C.bad} data-uid={uid} />
      )}
    </svg>
  );
}
