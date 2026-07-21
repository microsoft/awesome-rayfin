import { lazy, Suspense, type ReactNode } from "react";
import { X, MousePointerClick, ChevronLeft, ChevronRight } from "lucide-react";
import { IntelligenceRail, type Insight, type InsightAction } from "./intelligence-rail";
import { useVisualSelection } from "../lib/visual-selection";

const ExplainPanel = lazy(() => import("./explain-panel"));

export interface VisualDrillRailProps {
  /** The app's standing insights, shown when nothing on a visual is selected. */
  baseInsights: Insight[];
  loading?: boolean;
  heading?: string;
  /** Shown at rest when there are no standing insights — e.g. local pages that drive
   *  the rail purely by click-drill. Keeps the rail inviting rather than "No insights". */
  restingPrompt?: ReactNode;
  onAction?: (action: InsightAction, insight: Insight) => void;
  onFeedback?: (insight: Insight, value: "up" | "down") => void;
}

/**
 * Intelligence rail with a click-to-drill overlay. Selecting a datum swaps the
 * rail to that datum's deterministic deep-dive under a pinned "Inspecting" header
 * (with a "‹ i of N ›" stepper to walk siblings without leaving the drawer). The
 * numbers-first ExplainPanel renders FIRST — the honest read-out, figures and
 * inline visuals — rather than beneath a generic insight list. Selections without
 * an `explain` payload (bridge steps, movers, forecast points) fall back to their
 * derived insight rows. Clearing returns to the app's standing insights.
 */
export function VisualDrillRail({ baseInsights, loading, heading = "Intelligence", restingPrompt, onAction, onFeedback }: VisualDrillRailProps) {
  const { selection, navigation, step, clear } = useVisualSelection();

  if (selection) {
    const atStart = navigation ? navigation.index <= 0 : true;
    const atEnd = navigation ? navigation.index >= navigation.items.length - 1 : true;
    return (
      <div className="flex flex-col gap-3">
        {/* Pinned context header — stays put while the deep-dive scrolls beneath it. */}
        <div className="panel-slide-in sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 border-b border-border/60 bg-card/95 px-1 pb-2 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
              <MousePointerClick size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Inspecting · {selection.visual}</div>
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[13px] font-semibold">{selection.label}</span>
                {selection.value ? <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{selection.value}</span> : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {navigation ? (
              <div className="mr-0.5 flex items-center gap-0.5" role="group" aria-label="Step through rows">
                <button
                  onClick={() => step(-1)}
                  disabled={atStart}
                  aria-label="Previous row"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-[3.25rem] text-center text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
                  {navigation.index + 1} of {navigation.items.length}
                </span>
                <button
                  onClick={() => step(1)}
                  disabled={atEnd}
                  aria-label="Next row"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            ) : null}
            <button
              onClick={clear}
              aria-label="Clear selection"
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {selection.explain ? (
          <Suspense fallback={<div className="h-40 animate-pulse rounded-lg border border-border bg-card" aria-hidden="true" />}>
            <ExplainPanel key={selection.visual + selection.label} input={selection.explain} />
          </Suspense>
        ) : (
          <IntelligenceRail
            key={selection.visual + selection.label}
            insights={selection.insights}
            heading="Drill-down"
            showHeading={false}
            onAction={onAction}
            onFeedback={onFeedback}
          />
        )}
      </div>
    );
  }

  return (
    !loading && baseInsights.length === 0 && restingPrompt ? (
      <>{restingPrompt}</>
    ) : (
      <IntelligenceRail insights={baseInsights} loading={loading} heading={heading} showHeading={false} onAction={onAction} onFeedback={onFeedback} />
    )
  );
}
