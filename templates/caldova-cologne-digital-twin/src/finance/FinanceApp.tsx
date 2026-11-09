// The Caldova "Finance" tab: Michael Tenner's Finance Cockpit (DatenWG), ported (SOURCE.md).
//
// A LEAN shell instead of the cockpit's App.tsx, which also carried sign-in, writeback, saved views, the
// command palette, story mode, videos, the IndexedDB cache and its own theme switch (all out by decision,
// §11). What stays: the four pages, the filter breadcrumb with undo/redo, the collapsible control pane.
//
// ⚠️ NO GLOBAL SIDE EFFECTS (review findings 1, 8): the route lives in React state, not in the twin's URL
// hash; the palette and the header height are set on THIS tab's root, never on <html>; every keyboard
// shortcut is active only while the tab is shown (`active`), so the twin's flight keys never collide.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ShellContext, type ShellContextValue } from '@finance/hooks/shell.context';
import { WritebackProvider } from '@finance/hooks/use-writeback';
import { DEFAULT_PALETTE } from '@finance/lib/palette';
import { loadFinanceSnapshot } from '@finance/lib/snapshot';
import { formatRoute, historyInit, historyPush, historyRedo, historyReplace, historyUndo, PAGES, parseRoute, type History, type PageId } from '@finance/lib/route';
import { cn } from '@finance/lib/utils';
import { CockpitPage } from '@finance/pages/CockpitPage';
import { GuvPage } from '@finance/pages/GuvPage';

/** "As of 20 Oct 2026, 23:47 · Actuals to September 2026", in the viewer's time zone. */
function standLabel(bakedAt: string, lastActual: string): string {
  const baked = new Date(bakedAt);
  const parts = [`As of ${baked.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${baked.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`];
  const m = /^(\d{4})-(\d{2})/.exec(lastActual);
  if (m) parts.push(`Actuals to ${new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`);
  return parts.join(' · ');
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function FinanceApp({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);

  // ---------- route + history (in memory) ----------
  const [hist, setHist] = useState<History>(() => historyInit(formatRoute({ page: 'cockpit', qs: '' }), Date.now()));
  const route = useMemo(() => parseRoute(hist.present), [hist.present]);
  const setQs = useCallback((qs: string) => setHist((h) => historyPush(h, formatRoute({ page: parseRoute(h.present).page, qs }), Date.now())), []);
  const go = useCallback((page: PageId, qs = '') => setHist((h) => historyPush(h, formatRoute({ page, qs }), Date.now(), { coalesce: false })), []);
  const replaceQs = useCallback((qs: string) => setHist((h) => historyReplace(h, formatRoute({ page: parseRoute(h.present).page, qs }))), []);
  const undo = useCallback(() => setHist(historyUndo), []);
  const redo = useCallback(() => setHist(historyRedo), []);

  // Each page keeps its last state when you switch away and back.
  const lastQs = useRef<Partial<Record<PageId, string>>>({});
  useEffect(() => {
    lastQs.current[route.page] = route.qs;
  }, [route]);
  const goPage = useCallback((page: PageId) => go(page, lastQs.current[page] ?? ''), [go]);

  const [paneOpen, setPaneOpen] = useState(() => !window.matchMedia?.('(max-width: 1279px)').matches);

  // "As of": when the snapshot was baked and the last actual month it holds.
  const [stand, setStand] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadFinanceSnapshot()
      .then((s) => live && setStand(standLabel(s.bakedAt, s.lastActual)))
      .catch(() => undefined); // the pages show the load error themselves
    return () => {
      live = false;
    };
  }, []);

  // ---------- keyboard: only while this tab is in front ----------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.repeat) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= PAGES.length) {
        e.preventDefault();
        goPage(PAGES[Number(e.key) - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, undo, redo, goPage]);

  // Header height for the sticky breadcrumb and pane: on this tab's root, not on <html>.
  useLayoutEffect(() => {
    const el = header.current;
    const host = root.current;
    if (!el || !host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => host.style.setProperty('--header-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shell: ShellContextValue = {
    page: route.page,
    qs: route.qs,
    setQs,
    replaceQs,
    go,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    copyLink: async () => false,
    paneOpen,
    setPaneOpen,
    // Decision 2026-10-20: fixed IBCS green/red, no palette switch.
    palette: DEFAULT_PALETTE,
    setPalette: () => undefined,
    registerCommands: () => () => undefined, // no command palette in the tab
    openPalette: () => undefined,
  };

  return (
    <ShellContext.Provider value={shell}>
      <WritebackProvider>
        <div ref={root} data-tab="finance" data-palette={DEFAULT_PALETTE} className="flex min-h-full flex-col bg-background font-base text-foreground">
          <header ref={header} role="banner" className="sticky top-0 z-30 border-b border-border bg-card">
            <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-500 gap-y-200 px-400 py-300 md:px-600">
              <div>
                <h1 className="font-heading text-500 leading-500 font-bold tracking-tight">Finance</h1>
                <p className="hidden text-200 text-foreground/70 sm:block">Caldova logistics centre Cologne · controlling and P&amp;L · IBCS-based notation</p>
              </div>
              <nav aria-label="Pages" className="order-3 -mx-100 flex w-full gap-100 overflow-x-auto lg:order-none lg:w-auto">
                {PAGES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`fin-page-${p.id}`}
                    onClick={() => goPage(p.id)}
                    aria-current={p.id === route.page ? 'page' : undefined}
                    className={cn(
                      'shrink-0 rounded-md px-300 py-100-nudge text-200 font-medium focus-visible:outline-2 focus-visible:outline-ring',
                      p.id === route.page ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <span className="sm:hidden">{p.short}</span>
                    <span className="hidden sm:inline">{p.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </header>

          <main className="flex-1">
            {route.page === 'cockpit' && <CockpitPage />}
            {route.page === 'guv' && <GuvPage />}
          </main>

          <footer className="border-t border-border bg-card">
            <div className="mx-auto flex max-w-[1920px] flex-wrap gap-x-400 gap-y-100 px-400 py-200 text-100 text-muted-foreground md:px-600">
              <span>Source: semantic model "caldova-cologne-finance" · derived from the twin, otherwise synthetic</span>
              {stand && <span data-testid="fin-stand">{stand}</span>}
              <span>Notation based on IBCS. IBCS® is a registered trademark of the IBCS Institute.</span>
              <span className="ml-auto">Visuals and apps: Michael Tenner, DatenWG · Fabric App</span>
            </div>
          </footer>
        </div>
      </WritebackProvider>
    </ShellContext.Provider>
  );
}
