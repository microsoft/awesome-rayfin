// Honest loading and error states shared by all pages.

import { cn } from '@finance/lib/utils';

export function LoadingTiles({ text }: { text: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto flex w-full max-w-[1920px] flex-col gap-[18px] px-400 py-600 md:px-600">
      <p className="text-300 text-muted-foreground">{text}</p>
      <div className="grid grid-cols-2 gap-[18px] md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[170px] animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-[18px] 2xl:grid-cols-[2fr_1fr]">
        <div className="h-[460px] animate-pulse rounded-xl bg-muted" />
        <div className="h-[460px] animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export function ErrorBox({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={cn('mx-auto mt-800 max-w-[560px] rounded-xl border border-destructive/40 bg-card p-600')}>
      <h2 className="font-heading text-400 font-semibold">{title}</h2>
      <p className="mt-200 text-300 text-muted-foreground">{message}</p>
      <button type="button" onClick={onRetry} className="mt-400 rounded-md bg-primary px-400 py-200 text-300 font-semibold text-primary-foreground hover:opacity-90">
        Try again
      </button>
    </div>
  );
}
