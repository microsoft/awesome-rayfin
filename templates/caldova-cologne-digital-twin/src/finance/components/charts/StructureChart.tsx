// Structure chart (ChartKitchen "barskombi"): horizontal bars per member with
// the reference scenario offset behind the primary one, followed by a ΔRef tier
// (variance bars) and a ΔRef% tier (pins). Rows cross-filter the cockpit.

import { useId, useMemo, type KeyboardEvent } from 'react';

import { IbcsDefs, PinHead, RefAxis } from '@finance/components/ibcs/Ibcs';
import { Switch, Tile } from '@finance/components/Tile';
import { useCockpit } from '@finance/hooks/cockpit.context';
import type { Cube, MemberFilter } from '@finance/lib/cockpit/cube';
import { fmt, fmtDelta, fmtRel, periodLabel, relDelta, unitLabel } from '@finance/lib/cockpit/format';
import { C, makeScale, relCap, scenPaint, varPaint } from '@finance/lib/cockpit/ibcs';
import { favourable } from '@finance/lib/cockpit/kpis';
import type { StructDim, StructSort, View } from '@finance/lib/cockpit/view';

const DIMS: { id: StructDim; label: string }[] = [
  // Caldova: markets are Cologne districts (left or right bank of the Rhine), products the six categories.
  { id: 'region', label: 'Rhine bank' },
  { id: 'land', label: 'District' },
  { id: 'kategorie', label: 'Product group' },
  { id: 'produkt', label: 'Category' },
];

const SORTS: { id: StructSort; label: string; title: string }[] = [
  { id: 'value', label: 'Value', title: 'Sort by value' },
  { id: 'delta', label: 'Δ', title: 'Sort by variance (favourable first)' },
];

// Layout (viewBox units)
const W = 560;
const ROW_H = 27;
const PAD_T = 24;
const PAD_B = 6;
const GAP = 30;
const PAD_R = 16;
const TIER_BASE = 215;
const TIER_DELTA = 150;
const TIER_REL = 138;
const MAX_CHARS = 20;
const FS = 10.5;

interface Member {
  name: string;
  /** Leaf member names (lands or products) behind this row. */
  leaves: string[];
  filter: MemberFilter;
  selected: boolean;
}

interface Row extends Member {
  ac: number;
  ref: number;
  delta: number;
  rel: number;
  /** Signed goodness of delta (positive = favourable). */
  good: number;
}

const isMarketDim = (d: StructDim) => d === 'region' || d === 'land';

function membersOf(dim: StructDim, cube: Cube, filter: MemberFilter, view: View): Member[] {
  const market = isMarketDim(dim);
  const groups = new Map<string, number[]>();
  const add = (key: string, i: number) => {
    const k = key || '(none)';
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  };
  if (market) cube.markets.forEach((m, i) => add(dim === 'region' ? m.region : m.land, i));
  else cube.products.forEach((p, i) => add(dim === 'kategorie' ? p.kategorie : p.produkt, i));
  const sel = new Set(market ? view.markets : view.products);
  return [...groups].map(([name, idx]) => {
    const leaves = idx.map((i) => (market ? cube.markets[i].land : cube.products[i].produkt));
    const set = new Set(idx);
    return {
      name,
      leaves,
      selected: leaves.length > 0 && leaves.every((n) => sel.has(n)),
      // Same dimension: the member replaces the filter; other dimension: keep the cross-filter.
      filter: market ? { markets: set, products: filter.products } : { markets: filter.markets, products: set },
    };
  });
}

const short = (s: string) => (s.length > MAX_CHARS ? s.slice(0, MAX_CHARS - 1) + '…' : s);

