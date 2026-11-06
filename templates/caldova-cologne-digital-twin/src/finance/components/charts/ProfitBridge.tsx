// Profit bridge (ChartKitchen horizontal waterfall): Profit in the reference
// scenario, the profit impact of each driver variance, Profit in the primary
// scenario. Independent of the selected KPI; clicking a driver selects it.

import { useId, useMemo, type KeyboardEvent } from 'react';

import { IbcsDefs, RefAxis } from '@finance/components/ibcs/Ibcs';
import { Tile } from '@finance/components/Tile';
import { useCockpit } from '@finance/hooks/cockpit.context';
import { fmt, fmtDelta, periodLabel } from '@finance/lib/cockpit/format';
import { C, makeScale, scenPaint, varPaint } from '@finance/lib/cockpit/ibcs';
import type { KpiDef } from '@finance/lib/cockpit/kpis';

/** Drivers and their sign of impact on Profit. */
// Caldova: contribution after logistics = revenue − cost of goods sold − logistics cost (generate_finance.py), so
// the bridge closes exactly.
const DRIVERS: { id: string; sign: 1 | -1 }[] = [
  { id: 'Revenue', sign: 1 },
  { id: 'COGS', sign: -1 },
  { id: 'Logistics Cost', sign: -1 },
];

const W = 520;
const ROW_H = 28;
const BAR_H = 0.58 * ROW_H;
const LABEL_W = 120;
const PAD_R = 64;
const PAD_T = 6;
const PAD_B = 6;
const FS = 10.5;

type Step =
  | { kind: 'start' | 'end'; label: string; value: number }
  | { kind: 'delta'; label: string; id: string | null; from: number; impact: number };

interface Bridge {
  profit: KpiDef;
  start: number;
  end: number;
  /** Primary profit split into closed (AC) and open (FC) months. */
  acPart: number;
  fcPart: number;
  steps: Step[];
}

const nz = (v: number) => (Number.isFinite(v) ? v : 0);

