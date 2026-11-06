import type { ReactNode } from 'react';

import { useFinance } from '@/hooks/FinanceContext';

/** IBCS message title: who, what, when, unit on one line, the message below in bold. */
export function PageTitle({ statement, span, message }: { statement: string; span: string; message: string }) {
  const { snapshot } = useFinance();
  return (
    <div className="min-h-0">
      <div className="text-[12px] text-muted">
        {snapshot.meta.company} · {statement} · {span} · kEUR
      </div>
      <div className="truncate text-[17px] font-semibold leading-6">{message || ' '}</div>
    </div>
  );
}

/** A panel with an optional small title; it never scrolls. */
export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`grid min-h-0 min-w-0 ${title ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} ${className}`}>
      {title && <h2 className="truncate pb-1 text-[12px] font-semibold text-ink">{title}</h2>}
      <div className="panel">{children}</div>
    </section>
  );
}
