import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "../primitives/tooltip";
import { cn } from "../lib/cn";

export interface InfoHintProps {
  /** The explanatory content — "what this means", methodology, freshness, etc. */
  children: ReactNode;
  /** Accessible label for the trigger (defaults to "More information"). */
  label?: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Standardized micro-copy affordance: a small, unobtrusive info icon that reveals
 * an accessible tooltip. Use it to explain a metric, cite methodology, note data
 * freshness, or explain truncation — consistently across every org app.
 */
export function InfoHint({ children, label = "More information", side = "top", className }: InfoHintProps) {
  return (
    <Tooltip content={children} side={side} className="max-w-xs text-left">
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
