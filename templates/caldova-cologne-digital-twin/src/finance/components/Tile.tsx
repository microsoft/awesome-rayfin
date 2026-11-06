// MockupKitchen tile: title (600) and subtitle (unit · scenarios · period,
// 70 % opacity) on one header band, optional key message and a toolbar slot.

import type { ReactNode } from 'react';

import { cn } from '@finance/lib/utils';

export function Tile({
  title,
  sub,
  message,
  tools,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  sub?: ReactNode;
  message?: ReactNode;
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('tile', className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-300 gap-y-200 px-400 pt-300">
        <div className="min-w-0">
          <h2 className="font-heading text-400 font-semibold leading-400">{title}</h2>
          {sub && <p className="truncate text-200 text-foreground/70">{sub}</p>}
        </div>
        {tools && <div className="flex flex-wrap items-center gap-200">{tools}</div>}
      </header>
      {message && <p className="px-400 pt-100 text-300 font-medium">{message}</p>}
      <div className={cn('min-h-0 flex-1 px-400 pt-200 pb-400', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Small segmented switch for chart variants inside a tile header. */
export function Switch<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-muted p-100">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-sm px-200 py-100-nudge text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            value === o.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
