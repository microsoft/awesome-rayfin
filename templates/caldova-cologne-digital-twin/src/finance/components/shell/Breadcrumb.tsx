// Filter breadcrumb: the whole view state in one line (page, period, comparison,
// versions, selection, filters). Every part with a filter can be removed with
// one click; undo/redo walks the view history; the link copies this exact view.

import { Check, ChevronRight, Link2, Redo2, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useShell } from '@finance/hooks/shell.context';
import { pageLabel } from '@finance/lib/route';
import { cn } from '@finance/lib/utils';

export interface Crumb {
  key: string;
  label: string;
  value: string;
  /** Set for removable filters: removes just this part. */
  onRemove?: () => void;
  title?: string;
}

export function Breadcrumb({ crumbs, onClearAll, extra }: { crumbs: Crumb[]; onClearAll?: () => void; extra?: ReactNode }) {
  const { page, undo, redo, canUndo, canRedo, copyLink, paneOpen, setPaneOpen } = useShell();
  const [copied, setCopied] = useState(false);
  const removable = crumbs.filter((c) => c.onRemove).length;

  return (
    <nav
      aria-label="Current view"
      className="sticky top-[var(--header-h,64px)] z-20 border-b border-border bg-background/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-200 gap-y-100 px-400 py-200 text-200 md:px-600">
        <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-100 gap-y-100">
          <li className="font-semibold">{pageLabel(page)}</li>
          {crumbs.map((c) => (
            <li key={c.key} className="flex items-center gap-100">
              <ChevronRight className="icon-size-100 text-muted-foreground" aria-hidden="true" />
              {c.onRemove ? (
                <button
                  type="button"
                  onClick={c.onRemove}
                  title={c.title ?? `Remove ${c.label}`}
                  className="flex items-center gap-100 rounded-full bg-accent px-300 py-100-nudge text-100 font-medium text-accent-foreground hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-accent-foreground/70">{c.label}:</span> {c.value}
                  <X className="icon-size-100" aria-hidden="true" />
                  <span className="sr-only">remove</span>
                </button>
              ) : (
                <span title={c.title} className="text-muted-foreground">
                  <span className="sr-only">{c.label}: </span>
                  {c.value}
                </span>
              )}
            </li>
          ))}
          {removable > 1 && onClearAll && (
            <li>
              <button type="button" onClick={onClearAll} className="ml-200 text-100 text-muted-foreground underline-offset-2 hover:underline">
                clear all filters
              </button>
            </li>
          )}
        </ol>
        <div className="flex items-center gap-100">
          {extra}
          <ToolBtn label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 className="icon-size-200" />
          </ToolBtn>
          <ToolBtn label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
            <Redo2 className="icon-size-200" />
          </ToolBtn>
          <ToolBtn
            label={copied ? 'Link copied' : 'Copy a link to this view'}
            onClick={() =>
              void copyLink().then((ok) => {
                setCopied(ok);
                window.setTimeout(() => setCopied(false), 1600);
              })
            }
          >
            {copied ? <Check className="icon-size-200" /> : <Link2 className="icon-size-200" />}
          </ToolBtn>
          <ToolBtn label={paneOpen ? 'Collapse controls (F)' : 'Open controls (F)'} pressed={paneOpen} onClick={() => setPaneOpen(!paneOpen)}>
            <SlidersHorizontal className="icon-size-200" />
          </ToolBtn>
        </div>
      </div>
    </nav>
  );
}

function ToolBtn({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md p-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35',
        pressed && 'bg-accent text-accent-foreground'
      )}
    >
      {children}
    </button>
  );
}
