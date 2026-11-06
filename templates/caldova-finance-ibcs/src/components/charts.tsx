import { useId } from 'react';

import { fmtDeltaK, fmtK, monthShort } from '@/domain/format';
import { useSize } from '@/hooks/useSize';

import { HatchDefs } from './ibcs';

const LABEL = 11;

/* ───────────────────────────── monthly columns ───────────────────────────── */

export interface MonthPoint {
  month: string;
  /** AC for closed months, FC after the cut-off. */
  cur?: number;
  isForecast: boolean;
  pl?: number;
  py?: number;
}

/**
 * Where each scenario's column sits in a month's group: PL, PY, then AC or FC, from LEFT TO RIGHT and from BACK TO
 * FRONT (Michael Tenner's rule, cockpit commit 5394e02). The array order is the drawing order. Every column is opaque,
 * so the hatched FC in front never shows the plan outline through it.
 */
export function columnLayout(bw: number): { code: 'PL' | 'PY' | 'CUR'; dx: number }[] {
  const step = bw * 0.28;
  return [
    { code: 'PL', dx: -step },
    { code: 'PY', dx: 0 },
    { code: 'CUR', dx: step },
  ];
}

/**
 * Twelve months of one line in the order of {@link columnLayout}: the variance against the comparison in a strip
 * ABOVE the columns (IBCS: variances on top of the time series), then the columns with the value above each AC/FC
 * column, at one scale. `goodUp` colours the variance by impact.
 */
