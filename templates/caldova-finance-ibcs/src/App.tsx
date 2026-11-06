import { useState } from 'react';

import { ActionDrawer } from '@/components/ActionDrawer';
import { AuthPage } from '@/components/AuthPage';
import { Header, type PageId, type View } from '@/components/Header';
import { OriginalStatement } from '@/components/OriginalStatement';
import { useAuth } from '@/hooks/AuthContext';
import { FinanceProvider, useFinance } from '@/hooks/FinanceContext';
import { BalancePage } from '@/pages/BalancePage';
import { CashFlowPage } from '@/pages/CashFlowPage';
import { IncomePage } from '@/pages/IncomePage';
import { OFFLINE } from '@/services/bootstrap';

function Shell() {
  const f = useFinance();
  const [page, setPage] = useState<PageId>('PL');
  // Per page: our IBCS table with actions (default) or Michael Tenner's original visual (read only).
  const [views, setViews] = useState<Record<PageId, View>>({ PL: 'table', BS: 'table', CF: 'table' });
  const view = views[page];
  const [exporting, setExporting] = useState(false);

  const onExport = (kind: 'xlsx' | 'pptx') => {
    setExporting(true);
    const input = { snapshot: f.snapshot, current: f.current, records: f.records, period: f.period, comparison: f.comparison, currentCode: f.currentCode };
    import('@/services/exports')
      .then((m) => (kind === 'xlsx' ? m.exportExcel(input) : m.exportPowerPoint(input)))
      .catch((e: unknown) => alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setExporting(false));
  };

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-2 px-4 pb-1 pt-2">
      <Header
        page={page}
        onPage={(p) => {
          setPage(p);
          f.select(null);
        }}
        view={view}
        onView={(v) => {
          setViews((s) => ({ ...s, [page]: v }));
          f.select(null);
        }}
        onExport={onExport}
      />
      <main className="relative min-h-0">
        <div className="h-full min-h-0">
          {view === 'visual' ? <OriginalStatement statement={page} /> : page === 'PL' ? <IncomePage /> : page === 'BS' ? <BalancePage /> : <CashFlowPage />}
        </div>
        {/* Over the chart column (42 % of the page), never over the table. */}
        {f.selection && view === 'table' && (
          <div className="absolute inset-y-0 right-0 w-[calc(42%-0.5rem)] bg-paper">
            <ActionDrawer />
          </div>
        )}
      </main>
      <footer className="flex justify-between gap-4 truncate text-[10px] text-muted">
        <span>
          {f.error ? (
            <span className="text-bad">{f.error}</span>
          ) : exporting ? (
            'Preparing the export…'
          ) : (
            `Records as of ${f.records.readAt.toLocaleTimeString('en-GB')}`
          )}
          {OFFLINE && ' · Offline demo: records stay in this browser'}
        </span>
        <span>
          Fictional data · IBCS notation, not certified · After Michael Tenner's IBCS Finance Cockpit (DatenWG) · Statements baked{' '}
          {new Date(f.snapshot.meta.bakedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center text-muted">Signing in…</div>;
  if (!isAuthenticated) return <AuthPage />;
  return (
    <FinanceProvider>
      <Shell />
    </FinanceProvider>
  );
}
