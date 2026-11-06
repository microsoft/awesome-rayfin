import { useState } from 'react';

import { monthLabel } from '@/domain/format';
import { useAuth } from '@/hooks/AuthContext';
import { useFinance } from '@/hooks/FinanceContext';

export type PageId = 'PL' | 'BS' | 'CF';
export type View = 'table' | 'visual';
export const PAGES: { id: PageId; label: string }[] = [
  { id: 'PL', label: 'Income statement' },
  { id: 'BS', label: 'Balance sheet' },
  { id: 'CF', label: 'Cash flow' },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded border border-ink text-[12px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`px-2 py-[3px] ${value === o.id ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-soft'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Header({
  page,
  onPage,
  view,
  onView,
  onExport,
}: {
  page: PageId;
  onPage(p: PageId): void;
  view: View;
  onView(v: View): void;
  onExport(kind: 'xlsx' | 'pptx'): void;
}) {
  const f = useFinance();
  const { user, signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const year = f.period.month.slice(0, 4);
  const months = f.snapshot.months;
  const signed = f.close.signedOff;

  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-ink pb-2">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[18px] font-bold tracking-tight">Caldova Finance</h1>
        <nav className="flex gap-1" aria-label="Statements">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPage(p.id)}
              aria-current={page === p.id ? 'page' : undefined}
              className={`border-b-2 px-2 py-1 text-[13px] ${page === p.id ? 'border-ink font-semibold' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center justify-center gap-3">
        <label className="flex items-center gap-1 text-[12px]">
          <span className="sr-only">Month</span>
          <select value={f.period.month} onChange={(e) => f.setMonth(e.target.value)} className="rounded border border-ink bg-paper px-1 py-[3px] text-[12px]">
            {months.map((m) => (
              <option key={m.id} value={m.id}>
                {monthLabel(m.id)}
                {m.id === f.snapshot.meta.cutoff ? ' (last closed)' : m.id > f.snapshot.meta.cutoff ? ' FC' : ''}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label="View"
          value={view}
          onChange={onView}
          options={[
            { id: 'table', label: 'Table' },
            { id: 'visual', label: 'Original visual' },
          ]}
        />
        {page !== 'BS' && view === 'table' && (
          <Segmented
            label="Period"
            value={f.period.mode}
            onChange={f.setMode}
            options={[
              { id: 'MTD', label: 'Month' },
              { id: 'YTD', label: `YTD ${year}` },
            ]}
          />
        )}
        {view === 'table' && (
          <Segmented
            label="Compare with"
            value={f.comparison}
            onChange={f.setComparison}
            options={[
              { id: 'PL', label: 'vs Budget' },
              { id: 'PY', label: page === 'BS' ? 'vs PY year-end' : 'vs PY' },
            ]}
          />
        )}
      </div>

      <div className="flex items-center gap-2 text-[12px]">
        <div className="text-right leading-4" role="status">
          <div className="font-semibold">
            {monthLabel(f.close.period)} close: {signed ? 'signed off' : 'open'}
          </div>
          <div className="text-muted">
            {f.close.latest
              ? `${f.close.latest.action === 'sign-off' ? 'by' : 'reopened by'} ${f.close.latest.authorEmail}, ${f.close.latest.createdAt.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`
              : 'forecast can be adjusted'}
          </div>
        </div>
        {f.canSignOff &&
          (confirm ? (
            <span className="flex gap-1">
              <button
                type="button"
                disabled={f.busy}
                className="rounded bg-ink px-2 py-[3px] text-paper"
                onClick={() => {
                  setConfirm(false);
                  void f.setClose(signed ? 'reopen' : 'sign-off').catch(() => {});
                }}
              >
                Confirm
              </button>
              <button type="button" className="rounded border border-ink px-2 py-[3px]" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" disabled={f.busy} className="rounded border border-ink px-2 py-[3px] hover:bg-soft" onClick={() => setConfirm(true)}>
              {signed ? 'Reopen close' : 'Sign off close'}
            </button>
          ))}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded border border-ink px-2 py-[3px] hover:bg-soft">Export</summary>
          <div className="absolute right-0 z-20 mt-1 grid w-44 gap-1 rounded border border-ink bg-paper p-1 shadow">
            <button type="button" className="rounded px-2 py-1 text-left hover:bg-soft" onClick={() => onExport('xlsx')}>
              Excel: statements + log
            </button>
            <button type="button" className="rounded px-2 py-1 text-left hover:bg-soft" onClick={() => onExport('pptx')}>
              PowerPoint: board pack
            </button>
          </div>
        </details>
        <button type="button" className="text-muted hover:text-ink" title={user?.email} onClick={() => void signOut()}>
          {user?.name}
        </button>
      </div>
    </header>
  );
}