export function ProfitBridge() {
  const { cube, catalogue, view, setView, months, filter, primary, value, refCode, kpi: selected } = useCockpit();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const refC = refCode(view.ref);

  const bridge = useMemo<Bridge | null>(() => {
    const profit = catalogue.find((k) => k.id === 'Profit');
    if (!profit) return null;
    const start = value(profit, view.ref, months, filter);
    const end = value(profit, 'ACT', months, filter);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    const closed = months.filter((m) => m <= cube.lastAc);
    const open = months.filter((m) => m > cube.lastAc);
    const acPart = closed.length ? nz(value(profit, 'ACT', closed, filter)) : 0;
    const fcPart = open.length ? nz(value(profit, 'ACT', open, filter)) : 0;

    const steps: Step[] = [{ kind: 'start', label: `Result ${refC}`, value: start }];
    let cum = start;
    for (const d of DRIVERS) {
      const def = catalogue.find((k) => k.id === d.id);
      if (!def) continue;
      const delta = nz(value(def, 'ACT', months, filter)) - nz(value(def, view.ref, months, filter));
      const impact = d.sign * delta;
      steps.push({ kind: 'delta', label: def.label, id: def.id, from: cum, impact });
      cum += impact;
    }
    const residual = end - cum;
    if (Math.abs(residual) > 0.005 * Math.abs(start)) {
      steps.push({ kind: 'delta', label: 'Other', id: null, from: cum, impact: residual });
    }
    steps.push({ kind: 'end', label: `Result ${primary}`, value: end });
    return { profit, start, end, acPart, fcPart, steps };
  }, [catalogue, value, view.ref, months, filter, cube.lastAc, refC, primary]);

  const sub = `mEUR · ${refC} → ${primary} · ${periodLabel(months, cube.year)}`;
  const title = 'Profit bridge';

  if (!bridge) {
    return (
      <Tile title={title} sub={sub}>
        <p className="py-600 text-center text-300 text-muted-foreground">No result data for this selection.</p>
      </Tile>
    );
  }

  const { profit, start, end, acPart, fcPart, steps } = bridge;
  const dP = end - start;
  const deltaSteps = steps.filter((s): s is Extract<Step, { kind: 'delta' }> => s.kind === 'delta');
  const main = deltaSteps
    .filter((s) => (dP >= 0 ? s.impact > 0 : s.impact < 0))
    .reduce<Extract<Step, { kind: 'delta' }> | null>((a, b) => (!a || Math.abs(b.impact) > Math.abs(a.impact) ? b : a), null);
  const dTxt = fmtDelta(profit, dP);
  const message = dTxt.startsWith('±')
    ? `Result at ${refC} level`
    : `Result ${dTxt} mEUR ${dP > 0 ? 'above' : 'below'} ${refC}${main ? `, mainly from ${main.label}` : ''}`;

  // ---------- layout ----------
  const points = [start, end, acPart, acPart + fcPart, ...deltaSteps.flatMap((s) => [s.from, s.from + s.impact])];
  const sc = makeScale(points, [LABEL_W, W - PAD_R], 0.12);
  const H = PAD_T + steps.length * ROW_H + PAD_B;
  const yTop = (i: number) => PAD_T + i * ROW_H + (ROW_H - BAR_H) / 2;
  const span = (a: number, b: number) => ({ x: Math.min(sc(a), sc(b)), w: Math.abs(sc(b) - sc(a)) });
  const startPaint = scenPaint(refC, uid);
  const acPaint = scenPaint('AC', uid);
  const fcPaint = scenPaint('FC', uid);

  const sumBars = (isEnd: boolean, v: number, y: number) => {
    const paintRect = (from: number, to: number, p: { fill: string; stroke: string; strokeWidth: number }) => {
      const b = span(from, to);
      return <rect x={b.x} y={y} width={b.w} height={BAR_H} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />;
    };
    if (!isEnd) return paintRect(0, v, startPaint);
    if (primary === 'FC') return paintRect(0, v, fcPaint);
    if (primary === 'AC&FC')
      return (
        <>
          {paintRect(0, acPart, acPaint)}
          {paintRect(acPart, acPart + fcPart, fcPaint)}
        </>
      );
    return paintRect(0, v, acPaint);
  };

  const select = (id: string) => setView({ kpi: id });
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(id);
    }
  };

  return (
    <Tile title={title} sub={sub} message={message}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={`${title} ${refC} → ${primary}`}>
        <IbcsDefs uid={uid} />

        {/* connectors from each bar end to the next bar */}
        {steps.slice(0, -1).map((s, i) => {
          const level = s.kind === 'delta' ? s.from + s.impact : s.value;
          const x = sc(level);
          return <line key={`c${i}`} x1={x} x2={x} y1={yTop(i) + BAR_H} y2={yTop(i + 1)} stroke={C.conn} strokeWidth={1} />;
        })}

        {steps.map((s, i) => {
          const y = yTop(i);
          const yc = y + BAR_H / 2;
          if (s.kind !== 'delta') {
            const isEnd = s.kind === 'end';
            const v = s.value;
            const xr = Math.max(sc(0), sc(v));
            const xl = Math.min(sc(0), sc(v));
            const neg = v < 0;
            const bars = sumBars(isEnd, v, y);
            const tip = isEnd && primary === 'AC&FC' ? `${s.label}: ${fmt(profit, v)} mEUR (AC ${fmt(profit, acPart)} · FC ${fmt(profit, fcPart)})` : `${s.label}: ${fmt(profit, v)} mEUR`;
            return (
              <g key={s.kind}>
                <title>{tip}</title>
                <text x={LABEL_W - 8} y={yc} dy="0.35em" textAnchor="end" fontSize={11} fontWeight={700} fill={C.cat}>
                  {s.label}
                </text>
                {bars}
                <text
                  x={neg ? xl - 5 : xr + 5}
                  y={yc}
                  dy="0.35em"
                  textAnchor={neg ? 'end' : 'start'}
                  fontSize={FS}
                  fontWeight={700}
                  fill={isEnd && primary === 'FC' ? C.fcInk : C.ac}
                >
                  {fmt(profit, v)}
                </text>
              </g>
            );
          }

          const good = s.impact >= 0;
          const p = varPaint('AC', good, uid);
          const b = span(s.from, s.from + s.impact);
          const id = s.id;
          const isSel = id !== null && id === selected.id;
          const body = (
            <>
              <title>{`${s.label}: impact on result ${fmtDelta(profit, s.impact)} mEUR`}</title>
              <rect x={0} y={PAD_T + i * ROW_H} width={W} height={ROW_H} fill="transparent" />
              {isSel && <rect x={0} y={PAD_T + i * ROW_H + 4} width={3} height={ROW_H - 8} fill={C.hilite} />}
              <text x={LABEL_W - 8} y={yc} dy="0.35em" textAnchor="end" fontSize={11} fontWeight={isSel ? 700 : 400} fill={C.cat}>
                {s.label}
              </text>
              <rect x={b.x} y={y} width={Math.max(b.w, 0.5)} height={BAR_H} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
              <text x={b.x + b.w + 5} y={yc} dy="0.35em" textAnchor="start" fontSize={FS} fill={good ? C.good : C.bad}>
                {fmtDelta(profit, s.impact)}
              </text>
            </>
          );
          if (id === null) return <g key="rest">{body}</g>;
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              aria-label={`${s.label} ${fmtDelta(profit, s.impact)} mEUR. Select KPI`}
              onClick={() => select(id)}
              onKeyDown={(e) => onKey(e, id)}
              className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring"
            >
              {body}
            </g>
          );
        })}

        <RefAxis code="AC" orient="v" at={sc(0)} from={PAD_T} to={H - PAD_B} />
      </svg>
    </Tile>
  );
}
