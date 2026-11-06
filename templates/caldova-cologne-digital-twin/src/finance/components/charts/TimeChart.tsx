// IBCS monthly time series tile (ChartKitchen grammar): all 12 months of the
// cube year for the selected KPI, the selected period emphasised, open months
// as forecast. Variants: integrated variance chart (ΔRef% pins, ΔRef columns,
// offset pair columns + total band), columns, lines and cumulative lines.

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { IbcsDefs, PinHead, RefAxis, ScenarioTag } from '@finance/components/ibcs/Ibcs';
import { Switch, Tile } from '@finance/components/Tile';
import { useCockpit } from '@finance/hooks/cockpit.context';
import { fmt, fmtDelta, fmtRel, MONTH_SHORT, periodLabel, relDelta, unitLabel } from '@finance/lib/cockpit/format';
import { C, makeScale, relCap, scenPaint, varPaint, type Code, type Paint } from '@finance/lib/cockpit/ibcs';
import { favourable, type KpiDef } from '@finance/lib/cockpit/kpis';
import type { TimeVariant } from '@finance/lib/cockpit/view';

// ---------- geometry (fixed internal width, scaled by the viewBox) ----------

const W = 760;
const X0 = 8;
const X1 = 680;
const SLOT = (X1 - X0) / 12;
const BAND_X = X1 + 16;
const BAND_W = W - BAND_X; // 64
const CAP = 14; // caption band above each tier
const CAT = 18; // category label row
const GAP = 14; // gap between tiers
const HOVER = 'var(--color-hover)';

const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const upTo = (m: number) => Array.from({ length: m }, (_, i) => i + 1);
const cx = (m: number) => X0 + (m - 0.5) * SLOT;
const fin = (v: number) => Number.isFinite(v);

const VARIANTS: { id: TimeVariant; label: string; title: string }[] = [
  { id: 'integrated', label: 'Integrated', title: 'Δ%, Δ and values stacked' },
  { id: 'columns', label: 'Columns', title: 'Values as a pair of columns' },
  { id: 'line', label: 'Line', title: 'Trend as a line' },
  { id: 'cumulative', label: 'Cumulative', title: 'Cumulative trend from January' },
];

interface Row {
  m: number;
  open: boolean;
  sel: boolean;
  a: number;
  r: number;
  d: number;
  rel: number;
  good: boolean;
  code: Code;
  /** Cumulative values from January (only filled for the cumulative variant). */
  ca: number;
  cr: number;
}

interface Geo {
  uid: string;
  kpi: KpiDef;
  rc: Code;
  refLabel: string;
  rows: Row[];
  allSel: boolean;
}

interface BandData {
  tot: number;
  refTot: number;
  ac: number;
  fc: number;
  hasAc: boolean;
  hasFc: boolean;
  avg: boolean;
  code: Code;
  label: string;
}

// ---------- small marks ----------

function Bar({ x, w, ya, yb, paint }: { x: number; w: number; ya: number; yb: number; paint: Paint }) {
  const h = Math.abs(yb - ya);
  if (!fin(h) || h < 0.01) return null;
  return (
    <rect
      x={x}
      y={Math.min(ya, yb)}
      width={w}
      height={h}
      fill={paint.fill}
      stroke={paint.stroke === 'none' ? undefined : paint.stroke}
      strokeWidth={paint.strokeWidth || undefined}
    />
  );
}

function Caption({ top, children }: { top: number; children: ReactNode }) {
  return (
    <text x={X0} y={top + 10} fontSize={10.5} fill={C.sub}>
      {children}
    </text>
  );
}

function CatLabels({ g, y }: { g: Geo; y: number }) {
  return (
    <g>
      {g.rows.map((r) => (
        <text
          key={r.m}
          x={cx(r.m)}
          y={y}
          textAnchor="middle"
          fontSize={11}
          fill={C.cat}
          fontWeight={r.sel && !g.allSel ? 600 : 400}
        >
          {MONTH_SHORT[r.m - 1]}
        </text>
      ))}
    </g>
  );
}

