/**
 * IBCS-INSPIRED scenario notation (not a full IBCS-compliance claim).
 *
 * Encodes the widely-used SUCCESS-rule scenario fills so scenarios are legible in
 * grayscale and colour is reserved for VARIANCE only:
 *   AC (actual)   → solid, dark fill
 *   PY (prior yr) → solid, light grey fill
 *   BU (budget)   → outline only (white fill, dark stroke)
 *   FC (forecast) → hatched fill
 * Variance bars use semantic good/bad colour exclusively.
 *
 * Fills reference CSS theme tokens so they adapt to light/dark automatically.
 * `hatchPatternId(prefix)` derives a collision-free id per chart instance.
 */

export type ScenarioKey = "AC" | "BU" | "FC" | "PY";

export interface ScenarioStyle {
  key: ScenarioKey;
  label: string;
  /** SVG fill: a colour token or `url(#pattern)` (resolved by the chart). */
  fillKind: "solid-dark" | "solid-grey" | "outline" | "hatch";
  stroke: string;
}

export const SCENARIO_STYLES: Record<ScenarioKey, ScenarioStyle> = {
  AC: { key: "AC", label: "Actual", fillKind: "solid-dark", stroke: "var(--color-foreground, #1f2937)" },
  PY: { key: "PY", label: "Prior year", fillKind: "solid-grey", stroke: "var(--color-muted-foreground, #9ca3af)" },
  BU: { key: "BU", label: "Budget", fillKind: "outline", stroke: "var(--color-foreground, #1f2937)" },
  FC: { key: "FC", label: "Forecast", fillKind: "hatch", stroke: "var(--color-foreground, #1f2937)" },
};

export const SCENARIO_ORDER: ScenarioKey[] = ["PY", "BU", "AC", "FC"];

/** Solid fill colours for the non-patterned scenarios (theme tokens). */
export const SCENARIO_FILL: Record<ScenarioStyle["fillKind"], string> = {
  "solid-dark": "var(--color-foreground, #1f2937)",
  "solid-grey": "var(--color-muted-foreground, #9ca3af)",
  outline: "var(--color-card, #ffffff)",
  hatch: "", // resolved to url(#hatch) by the chart
};

/** Semantic variance colours (the ONLY place colour carries meaning). */
export const VARIANCE_COLOR = {
  favorable: "var(--color-positive, #16a34a)",
  unfavorable: "var(--color-negative, #dc2626)",
  neutral: "var(--color-muted-foreground, #9ca3af)",
} as const;

/** Deterministic, collision-free hatch pattern id for a chart instance. */
export function hatchPatternId(prefix: string): string {
  return `ibcs-hatch-${prefix}`;
}
