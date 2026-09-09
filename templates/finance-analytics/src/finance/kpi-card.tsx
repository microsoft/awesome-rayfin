import { memo, type ComponentType, type ReactNode } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "./lib/cn";
import { formatSignedPercent } from "./lib/format";
import { Sparkline } from "./features/sparkline";
import { Tooltip } from "./primitives";

export interface KpiCardProps {
  label: string;
  /** Compact headline value, e.g. "$45.2B". */
  value: string;
  /** Full-precision value surfaced on hover (title) for reconciliation. */
  fullValue?: string;
  /** Small period chip rendered next to the label, e.g. "FYTD". */
  periodTag?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Signed YoY ratio (0.062 → "+6.2%"); drives the delta pill + arrow + color.
   *  Preferred over the legacy `delta` string. */
  deltaRatio?: number | null;
  /** Comparison basis shown next to the delta pill. Defaults to "YoY"; pass e.g.
   *  "vs BU" or "vs PY" when the ratio isn't a year-over-year change, so the label
   *  never misdescribes the number. Set to "" to hide the suffix entirely. */
  deltaSuffix?: string;
  /** Legacy pre-formatted signed change, e.g. "+6.2%". Used only if `deltaRatio`
   *  is not provided. Direction is inferred from a leading "-". */
  delta?: string;
  /** Caption beneath/next to the delta, e.g. "vs PY $45.1B". */
  priorYearLabel?: string;
  /** Absolute YoY swing, e.g. "+$2.6B" — colored by direction. */
  absoluteDelta?: string;
  /** Marks the delta/comparison as an illustrative placeholder (e.g. a demo with
   *  no time dimension). Renders a subtle "*" on the caption with an explanatory
   *  tooltip, so a sample figure is never mistaken for a real prior-period number. */
  estimated?: boolean;
  /** Tooltip shown for the `estimated` marker. */
  estimatedNote?: string;
  /** Generic supporting caption (legacy). */
  hint?: string;
  /** Optional trend series feeding the inline sparkline. */
  spark?: number[];
  /** Hero treatment: larger value + accent hairline + glow. */
  emphasis?: boolean;
  /** Compact, single-line layout (value + delta on one row, no sparkline). */
  dense?: boolean;
  /** When provided, the value becomes a button (e.g. opens a breakdown). */
  onDrill?: () => void;
  /** Stagger entrance animations when rendering a row of cards. */
  delayMs?: number;
  /** Alternative stagger index (delayMs takes precedence). */
  index?: number;
  isLoading?: boolean;
}

/**
 * Shared KPI primitive so every app's headline metrics look identical — Fluent
 * numeric face, signed YoY pill, optional inline sparkline, hero emphasis and a
 * dense variant. Pure presentational, fully tree-shakeable.
 */
