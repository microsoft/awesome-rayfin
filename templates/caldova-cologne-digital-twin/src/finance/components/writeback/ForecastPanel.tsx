// "Forecast to Excel" on the P&L page (Caldova Finance tab).
//
// The cockpit's ForecastPanel was an Excel ROUND TRIP: download the open months, edit, upload, review the
// diff, save audited adjustments. Writeback is off in the twin ("later if ever"), so only the download
// remains: the forecast of the open months per P&L block, as the cockpit's own workbook (exceljs, lazy).

import { Download, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useSemanticModelQuery } from '@finance/hooks/use-semantic-model-query';
import { useWriteback } from '@finance/hooks/use-writeback';
import { buildGrid, type FcCell, type FcGrid } from '@finance/lib/excel/fc-grid';
import { LINE_OPEX } from '@finance/lib/pnl/engine';
import { fcMonate } from '@finance/queries/guv';

function parseCells(t: { columns: { name: string }[]; rows: unknown[][] }): FcCell[] {
  const i = (n: string) => t.columns.findIndex((c) => c.name.endsWith(`[${n}]`));
  const [a, nm, l2, l3, mo, fc] = ['AccountID', 'Name', 'L2', 'L3', 'Month', 'FC'].map(i);
  return t.rows.map((r) => ({ account: String(r[a] ?? ''), name: String(r[nm] ?? ''), l2: String(r[l2] ?? ''), l3: String(r[l3] ?? ''), month: String(r[mo] ?? ''), fc: Number(r[fc] ?? 0) || 0 }));
}

export function ForecastPanel({ year, blocks, hasOpenMonths }: { year: number; blocks: string[]; hasOpenMonths: boolean }) {
  const wb = useWriteback();
  const [block, setBlock] = useState(blocks.includes(LINE_OPEX) ? LINE_OPEX : (blocks[0] ?? ''));
  const q = fcMonate(year, block);
  const res = useSemanticModelQuery({ connection: q.connection, query: hasOpenMonths && block ? q.query : '' });
  const grid: FcGrid | null = useMemo(
    () => (res.data?.status === 'success' ? buildGrid(year, block, parseCells(res.data.table), wb.effective) : null),
    [res.data, year, block, wb.effective]
  );
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (!grid) return;
    setBusy(true);
    try {
      const { writeWorkbook } = await import('@finance/lib/excel/fc-workbook');
      const blob = await writeWorkbook(grid);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Forecast ${block} ${year}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Forecast to Excel" className="flex flex-col gap-200 rounded-xl bg-secondary p-400" data-testid="fc-export">
      <h2 className="flex items-center gap-200 text-100 font-semibold tracking-wide text-muted-foreground uppercase">
        <FileSpreadsheet className="icon-size-100" aria-hidden="true" /> Forecast to Excel
      </h2>
      {!hasOpenMonths ? (
        <p className="text-200 text-muted-foreground">This year has no open months.</p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-200 text-200 text-muted-foreground">
            P&amp;L block
            <select value={block} onChange={(e) => setBlock(e.target.value)} className="h-[32px] max-w-[200px] rounded-md border border-input bg-background px-200 text-200 text-foreground">
              {blocks.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <p className="text-100 text-muted-foreground">Forecast of the open months per account, from the model. Download only: adjustments are not written back.</p>
          {res.data?.status === 'error' && <p className="text-100 text-destructive">{res.data.error.message}</p>}
          <button
            type="button"
            disabled={!grid || busy}
            onClick={() => void download()}
            className="flex items-center gap-100 self-start rounded-md border border-border bg-card px-300 py-100 text-200 hover:bg-accent disabled:opacity-40"
          >
            <Download className="icon-size-100" aria-hidden="true" /> {busy ? 'Creating Excel file…' : 'Download Excel'}
          </button>
        </>
      )}
    </section>
  );
}