function Divider({ lastAc, height, labelY }: { lastAc: number; height: number; labelY: number }) {
  if (lastAc < 1 || lastAc > 11) return null;
  const x = X0 + lastAc * SLOT;
  return (
    <g>
      <line x1={x} x2={x} y1={2} y2={height - 2} stroke={C.hair} strokeWidth={1} strokeDasharray="3,3" />
      <text x={x + 4} y={labelY} fontSize={10} fill={C.sub}>
        FC ab {MONTH_SHORT[lastAc]}
      </text>
    </g>
  );
}

// ---------- tiers ----------

/** ΔRef% tier: pins with heads in the minuend's notation, outliers capped. */
function RelTier({ g, top, plotH }: { g: Geo; top: number; plotH: number }) {
  const y0 = top + CAP;
  const cap = relCap(g.rows.map((r) => r.rel));
  const clamped = g.rows.map((r) => (fin(r.rel) ? Math.max(-cap, Math.min(cap, r.rel)) : NaN));
  const pos = clamped.some((v) => v > 0);
  const neg = clamped.some((v) => v < 0);
  const s = makeScale(clamped, [y0 + plotH - (neg ? 22 : 6), y0 + (pos ? 22 : 6)], 0);
  const z = s(0);
  return (
    <g>
      <Caption top={top}>Δ{g.refLabel}%</Caption>
      {g.rows.map((r, i) => {
        const v = clamped[i];
        if (!fin(v)) return null;
        const x = cx(r.m);
        const y = s(v);
        const col = r.good ? C.good : C.bad;
        const capped = Math.abs(r.rel) > cap;
        const up = r.rel >= 0;
        const off = capped ? 12 : 9;
        return (
          <g key={r.m} opacity={r.sel ? 1 : 0.35}>
            <line x1={x} x2={x} y1={z} y2={y} stroke={col} strokeWidth={2} />
            {capped ? (
              <polygon
                points={up ? `${x - 4},${y + 4} ${x + 4},${y + 4} ${x},${y - 4}` : `${x - 4},${y - 4} ${x + 4},${y - 4} ${x},${y + 4}`}
                fill={r.code === 'FC' ? `url(#${g.uid}-h-dark)` : r.code === 'PL' ? C.paper : C.ac}
                stroke={C.ac}
                strokeWidth={r.code === 'AC' ? 0 : 1}
              />
            ) : (
              <PinHead cx={x} cy={y} r={4.2} minuend={r.code} uid={g.uid} />
            )}
            <text x={x} y={up ? y - off : y + off + 7} textAnchor="middle" fontSize={10} fill={col}>
              {fmtRel(r.rel, Math.abs(r.rel) < 0.1 ? 1 : 0)}
            </text>
          </g>
        );
      })}
      <RefAxis code={g.rc} orient="h" at={z} from={X0} to={X1} />
    </g>
  );
}

/** ΔRef tier: absolute variance columns in the minuend's notation. */
function DeltaTier({ g, top, plotH, wf }: { g: Geo; top: number; plotH: number; wf: number }) {
  const y0 = top + CAP;
  const ds = g.rows.map((r) => r.d);
  const pos = ds.some((v) => v > 0);
  const neg = ds.some((v) => v < 0);
  const s = makeScale(ds, [y0 + plotH - (neg ? 14 : 2), y0 + (pos ? 14 : 2)], 0);
  const z = s(0);
  const w = wf * SLOT;
  return (
    <g>
      <Caption top={top}>Δ{g.refLabel}</Caption>
      {g.rows.map((r) => {
        if (!fin(r.d)) return null;
        const x = cx(r.m);
        const y = s(r.d);
        return (
          <g key={r.m} opacity={r.sel ? 1 : 0.35}>
            <Bar x={x - w / 2} w={w} ya={z} yb={y} paint={varPaint(r.code, r.good, g.uid)} />
            <text x={x} y={r.d >= 0 ? y - 3 : y + 10} textAnchor="middle" fontSize={10} fill={r.good ? C.good : C.bad}>
              {fmtDelta(g.kpi, r.d)}
            </text>
          </g>
        );
      })}
      <RefAxis code={g.rc} orient="h" at={z} from={X0} to={X1} />
    </g>
  );
}

