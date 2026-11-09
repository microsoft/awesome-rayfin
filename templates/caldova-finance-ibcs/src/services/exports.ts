/**
 * Excel and PowerPoint exports, loaded only when used (exceljs and pptxgenjs are large).
 * Both follow the screen: the period, the comparison and the forecast with its effective adjustments.
 */
import { monthLabel } from '@/domain/format';
import { adjustableIds, adjustmentStatus } from '@/domain/lock';
import type { Records } from '@/domain/records';
import { periodMonths, type Period } from '@/domain/statements';
import type { Snapshot, Statement, Values } from '@/domain/types';
import { statementLines, type Line } from '@/domain/view';

export interface ExportInput {
  snapshot: Snapshot;
  current: Values['FC'];
  records: Records;
  period: Period;
  comparison: 'PL' | 'PY';
  currentCode: string;
}

const TITLES: Record<Statement, string> = { PL: 'Income statement', BS: 'Balance sheet', CF: 'Cash flow statement' };

function span(p: Period, st: Statement) {
  if (st === 'BS') return `${monthLabel(p.month)} month end`;
  const ms = periodMonths(p);
  return ms.length > 1 ? `${monthLabel(ms[0])} – ${monthLabel(ms[ms.length - 1])}` : monthLabel(ms[0]);
}

const k = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : Math.round(v / 100) / 10);

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fileStem = (x: ExportInput) => `caldova-finance-${x.period.month}-${x.period.mode.toLowerCase()}`;

