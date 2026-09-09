import { useMemo, useState, type ReactNode } from "react";
import { Sparkles, TrendingUp, AlertTriangle, Lightbulb, ChevronRight } from "lucide-react";
import { InsightVisualView, type InsightVisual } from "./insight-visuals";

export type InsightTone = "positive" | "watch" | "neutral";

export interface InsightAction {
  label: string;
  /** Nav id to jump to, resolved by the host via `onAction`. */
  targetView?: string;
  onRun?: () => void;
}

export interface Insight {
  title: string;
  body: string;
  tone?: InsightTone;
  /** Short provenance line, e.g. "Revenue by Region" — shown as an evidence chip. */
  source?: string;
  /** 0..1 confidence for the insight; rendered as a subtle meter. @deprecated prefer `evidence`. */
  confidence?: number;
  /** Honest evidence string, e.g. "Top 3 of 5 · HHI 0.31" or "n=45 rows". Shown as a
   *  chip in place of an opaque confidence %. Preferred over `confidence`. */
  evidence?: string;
  /** Optional headline metric emphasised at the top of the card. */
  metric?: string;
  /** Optional inline micro-visual that makes the insight legible at a glance. */
  visual?: InsightVisual;
  /** Optional related action (e.g. drill into the number, jump to a view). When set,
   *  the whole row becomes a single button that runs it — "orient around this number". */
  action?: InsightAction;
}

export interface IntelligenceRailProps {
  insights: Insight[];
  heading?: string;
  footer?: ReactNode;
  /** Show streaming skeletons instead of content. */
  loading?: boolean;
  /** Hide the internal heading row (e.g. when the shell already labels the rail). */
  showHeading?: boolean;
  /** Invoked when an insight's action is triggered. */
  onAction?: (action: InsightAction, insight: Insight) => void;
  /** Invoked with thumbs feedback for telemetry. */
  onFeedback?: (insight: Insight, value: "up" | "down") => void;
}

const TONE: Record<InsightTone, { icon: typeof TrendingUp; cls: string; label: string }> = {
  positive: { icon: TrendingUp, cls: "text-success", label: "Positive" },
  watch: { icon: AlertTriangle, cls: "text-destructive", label: "Watch" },
  neutral: { icon: Lightbulb, cls: "text-primary", label: "Neutral" },
};
const TONE_METRIC: Record<InsightTone, string> = {
  positive: "text-success",
  watch: "text-destructive",
  neutral: "text-foreground",
};

type Filter = "all" | InsightTone;

/** A single insight rendered as a flat, dense row — no floating-card chrome. Title +
 *  metric share one line, an inline micro-visual makes it legible at a glance, and an
 *  evidence + source meta row cites where it came from. When the insight carries an
 *  `action`, the ENTIRE row is one button ("click any number to orient"), so there are
 *  never nested interactive elements. */
function InsightRow({ ins, onAction }: { ins: Insight; onAction?: IntelligenceRailProps["onAction"] }) {
  const tone = TONE[ins.tone ?? "neutral"];
  const interactive = Boolean(ins.action);

  const inner = (
    <>
      <div className="flex items-start gap-2">
        <tone.icon size={14} className={tone.cls + " mt-0.5 shrink-0"} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{ins.title}</h4>
            {ins.metric ? <span className={"shrink-0 text-[13px] font-bold tabular-nums " + TONE_METRIC[ins.tone ?? "neutral"]}>{ins.metric}</span> : null}
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{ins.body}</p>
          {ins.visual ? <div className="mt-2"><InsightVisualView visual={ins.visual} /></div> : null}
          {(ins.source || ins.evidence || interactive) ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {ins.evidence ? (
                <span className="inline-flex items-center gap-1 rounded bg-secondary/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {ins.evidence}
                </span>
              ) : null}
              {ins.source ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className={"h-1.5 w-1.5 rounded-full " + tone.cls.replace("text-", "bg-")} aria-hidden="true" />
                  {ins.source}
                </span>
              ) : null}
              {interactive ? (
                <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
                  {ins.action?.label ?? "Explore"}
                  <ChevronRight size={12} className="transition-transform group-hover/insight:translate-x-0.5" />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => {
          ins.action?.onRun?.();
          if (ins.action) onAction?.(ins.action, ins);
        }}
        className="group/insight w-full border-t border-border/50 py-2.5 text-left transition-colors first:border-0 first:pt-0.5 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inner}
      </button>
    );
  }

  return <article className="border-t border-border/50 py-2.5 first:border-0 first:pt-0.5">{inner}</article>;
}

function RailSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-t border-border/50 py-2.5 first:border-0">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-1.5 h-3 w-full animate-pulse rounded bg-muted" />
          <div className="mt-1 h-3 w-4/5 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/** Generic right-pane intelligence rail. Apps feed model-derived insights; the
 *  rail standardizes a flat, dense presentation with a tone filter, provenance,
 *  honest evidence and related actions. */
export function IntelligenceRail({ insights, heading = "Intelligence", footer, loading, showHeading = true, onAction }: IntelligenceRailProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: insights.length, positive: 0, watch: 0, neutral: 0 };
    for (const i of insights) c[i.tone ?? "neutral"]++;
    return c;
  }, [insights]);

  const shown = filter === "all" ? insights : insights.filter((i) => (i.tone ?? "neutral") === filter);
  const filters: Filter[] = ["all", "positive", "watch", "neutral"];

  return (
    <div className="panel-slide-in flex flex-col gap-2.5">
      {showHeading ? (
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Sparkles size={15} className="text-primary" />
          {heading}
          {!loading ? <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{insights.length}</span> : null}
        </div>
      ) : null}

      {loading ? (
        <RailSkeleton />
      ) : (
        <>
          {insights.length > 1 ? (
            <div role="group" aria-label="Filter insights" className="flex flex-wrap gap-1">
              {filters.map((f) => {
                const active = filter === f;
                const label = f === "all" ? "All" : TONE[f].label;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    aria-pressed={active}
                    disabled={f !== "all" && counts[f] === 0}
                    className={
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 " +
                      (active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")
                    }
                  >
                    {label} <span className="tabular-nums opacity-70">{counts[f]}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No {filter === "all" ? "" : TONE[filter as InsightTone].label.toLowerCase() + " "}insights.
            </p>
          ) : (
            <div className="flex flex-col">
              {shown.map((ins, i) => (
                <InsightRow key={i} ins={ins} onAction={onAction} />
              ))}
            </div>
          )}
        </>
      )}
      {footer}
    </div>
  );
}
