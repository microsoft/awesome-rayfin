import { useEffect, useMemo, useState } from 'react';

import { forecastMonths, isAdjustable, isCogsLeaf, isRevenueLeaf } from '@/domain/engine';
import { fmtDeltaK, fmtK, fmtPct, monthLabel } from '@/domain/format';
import { adjustableIds, adjustmentStatus } from '@/domain/lock';
import { statementLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';

const STATUS_TEXT = {
  applied: 'applied',
  'signed-off': 'not applied: not in the signed-off close',
  'actual-month': 'not applied: month is actual',
  'other-close': 'not applied: from an earlier close',
  invalid: 'not applied: not an adjustable line',
} as const;
const when = (d: Date) => d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

/** Comments and forecast adjustments for the selected line. Opens beside the page, never over the table. */
export function ActionDrawer() {
  const f = useFinance();
  const { snapshot, selection, records, period } = f;
  const [comment, setComment] = useState('');
  const [amountK, setAmountK] = useState('');
  const [reason, setReason] = useState('');
  const fcMonths = useMemo(() => forecastMonths(snapshot), [snapshot]);
  const [adjMonth, setAdjMonth] = useState(fcMonths[0] ?? '');

  const account = snapshot.accounts.find((a) => a.id === selection?.accountId);
  // Refresh when the drawer opens on a line, so two people do not work on stale records.
  const { refresh } = f;
  useEffect(() => {
    if (selection) void refresh().catch(() => {});
  }, [selection, refresh]);

  // The adjustable leaves under the selected line (or the line itself).
  const leaves = useMemo(() => {
    if (!account || account.statement !== 'PL') return [];
    const under = (id: string): boolean => {
      for (let p: string | null = id; p; p = snapshot.accounts.find((a) => a.id === p)?.parentId ?? null) if (p === account.id) return true;
      return false;
    };
    return snapshot.accounts.filter((a) => isAdjustable(a) && under(a.id));
  }, [account, snapshot]);
  const [adjAccount, setAdjAccount] = useState('');
  useEffect(() => setAdjAccount(leaves[0]?.id ?? ''), [leaves]);

  if (!selection || !account) return null;
  const line = statementLines(snapshot, f.current, account.statement, period).find((l) => l.account.id === account.id);
  const comments = records.comments.filter((c) => c.statement === account.statement && c.accountId === account.id && c.month === period.month).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const leafIds = new Set(leaves.map((l) => l.id));
  const adjustments = records.adjustments.filter((a) => leafIds.has(a.accountId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const amount = Number(amountK.replace(',', '.')) * 1000;
  const leaf = snapshot.accounts.find((a) => a.id === adjAccount);
  const orientation = !leaf
    ? ''
    : isRevenueLeaf(leaf.id)
      ? leaf.sign > 0
        ? 'more revenue'
        : 'more discounts'
      : leaf.sign > 0
        ? 'more income'
        : isCogsLeaf(leaf.id)
          ? 'more cost of goods'
          : 'more cost';
  const fmt = (v: number | undefined) => (line?.isKpi ? fmtPct(v) : fmtK(v));

  return (
    <aside className="grid h-full min-h-0 w-full grid-rows-[auto_auto_minmax(0,1fr)] gap-3 border-l border-ink pl-3" aria-label="Actions for the selected line">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase text-muted">{account.statement === 'PL' ? 'Income statement' : account.statement === 'BS' ? 'Balance sheet' : 'Cash flow'} · {monthLabel(period.month)}</div>
          <h2 className="text-[15px] font-semibold">{account.name}</h2>
        </div>
        <button type="button" className="text-muted hover:text-ink" aria-label="Close" onClick={() => f.select(null)}>
          ✕
        </button>
      </div>

      {line && (
        <dl className="grid grid-cols-4 gap-1 text-[12px]">
          <div><dt className="text-muted">PL</dt><dd>{fmt(line.pl)}</dd></div>
          <div><dt className="text-muted">PY</dt><dd>{fmt(line.py)}</dd></div>
          <div><dt className="text-muted">{f.currentCode}</dt><dd className="font-semibold">{fmt(line.cur)}</dd></div>
          <div><dt className="text-muted">Δ{f.comparison}</dt><dd>{line.isKpi ? '' : fmtDeltaK(f.comparison === 'PL' ? line.dPl : line.dPy)}</dd></div>
        </dl>
      )}

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-1">
          <h3 className="text-[12px] font-semibold">Comments, {monthLabel(period.month)}</h3>
          <ul className="panel space-y-1 text-[12px]">
            {comments.length === 0 && <li className="text-muted">No comment yet.</li>}
            {comments.slice(0, 4).map((c) => (
              <li key={c.id} className="border-l-2 border-hair pl-2">
                <div>{c.body}</div>
                <div className="text-[11px] text-muted" title={c.authorEmail}>{c.authorName} ({c.authorEmail}), {when(c.createdAt)}</div>
              </li>
            ))}
            {comments.length > 4 && <li className="text-[11px] text-muted">{comments.length - 4} older in the Excel export</li>}
          </ul>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              void f.addComment({ statement: account.statement, accountId: account.id, month: period.month, body: comment.trim() }).then(() => setComment('')).catch(() => {});
            }}
          >
            <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Explain this line…" className="min-w-0 flex-1 rounded border border-hair px-2 py-1 text-[12px]" />
            <button type="submit" disabled={f.busy || !comment.trim()} className="rounded bg-ink px-2 text-[12px] text-paper disabled:opacity-40">
              Add
            </button>
          </form>
        </section>

        {account.statement === 'PL' && leaves.length > 0 && fcMonths.length > 0 ? (
          <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-1">
            <h3 className="text-[12px] font-semibold">Adjust the forecast ({monthLabel(f.close.period)} close)</h3>
            {f.close.signedOff ? (
              <p className="text-[12px] text-muted">The close is signed off. A controller can reopen it.</p>
            ) : (
              <form
                className="grid grid-cols-2 gap-1 text-[12px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!Number.isFinite(amount) || amount === 0 || !reason.trim() || !adjAccount) return;
                  void f
                    .addAdjustment({ accountId: adjAccount, month: adjMonth, amount, reason: reason.trim() })
                    .then(() => {
                      setAmountK('');
                      setReason('');
                    })
                    .catch(() => {});
                }}
              >
                <select aria-label="Account" value={adjAccount} onChange={(e) => setAdjAccount(e.target.value)} className="col-span-2 rounded border border-hair px-1 py-1">
                  {leaves.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <select aria-label="Month" value={adjMonth} onChange={(e) => setAdjMonth(e.target.value)} className="rounded border border-hair px-1 py-1">
                  {fcMonths.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
                <input aria-label="Amount in kEUR" value={amountK} onChange={(e) => setAmountK(e.target.value)} inputMode="decimal" placeholder={`kEUR, + = ${orientation}`} className="rounded border border-hair px-2 py-1" />
                <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (required)" className="col-span-2 rounded border border-hair px-2 py-1" />
                <button type="submit" disabled={f.busy || !reason.trim() || !Number.isFinite(amount) || amount === 0} className="col-span-2 rounded bg-ink py-1 text-paper disabled:opacity-40">
                  Save adjustment
                </button>
              </form>
            )}
            <ul className="panel space-y-1 text-[11px]">
              {adjustments.slice(0, 4).map((a) => {
                const st = adjustmentStatus(a, records.signOffs, snapshot.meta.cutoff, adjustableIds(snapshot));
                return (
                  <li key={a.id} className={st === 'applied' ? '' : 'text-muted line-through decoration-1'}>
                    <span className="font-semibold">{fmtDeltaK(a.amount)}</span> {snapshot.accounts.find((x) => x.id === a.accountId)?.name}, {monthLabel(a.month)}: {a.reason}
                    <span className="block text-muted no-underline">{a.authorName} ({a.authorEmail}), {when(a.createdAt)} · {STATUS_TEXT[st]}</span>
                  </li>
                );
              })}
              {adjustments.length === 0 && <li className="text-muted">No adjustment on this line.</li>}
            </ul>
          </section>
        ) : (
          <section className="text-[12px] text-muted">
            {account.statement === 'PL'
              ? 'Taxes follow from the result and are not adjusted.'
              : 'Balance sheet and cash flow follow from the P&L forecast and the stated drivers. Adjust the P&L to move them.'}
          </section>
        )}
      </div>
      <div className="sr-only" aria-live="polite">{f.error ?? ''}</div>
    </aside>
  );
}
