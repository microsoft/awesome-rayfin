import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={"animate-pulse rounded-md bg-muted " + className} />;
}

/** Standardized loading shimmer for data views (KPI row + rows). */
export function LoadingState({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9" />)}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center">
      <AlertTriangle className="text-destructive" />
      <p className="text-sm font-medium">Couldn’t load data</p>
      <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-sm transition-colors hover:bg-accent"
        >
          <RefreshCw size={14} /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title = "No data", hint }: { title?: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <Inbox className="text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-md text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Chart-shaped loading placeholder for bar visuals — staggered pulsing columns. */
export function BarChartSkeleton({ height = 240 }: { height?: number }) {
  const bars = [55, 80, 42, 95, 65, 50, 74];
  return (
    <div className="flex items-end gap-3" style={{ height }} aria-hidden="true">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t-md bg-muted"
          style={{ height: `${h}%`, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

/** Chart-shaped loading placeholder for line/area visuals. */
export function LineChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="relative w-full overflow-hidden rounded-md" style={{ height }} aria-hidden="true">
      <div className="absolute inset-0 flex flex-col justify-between">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-px w-full bg-muted/60" />)}
      </div>
      <svg viewBox="0 0 600 220" width="100%" height="100%" preserveAspectRatio="none" className="relative">
        <polyline
          points="8,170 108,120 208,145 308,80 408,115 508,60 592,95"
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="3"
          className="animate-pulse"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** Chart-shaped loading placeholder for donut/share visuals — pulse ring + legend. */
export function DonutChartSkeleton({ size = 220 }: { size?: number }) {
  const stroke = size * 0.16;
  const rr = size / 2 - stroke / 2;
  return (
    <div className="flex flex-wrap items-center gap-8" aria-hidden="true">
      <svg width={size} height={size} className="shrink-0 animate-pulse">
        <circle cx={size / 2} cy={size / 2} r={rr} fill="none" stroke="var(--color-muted)" strokeWidth={stroke} />
      </svg>
      <ul className="flex min-w-44 flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-3 animate-pulse rounded-sm bg-muted" />
            <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface QueryBoundaryProps {
  query: { loading: boolean; error: Error | null; refetch: () => void };
  /** Treat the result as empty (e.g. zero rows) and show the empty state. */
  empty?: boolean;
  skeleton?: ReactNode;
  children: ReactNode;
}

/** One standardized switch for loading → error → empty → content, so every app
 *  handles data states identically. */
export function QueryBoundary({ query, empty, skeleton, children }: QueryBoundaryProps) {
  if (query.loading) return <>{skeleton ?? <LoadingState />}</>;
  if (query.error) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (empty) return <EmptyState />;
  return <>{children}</>;
}
