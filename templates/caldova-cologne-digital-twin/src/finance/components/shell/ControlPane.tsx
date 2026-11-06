// One collapsible control pane on the right for all slicers and settings of a
// page: no separate slicer and filter pane competing for space. Wide screens
// dock it next to the content (collapsed to a slim rail), small screens show it
// as a drawer over the content. The pane content is rendered once.

import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { useShell } from '@finance/hooks/shell.context';
import { cn } from '@finance/lib/utils';

const SMALL = '(max-width: 1279px)';

export function PageLayout({ pane, children, paneWidth = 300 }: { pane?: ReactNode; children: ReactNode; paneWidth?: number }) {
  const { paneOpen, setPaneOpen } = useShell();

  useEffect(() => {
    if (!paneOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && window.matchMedia(SMALL).matches) setPaneOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paneOpen, setPaneOpen]);

  if (!pane) return <div className="flex min-w-0 flex-col gap-[18px]">{children}</div>;

  return (
    <div
      className="grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_var(--pane-w)]"
      style={{ ['--pane-w' as string]: paneOpen ? `${paneWidth}px` : '44px' }}
    >
      <div className="flex min-w-0 flex-col gap-[18px]">{children}</div>

      {paneOpen && (
        <button type="button" aria-label="Close controls" className="fixed inset-0 z-40 bg-black/30 xl:hidden" onClick={() => setPaneOpen(false)} />
      )}
      <aside
        aria-label="Controls"
        className={cn(
          'fixed inset-y-0 right-0 z-50 w-[min(92vw,360px)] overflow-y-auto bg-background p-300 shadow-xl',
          'xl:sticky xl:top-[calc(var(--header-h,64px)+52px)] xl:z-auto xl:max-h-[calc(100vh-var(--header-h,64px)-64px)] xl:w-auto xl:self-start xl:bg-transparent xl:p-0 xl:shadow-none',
          paneOpen ? 'flex flex-col gap-200' : 'hidden xl:flex'
        )}
      >
        {paneOpen ? (
          <>
            <button
              type="button"
              onClick={() => setPaneOpen(false)}
              className="flex items-center gap-200 self-end rounded-md px-200 py-100 text-100 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title="Collapse controls (F)"
            >
              <PanelRightClose className="hidden icon-size-200 xl:block" aria-hidden="true" />
              <X className="icon-size-200 xl:hidden" aria-hidden="true" />
              <span className="xl:hidden">close</span>
              <span className="hidden xl:inline">collapse</span>
            </button>
            {pane}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setPaneOpen(true)}
            aria-label="Open controls (F)"
            title="Open controls (F)"
            className="flex h-[200px] w-[44px] flex-col items-center gap-300 rounded-xl bg-secondary pt-300 text-muted-foreground hover:text-foreground"
          >
            <PanelRightOpen className="icon-size-200" aria-hidden="true" />
            <span className="text-100 font-semibold tracking-wide [writing-mode:vertical-rl]">Controls</span>
          </button>
        )}
      </aside>
    </div>
  );
}
