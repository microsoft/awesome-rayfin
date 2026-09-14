import { cn } from "./cn";

/**
 * Design-system recipes. Centralizes the class strings that were previously
 * hand-written per component so buttons, fields, cards, chips and surfaces stay
 * visually identical across every org app. All token-driven — no bespoke hex or
 * ad-hoc spacing. Compose with `cn(...)` to add per-instance tweaks.
 */

/** The single, standard focus ring. Use everywhere a control can be focused. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export type Elevation = 0 | 1 | 2 | 3 | 4;

/** A card/panel surface at a given elevation (maps to the shadow-e* tokens). */
export function surface(elevation: Elevation = 1, className?: string): string {
  const shadow = elevation === 0 ? "" : `shadow-e${elevation}`;
  return cn("rounded-2xl border border-border bg-card", shadow, className);
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-border bg-secondary/60 text-secondary-foreground hover:bg-accent",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:opacity-90",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-l py-s text-200",
};

/** Standard button recipe. */
export function btn(
  opts: { variant?: ButtonVariant; size?: ButtonSize } = {},
  className?: string,
): string {
  const { variant = "secondary", size = "sm" } = opts;
  return cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], focusRing, className);
}

/** Standard text input / select trigger recipe. */
export function field(className?: string): string {
  return cn(
    "rounded-lg border border-border bg-background px-m py-s text-200 text-foreground placeholder:text-muted-foreground",
    focusRing,
    className,
  );
}

/** Filter/segment chip recipe (active vs. idle). */
export function chip(active = false, className?: string): string {
  return cn(
    "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
    active
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border bg-background text-muted-foreground hover:bg-accent",
    focusRing,
    className,
  );
}