/** Total band right of the base tier, zero aligned with the month axis. */
function TotalBand({ g, band, z, y0, bottom }: { g: Geo; band: BandData; z: number; y0: number; bottom: number }) {
  const upPx = z - (y0 + 34);
  const downPx = bottom - z;
  const bv = [band.tot, band.refTot, band.ac, band.ac + band.fc].filter(fin);
  const maxUp = Math.max(0, ...bv);
  const maxDn = Math.max(0, ...bv.map((v) => -v));
  const k = Math.max(upPx > 0 ? maxUp / upPx : 0, downPx > 0 ? maxDn / downPx : 0) * 1.05 || 1;
  const ys = (v: number) => z - v / k;
  const bcx = BAND_X + BAND_W / 2;
  const cw = Math.min(34, 0.55 * BAND_W);
  const x = bcx - cw / 2;
  const d = band.tot - band.refTot;
  const good = favourable(g.kpi, d) >= 0;
  const hasRef = fin(band.refTot);
  const labelTop = Math.min(z, fin(band.tot) ? ys(band.tot) : z, hasRef ? ys(band.refTot) : z) - 6;
  const split = !band.avg && fin(band.ac) && fin(band.fc);
  return (
    <g>
      {split ? (
        <>
          {band.hasAc && <Bar x={x} w={cw} ya={z} yb={ys(band.ac)} paint={scenPaint('AC', g.uid)} />}
          {band.hasFc && <Bar x={x} w={cw} ya={ys(band.ac)} yb={ys(band.ac + band.fc)} paint={scenPaint('FC', g.uid)} />}
        </>
      ) : (
        fin(band.tot) && <Bar x={x} w={cw} ya={z} yb={ys(band.tot)} paint={scenPaint(band.code, g.uid)} />
      )}
      {hasRef && <RefAxis code={g.rc} orient="h" at={ys(band.refTot)} from={x - 5} to={x + cw + 5} />}
      {fin(d) && (
        <>
          <line x1={x + cw + 6} x2={x + cw + 6} y1={ys(band.refTot)} y2={ys(band.tot)} stroke={good ? C.good : C.bad} strokeWidth={2} />
          <PinHead cx={x + cw + 6} cy={ys(band.tot)} r={3.5} minuend={band.code} uid={g.uid} />
          <text x={bcx} y={labelTop - 13} textAnchor="middle" fontSize={10} fontWeight={700} fill={good ? C.good : C.bad}>
            {fmtDelta(g.kpi, d)}
          </text>
        </>
      )}
      {fin(band.tot) && (
        <text x={bcx} y={labelTop} textAnchor="middle" fontSize={11} fontWeight={700} fill={band.code === 'FC' ? C.fcInk : C.ac}>
          {fmt(g.kpi, band.tot)}
        </text>
      )}
      <line x1={BAND_X + 2} x2={W - 2} y1={z} y2={z} stroke={C.ac} strokeWidth={1.5} />
    </g>
  );
}