export function StructureChart() {
  const ctx = useCockpit();
  const { cube, view, setView, months, filter, kpi, primary, value } = ctx;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const refC = ctx.refCode(view.ref);
  const dim = view.structDim;
  const market = isMarketDim(dim);
  const dimLabel = DIMS.find((d) => d.id === dim)?.label ?? dim;
  const dimFilterActive = market ? view.markets.length > 0 : view.products.length > 0;
  const primaryPaintCode = primary === 'FC' ? 'FC' : 'AC';

  const rows = useMemo<Row[]>(() => {
    const list = membersOf(dim, cube, filter, view).map((m) => {
      const ac = value(kpi, 'ACT', months, m.filter);
      const ref = value(kpi, view.ref, months, m.filter);
      const delta = Number.isFinite(ac) && Number.isFinite(ref) ? ac - ref : NaN;
      return { ...m, ac, ref, delta, rel: relDelta(ac, ref), good: Number.isFinite(delta) ? favourable(kpi, delta) : NaN };
    });
    const key = (r: Row) => (view.structSort === 'delta' ? r.good : r.ac);
    return list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (!Number.isFinite(ka)) return Number.isFinite(kb) ? 1 : 0;
      if (!Number.isFinite(kb)) return -1;
      return kb - ka;
    });
  }, [dim, cube, filter, view, value, kpi, months]);

  const message = useMemo(() => {
    const fin = rows.filter((r) => Number.isFinite(r.good));
    if (fin.length === 0) return undefined;
    const best = fin.reduce((a, b) => (b.good > a.good ? b : a));
    const worst = fin.reduce((a, b) => (b.good < a.good ? b : a));
    const parts: string[] = [];
    if (best.good > 0) parts.push(`largest contribution: ${best.name} ${fmtDelta(kpi, best.delta)}`);
    if (worst.good < 0) parts.push(`largest gap: ${worst.name} ${fmtDelta(kpi, worst.delta)}`);
    if (parts.length === 0) return `No variance to ${refC}`;
    const txt = parts.join(' · ');
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }, [rows, kpi, refC]);

  const toggle = (m: Member) => {
    const cur = market ? view.markets : view.products;
    const next = m.selected ? cur.filter((n) => !m.leaves.includes(n)) : [...cur, ...m.leaves.filter((n) => !cur.includes(n))];
    setView(market ? { markets: next } : { products: next });
  };
  const onKey = (e: KeyboardEvent, m: Member) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(m);
    }
  };

  const tools = (
    <>
      {dimFilterActive && (
        <button
          type="button"
          onClick={() => setView(market ? { markets: [] } : { products: [] })}
          className="rounded-sm px-100 text-200 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Clear filter
        </button>
      )}
      <Switch label="Dimension" value={dim} options={DIMS} onChange={(v) => setView({ structDim: v })} />
      <Switch label="Sort order" value={view.structSort} options={SORTS} onChange={(v) => setView({ structSort: v })} />
    </>
  );

  const title = `${kpi.label} by ${dimLabel.toLowerCase()}`;
  const sub = `${unitLabel(kpi)} · ${primary} vs ${refC} · ${periodLabel(months, cube.year)}`;

  if (rows.length === 0) {
    return (
      <Tile title={title} sub={sub} tools={tools}>
        <p className="py-600 text-center text-300 text-muted-foreground">No members for this selection.</p>
      </Tile>
    );
  }

  // ---------- layout ----------
  const maxChars = Math.max(...rows.map((r) => short(r.name).length));
  const labelW = Math.min(150, Math.max(58, maxChars * 6.6 + 14));
  const k = Math.min(1, (W - labelW - 2 * GAP - PAD_R) / (TIER_BASE + TIER_DELTA + TIER_REL));
  const baseW = TIER_BASE * k;
  const deltaW = TIER_DELTA * k;
  const relW = TIER_REL * k;
  const x1 = labelW;
  const x2 = x1 + baseW + GAP;
  const x3 = x2 + deltaW + GAP;
  const H = PAD_T + rows.length * ROW_H + PAD_B;
  const yMid = (i: number) => PAD_T + i * ROW_H + ROW_H / 2;

  // Base tier: room for value labels (right; left only if negatives exist).
  const baseVals = rows.flatMap((r) => [r.ac, r.ref]);
  const baseNeg = baseVals.some((v) => v < 0);
  const baseScale = makeScale(baseVals, [x1 + (baseNeg ? 40 : 4), x1 + baseW - 30], 0.02);

  const deltas = rows.map((r) => r.delta);
  const dNeg = deltas.some((v) => v < 0);
  const dPos = deltas.some((v) => v > 0);
  const dScale = makeScale(deltas, [x2 + (dNeg ? 28 : 0), x2 + deltaW - (dPos ? 28 : 0)], 0.02);

  const rels = rows.map((r) => r.rel);
  const cap = relCap(rels);
  const clampRel = (v: number) => Math.max(-cap, Math.min(cap, v));
  const rNeg = rels.some((v) => v < 0);
  const rPos = rels.some((v) => v > 0);
  const rScale = makeScale(rels.filter(Number.isFinite).map(clampRel), [x3 + (rNeg ? 30 : 0), x3 + relW - (rPos ? 30 : 0)], 0.02);

  const barH = 0.4 * ROW_H;
  const shift = 0.12 * ROW_H;
  const refPaint = scenPaint(refC, uid);
  const prmPaint = scenPaint(primaryPaintCode, uid);
  const minuend = primaryPaintCode;
  const span = (a: number, b: number) => ({ x: Math.min(a, b), w: Math.abs(b - a) });

  return (
    <Tile title={title} sub={sub} message={message} tools={tools}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={title}>
        <IbcsDefs uid={uid} />

        {/* tier headers */}
        <g fontSize={10} fontWeight={600} fill={C.sub}>
          <text x={x1} y={12}>{`${primary} · ${refC}`}</text>
          <text x={dScale(0)} y={12} textAnchor="middle">{`Δ${refC}`}</text>
          <text x={rScale(0)} y={12} textAnchor="middle">{`Δ${refC}%`}</text>
        </g>

        {rows.map((r, i) => {
          const y = yMid(i);
          const dim45 = dimFilterActive && !r.selected;
          const good = r.good >= 0;
          const tip = [
            r.name,
            `${primary}: ${fmt(kpi, r.ac)} ${unitLabel(kpi)}`,
            `${refC}: ${fmt(kpi, r.ref)} ${unitLabel(kpi)}`,
            `Δ${refC}: ${fmtDelta(kpi, r.delta)}`,
            `Δ${refC}%: ${fmtRel(r.rel)}`,
          ].join('\n');

          // base bars
          const z = baseScale(0);
          const refBar = Number.isFinite(r.ref) ? span(z, baseScale(r.ref)) : null;
          const acBar = Number.isFinite(r.ac) ? span(z, baseScale(r.ac)) : null;
          const lead = Number.isFinite(r.ac) ? r.ac : r.ref;
          const endR = Math.max(z, refBar ? refBar.x + refBar.w : z, acBar ? acBar.x + acBar.w : z);
          const endL = Math.min(z, refBar ? refBar.x : z, acBar ? acBar.x : z);
          const valNeg = Number.isFinite(lead) && lead < 0;

          // delta bar
          const dBar = Number.isFinite(r.delta) ? span(dScale(0), dScale(r.delta)) : null;
          const dPaint = varPaint(minuend, good, uid);

          // rel pin
          const hasRel = Number.isFinite(r.rel);
          const capped = hasRel && Math.abs(r.rel) > cap;
          const rx = hasRel ? rScale(clampRel(r.rel)) : rScale(0);
          const dir = r.rel < 0 ? -1 : 1;

          return (
            <g
              key={r.name}
              role="button"
              tabIndex={0}
              aria-pressed={r.selected}
              aria-label={`${r.name}: ${fmt(kpi, r.ac)}, Δ${refC} ${fmtDelta(kpi, r.delta)}. Toggle filter`}
              onClick={() => toggle(r)}
              onKeyDown={(e) => onKey(e, r)}
              opacity={dim45 ? 0.45 : 1}
              className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring"
            >
              <title>{tip}</title>
              <rect x={0} y={y - ROW_H / 2} width={W} height={ROW_H} fill="transparent" />
              {r.selected && <rect x={0} y={y - ROW_H / 2 + 4} width={3} height={ROW_H - 8} fill={C.hilite} />}
              <text x={labelW - 8} y={y} dy="0.35em" textAnchor="end" fontSize={11} fontWeight={r.selected ? 700 : 400} fill={C.cat}>
                {short(r.name)}
              </text>

              {/* base tier */}
              {refBar && (
                <rect
                  x={refBar.x}
                  y={y - barH / 2 - shift}
                  width={refBar.w}
                  height={barH}
                  fill={refPaint.fill}
                  stroke={refPaint.stroke}
                  strokeWidth={refPaint.strokeWidth}
                />
              )}
              {acBar && (
                <rect
                  x={acBar.x}
                  y={y - barH / 2 + shift}
                  width={acBar.w}
                  height={barH}
                  fill={prmPaint.fill}
                  stroke={prmPaint.stroke}
                  strokeWidth={prmPaint.strokeWidth}
                />
              )}
              <text
                x={valNeg ? endL - 6 : endR + 6}
                y={y + shift / 2}
                dy="0.35em"
                textAnchor={valNeg ? 'end' : 'start'}
                fontSize={FS}
                fill={primary === 'FC' ? C.fcInk : C.ac}
              >
                {fmt(kpi, r.ac)}
              </text>

              {/* ΔRef tier */}
              {dBar && (
                <>
                  <rect x={dBar.x} y={y - 5.5} width={dBar.w} height={11} fill={dPaint.fill} stroke={dPaint.stroke} strokeWidth={dPaint.strokeWidth} />
                  <text
                    x={r.delta < 0 ? dBar.x - 4 : dBar.x + dBar.w + 4}
                    y={y}
                    dy="0.35em"
                    textAnchor={r.delta < 0 ? 'end' : 'start'}
                    fontSize={FS}
                    fill={good ? C.good : C.bad}
                  >
                    {fmtDelta(kpi, r.delta)}
                  </text>
                </>
              )}

              {/* ΔRef% tier */}
              {hasRel && (
                <>
                  <line x1={rScale(0)} x2={rx} y1={y} y2={y} stroke={good ? C.good : C.bad} strokeWidth={1.6} />
                  <PinHead cx={rx} cy={y} r={3.8} minuend={minuend} uid={uid} />
                  {capped && (
                    <path
                      d={`M${rx + dir * 5},${y - 3.5} L${rx + dir * 10},${y} L${rx + dir * 5},${y + 3.5} Z`}
                      fill={good ? C.good : C.bad}
                    />
                  )}
                  <text
                    x={rx + dir * (capped ? 14 : 8)}
                    y={y}
                    dy="0.35em"
                    textAnchor={dir < 0 ? 'end' : 'start'}
                    fontSize={FS}
                    fill={good ? C.good : C.bad}
                  >
                    {fmtRel(r.rel)}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* axes on top of bars, spanning the full height */}
        <RefAxis code="AC" orient="v" at={baseScale(0)} from={PAD_T - 4} to={H - PAD_B / 2} />
        <RefAxis code={refC} orient="v" at={dScale(0)} from={PAD_T - 4} to={H - PAD_B / 2} />
        <RefAxis code={refC} orient="v" at={rScale(0)} from={PAD_T - 4} to={H - PAD_B / 2} />
      </svg>
    </Tile>
  );
}
