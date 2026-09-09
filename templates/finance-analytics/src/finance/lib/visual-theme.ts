/**
 * Visual theme bridge — turns this template's CSS design tokens into the
 * `VisualTheme` object the official Fabric components (`@microsoft/fabric-datagrid`,
 * `VegaVisual`) accept as their `theme` prop, so they render in the app's — and
 * ultimately the Fabric host's — light/dark/high-contrast palette instead of the
 * SDK's built-in default.
 *
 * This template's `theme.css` already declares the exact CSS custom properties the
 * official `readCssTheme` bridge reads (`--color-foreground`, `--color-card`,
 * `--color-border`, …). We re-implement the tiny read/compare here — matching the
 * official `CSS_VAR_BY_THEME_KEY` mapping exactly — rather than importing the SDK's
 * runtime helpers, so this module adds ZERO runtime dependency on the SDK (the same
 * convention `fabric-interop.ts` follows). `VisualTheme` is pulled in with
 * `import type` only, so it is erased at build time.
 */
import { useEffect, useState } from "react";
import type { VisualTheme } from "@microsoft/fabric-visuals-core";

/** Mirror of the official `CSS_VAR_BY_THEME_KEY` (fabric-visuals-core). */
export const CSS_VAR_BY_THEME_KEY = {
  foreground: "--color-foreground",
  background: "--color-card",
  stroke: "--color-border",
  foregroundSecondary: "--color-muted-foreground",
  backgroundSecondary: "--color-muted",
  backgroundHover: "--color-hover",
  brandBackground: "--color-brand",
  brandForeground: "--color-brand-foreground",
} as const;

/** Complete light-theme color set (mirrors `theme.css` light values) so the bridge
 *  always yields a full palette — before styles resolve, and under SSR. */
const LIGHT_FALLBACK: Required<Pick<
  VisualTheme,
  | "foreground"
  | "foregroundSecondary"
  | "brandForeground"
  | "brandBackground"
  | "background"
  | "backgroundSecondary"
  | "backgroundHover"
  | "stroke"
>> = {
  foreground: "#242424",
  foregroundSecondary: "#595959",
  brandForeground: "#0f6cbd",
  brandBackground: "#0f6cbd",
  background: "#ffffff",
  backgroundSecondary: "#f0f0f0",
  backgroundHover: "#f5f5f5",
  stroke: "#e0e0e0",
};

/**
 * Read the bridged CSS custom properties from a computed style and return a
 * complete `VisualTheme`. Defaults to `document.documentElement`; each field falls
 * back to the light palette when its CSS var is unset. SSR-safe.
 */
export function readVisualTheme(element?: Element): VisualTheme {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { ...LIGHT_FALLBACK, isDark: false };
  }
  const el = element ?? document.documentElement;
  const cs = getComputedStyle(el);
  const read = (cssVar: string, fallback: string) => cs.getPropertyValue(cssVar).trim() || fallback;
  return {
    foreground: read(CSS_VAR_BY_THEME_KEY.foreground, LIGHT_FALLBACK.foreground),
    foregroundSecondary: read(CSS_VAR_BY_THEME_KEY.foregroundSecondary, LIGHT_FALLBACK.foregroundSecondary),
    brandForeground: read(CSS_VAR_BY_THEME_KEY.brandForeground, LIGHT_FALLBACK.brandForeground),
    brandBackground: read(CSS_VAR_BY_THEME_KEY.brandBackground, LIGHT_FALLBACK.brandBackground),
    background: read(CSS_VAR_BY_THEME_KEY.background, LIGHT_FALLBACK.background),
    backgroundSecondary: read(CSS_VAR_BY_THEME_KEY.backgroundSecondary, LIGHT_FALLBACK.backgroundSecondary),
    backgroundHover: read(CSS_VAR_BY_THEME_KEY.backgroundHover, LIGHT_FALLBACK.backgroundHover),
    stroke: read(CSS_VAR_BY_THEME_KEY.stroke, LIGHT_FALLBACK.stroke),
    isDark: el.classList.contains("dark") || document.documentElement.classList.contains("dark"),
  };
}

/** True when any bridged field (colors + `isDark`) differs between two themes. */
export function visualThemeChanged(a: VisualTheme, b: VisualTheme): boolean {
  return (
    a.foreground !== b.foreground ||
    a.foregroundSecondary !== b.foregroundSecondary ||
    a.brandForeground !== b.brandForeground ||
    a.brandBackground !== b.brandBackground ||
    a.background !== b.background ||
    a.backgroundSecondary !== b.backgroundSecondary ||
    a.backgroundHover !== b.backgroundHover ||
    a.stroke !== b.stroke ||
    a.isDark !== b.isDark
  );
}

/**
 * Track the current `VisualTheme`, re-reading when the app toggles dark mode (the
 * `.dark` class on `<html>`), or when the OS color-scheme / forced-colors (Windows
 * high-contrast) preference changes. Returns a stable object reference until a
 * bridged field actually changes, so official visuals don't re-render needlessly.
 */
export function useVisualTheme(): VisualTheme {
  const [theme, setTheme] = useState<VisualTheme>(() => readVisualTheme());
  useEffect(() => {
    if (typeof document === "undefined") return;
    const refresh = () => {
      const next = readVisualTheme();
      setTheme((prev) => (visualThemeChanged(prev, next) ? next : prev));
    };
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mqs = [
      window.matchMedia?.("(prefers-color-scheme: dark)"),
      window.matchMedia?.("(forced-colors: active)"),
    ].filter(Boolean) as MediaQueryList[];
    mqs.forEach((mq) => mq.addEventListener("change", refresh));
    // Re-read once post-mount in case the stylesheet resolved after first paint.
    refresh();
    return () => {
      mo.disconnect();
      mqs.forEach((mq) => mq.removeEventListener("change", refresh));
    };
  }, []);
  return theme;
}