export async function exportExcel(x: ExportInput) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Caldova Finance';
  for (const st of ['PL', 'BS', 'CF'] as Statement[]) {
    const ws = wb.addWorksheet(TITLES[st]);
    ws.addRow([`${x.snapshot.meta.company} · ${TITLES[st]} · ${span(x.period, st)} · kEUR`]).font = { bold: true };
    const head = ws.addRow(['', 'PL', st === 'BS' ? 'PY year-end' : 'PY', x.currentCode, `Δ${x.comparison}`, `Δ${x.comparison}%`]);
    head.font = { bold: true };
    head.border = { bottom: { style: 'medium' } };
    for (const l of statementLines(x.snapshot, x.current, st, x.period)) {
      const d = x.comparison === 'PL' ? l.dPl : l.dPy;
      const r = x.comparison === 'PL' ? l.rPl : l.rPy;
      const row = l.isKpi
        ? ws.addRow([`${'  '.repeat(l.depth)}${l.account.name}`, l.pl ?? null, l.py ?? null, l.cur ?? null, d ?? null, null])
        : ws.addRow([`${'  '.repeat(l.depth)}${l.account.name}`, k(l.pl), k(l.py), k(l.cur), k(d), r === undefined ? null : r]);
      row.numFmt = '';
      for (const c of [2, 3, 4, 5]) row.getCell(c).numFmt = l.isKpi ? '0.0%' : '#,##0;[Red]-#,##0';
      row.getCell(6).numFmt = '0.0%;[Red]-0.0%';
      if (l.account.rowType !== 'Account') row.font = { bold: l.account.rowType !== 'KPI', italic: l.account.rowType === 'KPI' };
    }
    ws.getColumn(1).width = 42;
    for (const c of [2, 3, 4, 5, 6]) ws.getColumn(c).width = 13;
  }
  const log = wb.addWorksheet('Adjustments');
  log.addRow(['Created', 'Author', 'Address', 'Account', 'Month', 'Amount (EUR)', 'Reason', 'Close', 'Status']).font = { bold: true };
  for (const a of [...x.records.adjustments].sort((p, q) => p.createdAt.getTime() - q.createdAt.getTime())) {
    log.addRow([a.createdAt, a.authorName, a.authorEmail, x.snapshot.accounts.find((s) => s.id === a.accountId)?.name ?? a.accountId, a.month, a.amount, a.reason, a.period, adjustmentStatus(a, x.records.signOffs, x.snapshot.meta.cutoff, adjustableIds(x.snapshot))]);
  }
  const com = wb.addWorksheet('Comments');
  com.addRow(['Created', 'Author', 'Address', 'Statement', 'Line', 'Month', 'Comment']).font = { bold: true };
  for (const c of x.records.comments) com.addRow([c.createdAt, c.authorName, c.authorEmail, TITLES[c.statement], x.snapshot.accounts.find((s) => s.id === c.accountId)?.name ?? c.accountId, c.month, c.body]);
  const so = wb.addWorksheet('Sign-offs');
  so.addRow(['Created', 'Author', 'Address', 'Close', 'Action', 'Frozen adjustments', 'Note']).font = { bold: true };
  for (const s of x.records.signOffs) so.addRow([s.createdAt, s.authorName, s.authorEmail, s.month, s.action, s.frozenIds?.length ?? 0, s.note ?? '']);
  for (const ws of [log, com, so]) ws.columns.forEach((c) => (c.width = 20));
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileStem(x)}.xlsx`);
}

const fmtCell = (l: Line, v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : l.isKpi ? `${(v * 100).toFixed(1)}%` : Math.round(v / 1000).toLocaleString('en-GB'));

export async function exportPowerPoint(x: ExportInput) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  for (const st of ['PL', 'BS', 'CF'] as Statement[]) {
    const lines = statementLines(x.snapshot, x.current, st, x.period).filter((l) => st !== 'PL' || l.depth === 0);
    const slide = pptx.addSlide();
    const key = lines.find((l) => l.account.id === (st === 'PL' ? 'F-NI' : st === 'BS' ? 'B-EQ' : 'C-OP'));
    const d = key ? (x.comparison === 'PL' ? key.dPl : key.dPy) : undefined;
    slide.addText(`${x.snapshot.meta.company} · ${TITLES[st]} · ${span(x.period, st)} · kEUR`, { x: 0.4, y: 0.25, w: 12.5, h: 0.3, fontSize: 11, color: '6B6B6B', fontFace: 'Arial' });
    slide.addText(
      key && d !== undefined ? `${key.account.name} ${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d / 1000)).toLocaleString('en-GB')} kEUR vs ${x.comparison === 'PL' ? 'budget' : 'previous year'}` : TITLES[st],
      { x: 0.4, y: 0.55, w: 12.5, h: 0.5, fontSize: 22, bold: true, color: '2B2B2B', fontFace: 'Arial' }
    );
    const none = { type: 'none' as const };
    const rule = { type: 'solid' as const, pt: 1.5, color: '2B2B2B' };
    const header = ['', 'PL', st === 'BS' ? 'PY YE' : 'PY', x.currentCode, `Δ${x.comparison}`].map((t) => ({
      text: t,
      options: { bold: true, color: '2B2B2B', border: [none, none, rule, none] as [typeof none, typeof none, typeof rule, typeof none] },
    }));
    const rows = lines.map((l) => {
      const dd = x.comparison === 'PL' ? l.dPl : l.dPy;
      const tone = dd === undefined || l.goodUp === null || Math.abs(dd) < 500 ? 'neutral' : (dd > 0) === l.goodUp ? 'good' : 'bad';
      const bold = l.account.rowType === 'Formula' || l.account.parentId === null;
      return [
        { text: `${'   '.repeat(l.depth)}${l.account.name}`, options: { bold, italic: l.isKpi } },
        { text: fmtCell(l, l.pl), options: { align: 'right' as const } },
        { text: fmtCell(l, l.py), options: { align: 'right' as const, color: '6B6B6B' } },
        { text: fmtCell(l, l.cur), options: { align: 'right' as const, bold } },
        { text: l.isKpi ? '' : dd === undefined ? '' : `${dd >= 0 ? '+' : '−'}${Math.abs(Math.round(dd / 1000)).toLocaleString('en-GB')}`, options: { align: 'right' as const, color: tone === 'good' ? '5DBB2C' : tone === 'bad' ? 'FF0000' : '2B2B2B' } },
      ];
    });
    slide.addTable([header, ...rows], { x: 0.4, y: 1.25, w: 12.5, colW: [5.3, 1.8, 1.8, 1.8, 1.8], fontSize: lines.length > 18 ? 9 : 11, fontFace: 'Arial', rowH: 0.24, color: '2B2B2B' });
    slide.addText('Based on IBCS notation (not certified). Fictional data.', { x: 0.4, y: 7.05, w: 12.5, h: 0.25, fontSize: 8, color: '6B6B6B' });
  }
  await pptx.writeFile({ fileName: `${fileStem(x)}.pptx` });
}