function KpiCardImpl({
  label, value, fullValue, periodTag, icon: Icon, deltaRatio, deltaSuffix = "YoY", delta, priorYearLabel,
  absoluteDelta, estimated = false, estimatedNote = "Illustrative — the bundled sample has no time dimension. Wire a live semantic model for real prior-period figures.", hint, spark, emphasis = false, dense = false, onDrill,
  delayMs, index = 0, isLoading = false,
}: KpiCardProps) {
  const hasRatio = deltaRatio != null;
  const legacyNegative = delta?.trim().startsWith("-");
  const up = hasRatio ? deltaRatio >= 0 : !legacyNegative;
  const hasDelta = hasRatio || Boolean(delta);
  const deltaText = hasRatio ? formatSignedPercent(deltaRatio) : delta;
  const caption = priorYearLabel ?? hint;
  const hasFooter = Boolean(caption || absoluteDelta || (spark && spark.length > 1));
  const delay = delayMs ?? index * 60;

  const valueClasses = cn(
    "block min-w-0 truncate font-numeric font-semibold tracking-tight tabular-nums",
    emphasis && !dense
      ? "text-hero-700 leading-hero-700"
      : dense
        ? "text-500 leading-500"
        : "text-600 leading-600",
  );

  const valueEl = isLoading ? (
    <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
  ) : onDrill ? (
    <Tooltip content={fullValue ? `${fullValue} — open breakdown` : "Open breakdown"}>
      <button
        type="button"
        onClick={onDrill}
        className={cn(valueClasses, "text-left underline-offset-4 outline-none hover:underline focus-visible:underline")}
      >
        {value}
      </button>
    </Tooltip>
  ) : fullValue ? (
    <Tooltip content={fullValue}>
      <span className={valueClasses}>{value}</span>
    </Tooltip>
  ) : (
    <span className={valueClasses}>{value}</span>
  );

  const deltaEl = hasDelta && !isLoading ? (
    <span className={cn("flex shrink-0 items-center gap-xxs text-200 font-semibold", up ? "text-success" : "text-destructive")}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
      {deltaText}
      {hasRatio && deltaSuffix ? <span className="font-medium text-muted-foreground">{deltaSuffix}</span> : null}
    </span>
  ) : null;

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "kpi-rise group relative flex flex-col overflow-hidden rounded-xl border bg-card px-m shadow-e1 transition-all duration-200 hover:shadow-e2",
        dense ? "gap-xxs py-xs" : "gap-xs py-s",
        emphasis ? "border-primary/30" : "border-border/80",
      )}
    >
      {emphasis ? (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-70" />
      ) : null}

      <div className="flex items-center gap-xs">
        <span className="min-w-0 flex-1 truncate text-100 font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {periodTag ? (
          <span className="shrink-0 rounded-sm bg-muted px-xs py-[1px] text-100 font-semibold uppercase tracking-wide text-muted-foreground">
            {periodTag}
          </span>
        ) : null}
        {Icon ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/15" aria-hidden="true">
            <Icon size={15} />
          </span>
        ) : null}
      </div>

      {dense ? (
        <div className="flex flex-col gap-xxs">
          <div className="flex items-baseline gap-s text-foreground">
            {valueEl}
            {deltaEl}
          </div>
          {!isLoading && (caption || absoluteDelta || (spark && spark.length > 1)) ? (
            <div className="flex items-center justify-between gap-m">
              <FooterMeta caption={caption} absoluteDelta={absoluteDelta} up={up} estimated={estimated} estimatedNote={estimatedNote} />
              {spark && spark.length > 1 ? (
                <Sparkline data={spark} className={cn("shrink-0", emphasis ? "text-primary" : "text-primary/60")} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-s text-foreground">
            {valueEl}
            {deltaEl}
          </div>
          {hasFooter && !isLoading ? (
            <div className="flex items-center justify-between gap-m border-t border-border/50 pt-xxs">
              <FooterMeta caption={caption} absoluteDelta={absoluteDelta} up={up} estimated={estimated} estimatedNote={estimatedNote} />
              {spark && spark.length > 1 ? (
                <Sparkline data={spark} className={emphasis ? "text-primary" : "text-primary/60"} />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function FooterMeta({ caption, absoluteDelta, up, estimated = false, estimatedNote }: { caption?: ReactNode; absoluteDelta?: string; up: boolean; estimated?: boolean; estimatedNote?: string }) {
  if (!caption && !absoluteDelta) return null;
  const marker = estimated ? (
    <Tooltip content={estimatedNote}>
      <sup tabIndex={0} className="ml-[1px] shrink-0 cursor-help font-semibold text-primary outline-none focus-visible:ring-1 focus-visible:ring-ring" aria-label={typeof estimatedNote === "string" ? estimatedNote : "Illustrative figure"}>
        *
      </sup>
    </Tooltip>
  ) : null;
  return (
    <span className="flex min-w-0 items-baseline gap-xs text-100 text-muted-foreground">
      {caption ? (
        <span className="flex min-w-0 items-baseline">
          <span className="truncate">{caption}</span>
          {marker}
        </span>
      ) : null}
      {absoluteDelta ? (
        <span className={cn("flex shrink-0 items-baseline font-numeric font-semibold tabular-nums", up ? "text-success" : "text-destructive")}>
          {absoluteDelta}
          {!caption ? marker : null}
        </span>
      ) : null}
    </span>
  );
}

export const KpiCard = memo(KpiCardImpl);
