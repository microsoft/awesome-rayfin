// One-click PowerPoint of the current cockpit view (pptxgenjs, loaded only on
// use). Native, editable shapes in IBCS-inspired notation: AC solid dark,
// PL outlined, FC light with dashed outline (PowerPoint shapes have no hatch),
// variances in the user's palette colours; a message title on every slide.

import type { Cube, MemberFilter, ScenarioChoice, Scen } from '@finance/lib/cockpit/cube';
import { favourable, HEADLINE, kpiValue, type KpiDef } from '@finance/lib/cockpit/kpis';

export interface DeckInput {
  cube: Cube;
  catalogue: KpiDef[];
  kpi: KpiDef;
  months: number[];
  filter: MemberFilter;
  choice: ScenarioChoice;
  ref: Exclude<Scen, 'ACT'>;
  periodLabel: string;
  filterLabel: string;
  colors: { good: string; bad: string };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AC = '404040';
const INK = '0F1E2E';
const hex = (c: string) => c.replace('#', '').toUpperCase();

function fmt(k: KpiDef, v: number): string {
  if (!Number.isFinite(v)) return '–';
  if (k.unit === 'pct') return `${(v * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
  if (k.unit === 'mio') return (v / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (k.unit === 'tsd') return (v / 1e3).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}
const unit = (k: KpiDef) => (k.unit === 'mio' ? 'mEUR' : k.unit === 'tsd' ? 'k' : k.unit === 'pct' ? '%' : k.unit === 'pts' ? 'points' : k.unit === 'km' ? 'km' : 'EUR');

/** Builds the deck (exported separately for tests). */
export async function buildCockpitDeck(d: DeckInput) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = `Finance Cockpit ${d.periodLabel}`;
  const v = (k: KpiDef, s: Scen, ms = d.months) => kpiValue(d.cube, k, s, ms, d.filter, d.choice);
  const sub = `${d.periodLabel} · AC vs ${d.ref}${d.filterLabel ? ` · ${d.filterLabel}` : ''} · demo data · IBCS-based notation`;

  // ---- slide 1: KPI table with variances ----
  const s1 = pptx.addSlide();
  const rev = d.catalogue.find((k) => k.id === 'Revenue') ?? d.kpi;
  const dRev = v(rev, 'ACT') - v(rev, d.ref);
  s1.addText(`Revenue ${dRev >= 0 ? 'above' : 'below'} ${d.ref}: ${dRev >= 0 ? '+' : '−'}${fmt(rev, Math.abs(dRev))} ${unit(rev)}`, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: INK, fontFace: 'Segoe UI' });
  s1.addText(sub, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontSize: 12, color: '6B7280', fontFace: 'Segoe UI' });
  const header = ['KPI', 'Unit', d.ref, 'AC', `Δ${d.ref}`, `Δ${d.ref}%`].map((t) => ({ text: t, options: { bold: true, color: INK, fill: { color: 'ECEBE5' } } }));
  const rows = d.catalogue
    .filter((k) => HEADLINE.includes(k.id) || k.base)
    .slice(0, 14)
    .map((k) => {
      const a = v(k, 'ACT');
      const r = v(k, d.ref);
      const delta = a - r;
      const good = favourable(k, delta) >= 0;
      const col = hex(good ? d.colors.good : d.colors.bad);
      const rel = r ? delta / Math.abs(r) : NaN;
      return [
        { text: k.label },
        { text: unit(k), options: { color: '6B7280' } },
        { text: fmt(k, r), options: { align: 'right' as const } },
        { text: fmt(k, a), options: { align: 'right' as const, bold: true } },
        { text: `${delta >= 0 ? '+' : '−'}${fmt(k, Math.abs(delta))}`, options: { align: 'right' as const, color: col } },
        { text: Number.isFinite(rel) && k.unit !== 'pct' ? `${rel >= 0 ? '+' : '−'}${Math.abs(rel * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%` : '', options: { align: 'right' as const, color: col } },
      ];
    });
  s1.addTable([header, ...rows], { x: 0.5, y: 1.5, w: 12.3, fontFace: 'Segoe UI', fontSize: 12, color: INK, border: { type: 'solid', pt: 0.5, color: 'E1DFD6' }, rowH: 0.34 });

  // ---- slide 2: monthly columns AC/FC vs reference, with variance bars ----
  const k = d.kpi;
  const s2 = pptx.addSlide();
  const ms = Array.from({ length: 12 }, (_, i) => i + 1);
  const num = (x: number) => (Number.isFinite(x) ? x : 0);
  const pts = ms.map((m) => ({ m, actual: m <= d.cube.lastAc, val: num(v(k, m <= d.cube.lastAc ? 'ACT' : 'FC', [m])), ref: num(v(k, d.ref, [m])) }));
  const ytdA = v(k, 'ACT');
  const ytdR = v(k, d.ref);
  s2.addText(`${k.label}: ${ytdA - ytdR >= 0 ? '+' : '−'}${fmt(k, Math.abs(ytdA - ytdR))} ${unit(k)} against ${d.ref}`, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: INK, fontFace: 'Segoe UI' });
  s2.addText(`${k.label} by month · ${unit(k)} · AC/FC vs ${d.ref} · ${d.cube.year}`, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontSize: 12, color: '6B7280', fontFace: 'Segoe UI' });
  const max = Math.max(...pts.flatMap((p) => [Math.abs(p.val), Math.abs(p.ref)]), 1);
  const maxD = Math.max(...pts.map((p) => Math.abs(p.val - p.ref)).filter(Number.isFinite), 1);
  const x0 = 0.8;
  const slot = 12.0 / 12;
  const base = 6.6;
  const hMax = 3.2;
  const dBase = 2.3;
  const dMax = 0.7;
  for (const [i, p] of pts.entries()) {
    const x = x0 + i * slot;
    const w = slot * 0.36;
    // magnitudes only; negative values (a loss month) are drawn as bars and labelled with their sign
    const hv = (Math.abs(p.val) / max) * hMax;
    const hr = (Math.abs(p.ref) / max) * hMax;
    // reference: outlined (PL) or grey (PY), left and behind (order PL, PY, AC, FC)
    s2.addShape(pptx.ShapeType.rect, {
      x,
      y: base - hr,
      w,
      h: hr,
      fill: d.ref === 'PY' ? { color: 'A8A8A8' } : d.ref === 'FC' ? { color: 'E4E4E4' } : { color: 'FFFFFF' },
      line: { color: AC, width: d.ref === 'PY' ? 0 : 1, dashType: d.ref === 'FC' ? 'dash' : 'solid' },
    });
    // AC solid, FC light with dashed outline, right and in front
    s2.addShape(pptx.ShapeType.rect, {
      x: x + w * 0.45,
      y: base - hv,
      w,
      h: hv,
      fill: { color: p.actual ? AC : 'E4E4E4' },
      line: { color: AC, width: p.actual ? 0 : 1, dashType: p.actual ? 'solid' : 'dash' },
    });
    s2.addText(fmt(k, p.val), { x: x - 0.1, y: base - hv - 0.3, w: slot, h: 0.25, fontSize: 9, color: INK, align: 'center', fontFace: 'Segoe UI' });
    s2.addText(MON[p.m - 1], { x: x - 0.1, y: base + 0.05, w: slot, h: 0.25, fontSize: 10, color: INK, align: 'center', bold: true, fontFace: 'Segoe UI' });
    // variance bar above
    const dv = p.val - p.ref;
    const hd = (Math.abs(dv) / maxD) * dMax;
    const good = favourable(k, dv) >= 0;
    s2.addShape(pptx.ShapeType.rect, { x: x + w * 0.2, y: dv >= 0 ? dBase - hd : dBase, w: w * 1.1, h: Math.max(hd, 0.01), fill: { color: hex(good ? d.colors.good : d.colors.bad) }, line: { width: 0 } });
    s2.addText(`${dv >= 0 ? '+' : '−'}${fmt(k, Math.abs(dv))}`, { x: x - 0.1, y: dv >= 0 ? dBase - hd - 0.27 : dBase + hd + 0.02, w: slot, h: 0.25, fontSize: 9, color: hex(good ? d.colors.good : d.colors.bad), align: 'center', fontFace: 'Segoe UI' });
  }
  s2.addShape(pptx.ShapeType.line, { x: x0 - 0.1, y: dBase, w: 12.1, h: 0, line: { color: AC, width: 1 } });
  s2.addShape(pptx.ShapeType.line, { x: x0 - 0.1, y: base, w: 12.1, h: 0, line: { color: AC, width: 1 } });
  s2.addText(`Δ${d.ref}`, { x: 0.1, y: dBase - 0.6, w: 0.7, h: 0.3, fontSize: 10, color: '6B7280', fontFace: 'Segoe UI' });
  const refLegend = d.ref === 'PY' ? 'PY grey' : d.ref === 'PL' ? 'PL outlined' : 'FC (comparison) light dashed';
  s2.addText(`${refLegend} · AC dark · FC light dashed (no hatching, PowerPoint shape)`, { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontSize: 10, color: '6B7280', fontFace: 'Segoe UI' });

  return pptx;
}

export async function exportCockpitPptx(d: DeckInput): Promise<void> {
  const pptx = await buildCockpitDeck(d);
  await pptx.writeFile({ fileName: `Finance Cockpit ${d.periodLabel}.pptx` });
}