export function MonthColumns({ points, comparison, goodUp }: { points: MonthPoint[]; comparison: 'PL' | 'PY'; goodUp: boolean | null }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const n = points.length || 1;
  const vals = points.flatMap((p) => [p.cur, p.pl, p.py]).filter((v): v is number => v !== undefined);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const deltas = points.map((p) => (p.cur !== undefined && p[comparison === 'PL' ? 'pl' : 'py'] !== undefined ? p.cur - (p[comparison === 'PL' ? 'pl' : 'py'] as number) : undefined));
  const dMax = Math.max(1, ...deltas.map((d) => Math.abs(d ?? 0)));

  const deltaH = Math.max(28, height * 0.22);
  // Strip on top: its labels need a line above and below the bars.
  const dMid = 4 + LABEL + deltaH / 2;
  const top = dMid + deltaH / 2 + LABEL + 8 + (max > 0 ? LABEL : 0);
  const axisY = height - LABEL - 6;
  const plotBottom = axisY - 4 - (min < 0 ? LABEL + 2 : 0);
  const span = max - min || 1;
  const y = (v: number) => top + ((max - v) / span) * (plotBottom - top);
  const slot = width / n;
  const bw = Math.max(6, Math.min(30, slot * 0.46));
  const layout = columnLayout(bw);
  const curDx = layout.find((c) => c.code === 'CUR')!.dx;
  const dScale = (deltaH / 2 - 2) / dMax;

  return (
    <div ref={ref} className="panel h-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Monthly columns">
          <HatchDefs id={uid} />
          {points.map((p, i) => {
            const cx = slot * i + slot / 2;
            const col = (v: number | undefined, dx: number, fill: string, stroke = 'none', sw = 0) =>
              v === undefined ? null : <rect x={cx - bw / 2 + dx} y={Math.min(y(v), y(0))} width={bw} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={fill} stroke={stroke} strokeWidth={sw} />;
            const d = deltas[i];
            const good = d === undefined || goodUp === null ? true : (d >= 0) === goodUp;
            const top3 = Math.max(p.cur ?? 0, p.pl ?? 0, p.py ?? 0);
            const low3 = Math.min(p.cur ?? 0, p.pl ?? 0, p.py ?? 0);
            return (
              <g key={p.month}>
                {layout.map(({ code, dx }) =>
                  code === 'PL'
                    ? <g key={code}>{col(p.pl, dx, 'var(--paper)', 'var(--ac)', 1.2)}</g>
                    : code === 'PY'
                      ? <g key={code}>{col(p.py, dx, 'var(--py)')}</g>
                      : <g key={code}>{p.isForecast ? col(p.cur, dx, `url(#${uid}-fc)`, 'var(--ac)', 0.8) : col(p.cur, dx, 'var(--ac)')}</g>
                )}
                {p.cur !== undefined && (
                  <text x={cx + curDx} y={p.cur >= 0 ? y(top3) - 3 : y(low3) + LABEL} textAnchor="middle" fontSize={LABEL - 1} fill="var(--ink)">
                    {fmtK(p.cur)}
                  </text>
                )}
                {d !== undefined && (
                  <>
                    <rect
                      x={cx + curDx - bw / 2}
                      y={d >= 0 ? dMid - Math.abs(d) * dScale : dMid}
                      width={bw}
                      height={Math.max(0.5, Math.abs(d) * dScale)}
                      fill={p.isForecast ? `url(#${uid}-${good ? 'good' : 'bad'})` : good ? 'var(--good)' : 'var(--bad)'}
                      stroke={p.isForecast ? (good ? 'var(--good)' : 'var(--bad)') : 'none'}
                      strokeWidth={0.8}
                    />
                    <text
                      x={cx + curDx}
                      y={d >= 0 ? dMid - Math.abs(d) * dScale - 3 : dMid + Math.abs(d) * dScale + LABEL - 1}
                      textAnchor="middle"
                      fontSize={LABEL - 2}
                      fill="var(--ink)"
                    >
                      {fmtDeltaK(d)}
                    </text>
                  </>
                )}
                <text x={cx} y={height - 4} textAnchor="middle" fontSize={LABEL} fill="var(--muted)">
                  {monthShort(p.month)}
                </text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--ink)" strokeWidth={1} />
          <line x1={0} x2={width} y1={dMid} y2={dMid} stroke="var(--ink)" strokeWidth={comparison === 'PY' ? 3 : 1} opacity={comparison === 'PY' ? 0.35 : 1} />
          <text x={2} y={dMid - deltaH / 2 - 2} fontSize={LABEL - 1} fill="var(--muted)">
            Δ{comparison}
          </text>
        </svg>
      )}
    </div>
  );
}

/* ───────────────────────────── waterfall ───────────────────────────── */

export interface Step {
  label: string;
  value: number;
  /** A total stands on the axis; a step hangs from the running sum. */
  kind: 'total-pl' | 'total-py' | 'total-cur' | 'step';
  /** For variance bridges: is a positive step good? Steps without it are drawn in ink (not variances). */
  goodUp?: boolean;
  hatched?: boolean;
}

/**
 * A vertical waterfall (bridge): the categories run from top to bottom, each a horizontal bar on one value axis, with
 * vertical connectors from one step to the next and the value at the end of every bar. Totals stand on the axis in
 * their scenario notation; steps hang from the running sum.
 */
export function Waterfall({ steps }: { steps: Step[] }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  let run = 0;
  const geo = steps.map((s) => {
    if (s.kind !== 'step') {
      run = s.value;
      return { from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { from, to: run };
  });
  const all = geo.flatMap((g) => [g.from, g.to]);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const n = steps.length || 1;
  const labelW = Math.min(110, Math.max(70, width * 0.24));
  const valueW = 44; // room for the value label on either side
  const left = labelW + (min < 0 ? valueW : 4);
  const right = width - (max > 0 ? valueW : 4);
  const span = max - min || 1;
  const x = (v: number) => left + ((v - min) / span) * (right - left);
  const slot = height / n;
  const bh = Math.max(6, Math.min(22, slot * 0.62));

  return (
    <div ref={ref} className="panel h-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Bridge">
          <HatchDefs id={uid} />
          {steps.map((s, i) => {
            const g = geo[i];
            const cy = slot * i + slot / 2;
            const x0 = Math.min(x(g.from), x(g.to));
            const w = Math.max(0.8, Math.abs(x(g.to) - x(g.from)));
            let fill = 'var(--ac)';
            let stroke = 'none';
            if (s.kind === 'total-pl') {
              fill = 'var(--paper)';
              stroke = 'var(--ac)';
            } else if (s.kind === 'total-py') fill = 'var(--py)';
            else if (s.kind === 'total-cur' && s.hatched) {
              fill = `url(#${uid}-fc)`;
              stroke = 'var(--ac)';
            } else if (s.kind === 'step' && s.goodUp !== undefined) {
              const good = (s.value >= 0) === s.goodUp;
              fill = s.hatched ? `url(#${uid}-${good ? 'good' : 'bad'})` : good ? 'var(--good)' : 'var(--bad)';
              stroke = s.hatched ? (good ? 'var(--good)' : 'var(--bad)') : 'none';
            }
            const next = steps[i + 1];
            const label = s.kind === 'step' ? fmtDeltaK(s.value) : fmtK(s.value);
            // The value sits at the far end of the bar: right of it when the bar ends on the right.
            const endRight = s.kind === 'step' ? s.value >= 0 : s.value >= 0;
            const total = s.kind !== 'step';
            return (
              <g key={`${s.label}-${i}`}>
                <text x={labelW - 6} y={cy + 4} textAnchor="end" fontSize={LABEL} fill={total ? 'var(--ink)' : 'var(--muted)'} fontWeight={total ? 600 : 400}>
                  {s.label}
                </text>
                <rect x={x0} y={cy - bh / 2} width={w} height={bh} fill={fill} stroke={stroke} strokeWidth={stroke === 'none' ? 0 : 1} />
                {next && next.kind === 'step' && (
                  <line x1={x(g.to)} x2={x(g.to)} y1={cy + bh / 2} y2={cy + slot - bh / 2} stroke="var(--py)" strokeWidth={1} />
                )}
                <text
                  x={endRight ? x0 + w + 4 : x0 - 4}
                  y={cy + 4}
                  textAnchor={endRight ? 'start' : 'end'}
                  fontSize={LABEL - 1}
                  fill="var(--ink)"
                  fontWeight={total ? 600 : 400}
                >
                  {label}
                </text>
              </g>
            );
          })}
          <line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}

/* ───────────────────────────── balance sheet structure ───────────────────────────── */

export interface Stack {
  label: string;
  code: 'cur' | 'py' | 'pl';
  hatched?: boolean;
  parts: { label: string; value: number }[];
}

/**
 * Balance sheet structure: for each scenario a pair of stacked columns, assets and equity & liabilities, at one
 * scale; segments in ink shades, labelled with their value.
 */
export function StructureColumns({ pairs }: { pairs: { title: string; left: Stack; right: Stack }[] }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const totals = pairs.flatMap((p) => [p.left, p.right].map((s) => s.parts.reduce((a, b) => a + Math.max(0, b.value), 0)));
  const max = Math.max(1, ...totals);
  const top = 18;
  const bottom = height - 30;
  const k = (bottom - top) / max;
  const groupW = width / (pairs.length || 1);
  const bw = Math.max(24, Math.min(64, groupW * 0.2));
  const shades = ['#404040', '#6a6a6a', '#8f8f8f', '#b3b3b3', '#d0d0d0', '#e6e6e6'];

  /** One stacked column; `names` puts the segment names beside it (left of assets, right of equity & liabilities). */
  const stack = (s: Stack, x: number, names?: 'left' | 'right') => {
    let acc = 0;
    return (
      <g>
        {s.parts.map((p, i) => {
          const h = Math.max(0, p.value) * k;
          const y0 = bottom - (acc + Math.max(0, p.value)) * k;
          acc += Math.max(0, p.value);
          const dark = i < 2;
          return (
            <g key={p.label}>
              <rect x={x} y={y0} width={bw} height={h} fill={s.code === 'pl' ? 'var(--paper)' : shades[i % shades.length]} stroke={s.code === 'pl' ? 'var(--ac)' : 'var(--paper)'} strokeWidth={s.code === 'pl' ? 1 : 0.6} />
              {s.hatched && <rect x={x} y={y0} width={bw} height={h} fill={`url(#${uid}-fc)`} opacity={0.35} />}
              {h > 13 && (
                <text x={x + bw / 2} y={y0 + h / 2 + 4} textAnchor="middle" fontSize={10} fill={dark && s.code !== 'pl' ? '#fff' : 'var(--ink)'}>
                  {fmtK(p.value)}
                </text>
              )}
              {names && h > 11 && (
                <text x={names === 'left' ? x - 5 : x + bw + 5} y={y0 + h / 2 + 4} textAnchor={names === 'left' ? 'end' : 'start'} fontSize={10} fill="var(--muted)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={x + bw / 2} y={bottom - acc * k - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
          {fmtK(acc)}
        </text>
      </g>
    );
  };

  return (
    <div ref={ref} className="panel h-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Balance sheet structure">
          <HatchDefs id={uid} />
          {pairs.map((p, i) => {
            const gx = groupW * i + groupW / 2;
            const last = i === pairs.length - 1;
            return (
              <g key={p.title}>
                {stack(p.left, gx - bw - 3, i === 0 ? 'left' : undefined)}
                {stack(p.right, gx + 3, last ? 'right' : undefined)}
                <text x={gx} y={height - 16} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                  {p.title}
                </text>
                <text x={gx - bw / 2 - 3} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  Assets
                </text>
                <text x={gx + bw / 2 + 3} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  Eq. & liab.
                </text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={bottom} y2={bottom} stroke="var(--ink)" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}