/** Base tier: offset column pair per month (reference behind, AC/FC in front). */
function BaseTier({ g, top, plotH, band }: { g: Geo; top: number; plotH: number; band: BandData | null }) {
  const y0 = top + CAP;
  const vals = g.rows.flatMap((r) => [r.a, r.r]);
  const neg = vals.some((v) => v < 0);
  const bottom = y0 + plotH - (neg ? 16 : 0);
  const s = makeScale(vals, [bottom, y0 + 18], 0.1);
  const z = s(0);
  const cw = 0.42 * SLOT;
  const off = 0.115 * SLOT;
  return (
    <g>
      {g.rows.map((r) => {
        const x = cx(r.m);
        const ya = fin(r.a) ? s(r.a) : z;
        const yr = fin(r.r) ? s(r.r) : z;
        const labY = r.a >= 0 ? Math.min(ya, r.r >= 0 ? yr : z) - 6 : Math.max(ya, r.r < 0 ? yr : z) + 15;
        return (
          <g key={r.m} opacity={r.sel ? 1 : 0.35}>
            {fin(r.r) && <Bar x={x - off - cw / 2} w={cw} ya={z} yb={yr} paint={scenPaint(g.rc, g.uid)} />}
            {fin(r.a) && <Bar x={x + off - cw / 2} w={cw} ya={z} yb={ya} paint={scenPaint(r.code, g.uid)} />}
            {fin(r.a) && (
              <text x={x + off} y={labY} textAnchor="middle" fontSize={11} fill={r.open ? C.fcInk : C.ac}>
                {fmt(g.kpi, r.a)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={X0} x2={X1} y1={z} y2={z} stroke={C.ac} strokeWidth={1.5} />
      <CatLabels g={g} y={y0 + plotH + 13} />
      {band && (
        <>
          <TotalBand g={g} band={band} z={z} y0={y0} bottom={bottom} />
          <text x={BAND_X + BAND_W / 2} y={y0 + plotH + 13} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={C.cat}>
            {band.label}
          </text>
        </>
      )}
    </g>
  );
}

/** Line tier: AC solid, FC dashed continuation, reference line in its notation. */
function LineTier({ g, top, plotH, cum, lastAc }: { g: Geo; top: number; plotH: number; cum: boolean; lastAc: number }) {
  const y0 = top + CAP;
  const A = g.rows.map((r) => (cum ? r.ca : r.a));
  const R = g.rows.map((r) => (cum ? r.cr : r.r));
  const s = makeScale([...A, ...R], [y0 + plotH - 16, y0 + 18], 0.1);
  const refStyle =
    g.rc === 'PY'
      ? { stroke: C.py, w: 2, dash: undefined }
      : g.rc === 'PL'
        ? { stroke: C.ac, w: 1.3, dash: undefined }
        : { stroke: C.ac, w: 1.3, dash: '4,3' };
  const segOpacity = (i: number) => (g.rows[i].sel && g.rows[i + 1].sel ? 1 : 0.35);
  const segs = (vals: number[], render: (i: number, x1: number, y1: number, x2: number, y2: number) => ReactNode) =>
    vals.slice(0, 11).map((v, i) => (fin(v) && fin(vals[i + 1]) ? render(i, cx(i + 1), s(v), cx(i + 2), s(vals[i + 1])) : null));

  const labelled = [lastAc >= 1 && lastAc < 12 ? lastAc : 0, 12].filter((m) => m > 0);
  const last = 11;
  const dEnd = A[last] - R[last];
  const goodEnd = favourable(g.kpi, dEnd) >= 0;
  const bx = cx(12) + 12;

  return (
    <g>
      {/* reference series */}
      {segs(R, (i, x1, y1, x2, y2) => (
        <line key={`r${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={refStyle.stroke} strokeWidth={refStyle.w} strokeDasharray={refStyle.dash} opacity={segOpacity(i)} />
      ))}
      {R.map((v, i) => {
        if (!fin(v)) return null;
        const op = g.rows[i].sel ? 1 : 0.35;
        const x = cx(i + 1);
        const y = s(v);
        if (g.rc === 'PY') return <circle key={`rp${i}`} cx={x} cy={y} r={2.5} fill={C.py} opacity={op} />;
        if (g.rc === 'PL') return <circle key={`rp${i}`} cx={x} cy={y} r={3} fill={C.paper} stroke={C.ac} strokeWidth={1.3} opacity={op} />;
        return <circle key={`rp${i}`} cx={x} cy={y} r={3} fill={`url(#${g.uid}-h-dark)`} stroke={C.ac} strokeWidth={1} opacity={op} />;
      })}
      {/* AC / FC series */}
      {segs(A, (i, x1, y1, x2, y2) => (
        <line
          key={`a${i}`}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={C.ac}
          strokeWidth={2}
          strokeDasharray={g.rows[i + 1].open ? '4,3' : undefined}
          opacity={segOpacity(i)}
        />
      ))}
      {A.map((v, i) => {
        if (!fin(v)) return null;
        const r = g.rows[i];
        const op = r.sel ? 1 : 0.35;
        return r.open ? (
          <circle key={`ap${i}`} cx={cx(r.m)} cy={s(v)} r={3.5} fill={`url(#${g.uid}-h-dark)`} stroke={C.ac} strokeWidth={1} opacity={op} />
        ) : (
          <circle key={`ap${i}`} cx={cx(r.m)} cy={s(v)} r={3} fill={C.ac} opacity={op} />
        );
      })}
      {/* value labels: last actual and last month only */}
      {labelled.map((m) => {
        const a = A[m - 1];
        const r = R[m - 1];
        const above = !fin(r) || a >= r;
        const open = g.rows[m - 1].open;
        return (
          <g key={`l${m}`}>
            {fin(a) && (
              <text x={cx(m)} y={above ? s(a) - 8 : s(a) + 16} textAnchor="middle" fontSize={11} fontWeight={600} fill={open ? C.fcInk : C.ac}>
                {fmt(g.kpi, a)}
              </text>
            )}
            {m === 12 && fin(r) && (
              <text x={cx(m)} y={above ? s(r) + 16 : s(r) - 8} textAnchor="middle" fontSize={11} fill={C.sub}>
                {fmt(g.kpi, r)}
              </text>
            )}
          </g>
        );
      })}
      {/* cumulative: year-end bracket with Δ */}
      {cum && fin(dEnd) && (
        <g>
          <path
            d={`M${bx - 4},${s(A[last])} H${bx} V${s(R[last])} H${bx - 4}`}
            fill="none"
            stroke={goodEnd ? C.good : C.bad}
            strokeWidth={1.5}
          />
          <text x={bx + 5} y={(s(A[last]) + s(R[last])) / 2 - 2} fontSize={10} fontWeight={700} fill={goodEnd ? C.good : C.bad}>
            {fmtDelta(g.kpi, dEnd)}
          </text>
          {fin(relDelta(A[last], R[last])) && (
            <text x={bx + 5} y={(s(A[last]) + s(R[last])) / 2 + 10} fontSize={10} fill={goodEnd ? C.good : C.bad}>
              {fmtRel(relDelta(A[last], R[last]))}
            </text>
          )}
        </g>
      )}
      <CatLabels g={g} y={y0 + plotH + 13} />
    </g>
  );
}

// ---------- tile ----------

export function TimeChart() {
  const { cube, view, setView, months, kpi, primary, value, refCode } = useCockpit();
  const uid = 'tc' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [hot, setHot] = useState<{ m: number; focus: boolean } | null>(null);

  const year = cube.year;
  const lastAc = cube.lastAc;
  const ref = view.ref;
  const rc = refCode(ref);
  const variant = view.timeVariant;
  const sel = new Set(months);
  const cum = variant === 'cumulative';

  const rows = ALL_MONTHS.map((m): Row => {
    const a = value(kpi, 'ACT', [m]);
    const r = value(kpi, ref, [m]);
    const d = fin(a) && fin(r) ? a - r : NaN;
    const open = m > lastAc;
    return {
      m,
      open,
      sel: sel.has(m),
      a,
      r,
      d,
      rel: relDelta(a, r),
      good: !fin(d) || favourable(kpi, d) >= 0,
      code: open ? 'FC' : 'AC',
      ca: cum ? value(kpi, 'ACT', upTo(m)) : NaN,
      cr: cum ? value(kpi, ref, upTo(m)) : NaN,
    };
  });
  const g: Geo = { uid, kpi, rc, refLabel: ref, rows, allSel: months.length === 12 };

  // Period totals (selected months).
  const avg = kpi.unit === 'pct' || kpi.unit === 'pts' || kpi.unit === 'eur' || kpi.unit === 'km';
  const closedSel = months.filter((m) => m <= lastAc);
  const openSel = months.filter((m) => m > lastAc);
  const tot = value(kpi, 'ACT');
  const refTot = value(kpi, ref);
  const per = periodLabel(months, year);
  const perShort = per.replace(` ${year}`, '');
  const band: BandData = {
    tot,
    refTot,
    ac: avg ? NaN : closedSel.length ? value(kpi, 'ACT', closedSel) : 0,
    fc: avg ? NaN : openSel.length ? value(kpi, 'ACT', openSel) : 0,
    hasAc: closedSel.length > 0,
    hasFc: openSel.length > 0,
    avg,
    code: primary === 'FC' ? 'FC' : 'AC',
    label: avg ? perShort : `Σ ${perShort}`,
  };

  // Header texts.
  const codes = lastAc >= 12 ? 'AC' : lastAc < 1 ? 'FC' : 'AC/FC';
  const sub = `${unitLabel(kpi)} · ${codes} vs ${ref} · ${year}`;
  // Legend order PL, PY, AC, FC.
  const acFc: Code[] = [...(lastAc >= 1 ? (['AC'] as Code[]) : []), ...(lastAc < 12 ? (['FC'] as Code[]) : [])];
  const tags = Array.from(new Set<Code>(rc === 'FC' ? [...acFc, rc] : [rc, ...acFc]));

  const dT = tot - refTot;
  const relT = relDelta(tot, refTot);
  let message: ReactNode = null;
  if (fin(dT)) {
    // Absolute delta first (the number the total band shows), relative delta in brackets.
    const usePP = kpi.unit === 'pct' || !fin(relT);
    const abs = fmtDelta(kpi, Math.abs(dT)).replace(/^[+−]/, '');
    const mag = usePP ? abs : `${abs} ${unitLabel(kpi)} (${fmtRel(Math.abs(relT)).replace(/^[+−]/, '')})`;
    const level = mag.startsWith('±');
    message = level ? (
      <>
        {kpi.label} {per} is level with {ref}
      </>
    ) : (
      <>
        {kpi.label} {per} is <span style={{ color: favourable(kpi, dT) >= 0 ? C.good : C.bad }}>{mag}</span>{' '}
        {dT > 0 ? 'above' : 'below'} {ref}
      </>
    );
  }

  // Layout per variant.
  let H: number;
  let body: ReactNode;
  let fcLabelY: number;
  let showBand = false;
  if (variant === 'integrated') {
    const t1 = 0;
    const t2 = t1 + CAP + 78 + GAP;
    const t3 = t2 + CAP + 84 + GAP;
    H = t3 + CAP + 150 + CAT;
    fcLabelY = t3 + 10;
    showBand = true;
    body = (
      <>
        <RelTier g={g} top={t1} plotH={78} />
        <DeltaTier g={g} top={t2} plotH={84} wf={0.45} />
        <BaseTier g={g} top={t3} plotH={150} band={band} />
      </>
    );
  } else if (variant === 'columns') {
    H = CAP + 240 + CAT;
    fcLabelY = 10;
    showBand = true;
    body = <BaseTier g={g} top={0} plotH={240} band={band} />;
  } else if (variant === 'line') {
    // Variances on top of the time series (IBCS), as in the integrated variant.
    const t2 = CAP + 70 + GAP;
    H = t2 + CAP + 200 + CAT;
    fcLabelY = t2 + 10;
    body = (
      <>
        <DeltaTier g={g} top={0} plotH={70} wf={0.25} />
        <LineTier g={g} top={t2} plotH={200} cum={false} lastAc={lastAc} />
      </>
    );
  } else {
    H = CAP + 240 + CAT;
    fcLabelY = 10;
    body = <LineTier g={g} top={0} plotH={240} cum lastAc={lastAc} />;
  }

  // Interaction.
  const reset = () => setView({ period: 'ytd' });
  const pick = (m: number) => {
    if (view.period === 'month' && view.month === m) reset();
    else setView({ period: 'month', month: m });
  };
  const onKey = (e: KeyboardEvent, act: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act();
    }
  };
  const tip = (r: Row) => {
    const name = `${MONTH_SHORT[r.m - 1]} ${year}`;
    return [
      name,
      `${r.code} ${fmt(kpi, r.a)}`,
      `${ref} ${fmt(kpi, r.r)}`,
      `Δ${ref} ${fmtDelta(kpi, r.d)}`,
      `Δ${ref}% ${fmtRel(r.rel)}`,
    ].join('\n');
  };

  const tools = (
    <>
      <span className="flex items-center gap-200">
        {tags.map((c) => (
          <ScenarioTag key={c} code={c} />
        ))}
      </span>
      {view.period === 'month' && (
        <button
          type="button"
          onClick={reset}
          className="rounded-sm px-100 text-200 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          All
        </button>
      )}
      <Switch<TimeVariant> value={variant} options={VARIANTS} onChange={(v) => setView({ timeVariant: v })} label="Time series display" />
    </>
  );

  return (
    <Tile title={`${kpi.label} by month`} sub={sub} message={message} tools={tools}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="group"
          aria-label={`${kpi.label} by month ${year}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && view.period === 'month') reset();
        }}
      >
        <IbcsDefs uid={uid} />
        {hot && (
          <rect
            x={hot.m === 0 ? BAND_X : X0 + (hot.m - 1) * SLOT}
            y={0}
            width={hot.m === 0 ? BAND_W : SLOT}
            height={H}
            fill={HOVER}
            stroke={hot.focus ? C.hilite : 'none'}
            strokeWidth={1}
          />
        )}
        <Divider lastAc={lastAc} height={H} labelY={fcLabelY} />
        {body}
        {/* hit areas: one focusable slot per month, plus the total band */}
        {rows.map((r) => (
          <rect
            key={`hit${r.m}`}
            data-month={r.m}
            x={X0 + (r.m - 1) * SLOT}
            y={0}
            width={SLOT}
            height={H}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-pressed={view.period === 'month' && view.month === r.m}
            aria-label={`${MONTH_SHORT[r.m - 1]} ${year}: ${r.code} ${fmt(kpi, r.a)}; ${ref} ${fmt(kpi, r.r)}`}
            style={{ cursor: 'pointer', outline: 'none' }}
            onClick={() => pick(r.m)}
            onKeyDown={(e) => onKey(e, () => pick(r.m))}
            onMouseEnter={() => setHot({ m: r.m, focus: false })}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot({ m: r.m, focus: true })}
            onBlur={() => setHot(null)}
          >
            <title>{tip(r)}</title>
          </rect>
        ))}
        {showBand && (
          <rect
            x={BAND_X}
            y={0}
            width={BAND_W}
            height={H}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${band.label}: ${fmt(kpi, tot)}; ${ref} ${fmt(kpi, refTot)}. Reset period to YTD`}
            style={{ cursor: 'pointer', outline: 'none' }}
            onClick={reset}
            onKeyDown={(e) => onKey(e, reset)}
            onMouseEnter={() => setHot({ m: 0, focus: false })}
            onMouseLeave={() => setHot(null)}
            onFocus={() => setHot({ m: 0, focus: true })}
            onBlur={() => setHot(null)}
          >
            <title>
              {[
                `${band.label} ${year}`,
                `${primary} ${fmt(kpi, tot)}`,
                `${ref} ${fmt(kpi, refTot)}`,
                `Δ${ref} ${fmtDelta(kpi, dT)}`,
                `Δ${ref}% ${fmtRel(relT)}`,
              ].join('\n')}
            </title>
          </rect>
        )}
      </svg>
    </Tile>
  );
}
