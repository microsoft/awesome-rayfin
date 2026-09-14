import type { ComponentType, ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../lib/cn";

export interface VisualFrameProps {
  title: string;
  /** Sub-caption under the title (e.g. the measure or scope). */
  hint?: string;
  /** Small leading icon in the title bar. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Optional pill rendered on the right of the title bar (e.g. "Live"). */
  badge?: ReactNode;
  /** Hover-revealed action cluster (e.g. export icons). */
  actions?: ReactNode;
  /** Stagger entrance with the rest of the page grid. */
  delayMs?: number;
  className?: string;
  children: ReactNode;
}

/**
 * The standardized framed visual — every chart/table on a page sits in one so
 * the whole org gets identical headers, padding, borders and hover affordances.
 * A subtle top accent hairline + soft shadow give each card depth.
 */
export function VisualFrame({ title, hint, icon: Icon, badge, actions, delayMs = 0, className, children }: VisualFrameProps) {
  return (
    <section
      style={{ animationDelay: `${delayMs}ms`, contentVisibility: "auto", containIntrinsicSize: "auto 420px" }}
      className={cn(
        "page-enter group/frame relative flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-e2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-e3",
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-70" />
      <header className="flex items-center justify-between gap-m border-b border-border/70 px-l py-m">
        <div className="flex min-w-0 items-center gap-s">
          {Icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/15" aria-hidden="true">
              <Icon size={15} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="truncate text-300 font-semibold leading-tight text-foreground">{title}</h3>
            {hint ? <p className="truncate text-100 text-muted-foreground">{hint}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
          {badge}
          {actions ? (
            <div className="flex items-center gap-xxs opacity-0 transition-opacity focus-within:opacity-100 group-hover/frame:opacity-100">
              {actions}
            </div>
          ) : (
            <span className="text-muted-foreground/50 opacity-0 transition-opacity group-hover/frame:opacity-100" aria-hidden="true">
              <MoreHorizontal size={16} />
            </span>
          )}
        </div>
      </header>
      <div className="flex-1 px-l py-l">{children}</div>
    </section>
  );
}
