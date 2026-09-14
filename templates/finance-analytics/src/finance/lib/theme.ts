/**
 * Theme mode management. Supports an explicit "light"/"dark" choice or "system"
 * (follows the OS `prefers-color-scheme` and updates live). Kept dependency-free
 * and SSR-safe so every org app themes identically.
 */

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "fabric-standard-theme";

/** Resolve the effective dark/light given a mode + the current OS preference. */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Read the stored mode, defaulting to "system" when nothing is persisted. */
export function readThemeMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* private mode / unavailable */
  }
  return "system";
}

/** Apply a mode to the document root and persist it. Returns the effective dark. */
export function applyThemeMode(mode: ThemeMode): boolean {
  const dark = resolveDark(mode);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  return dark;
}

/** Subscribe to OS theme changes; only re-applies while in "system" mode.
 *  Returns an unsubscribe function. */
export function watchSystemTheme(getMode: () => ThemeMode, onChange: (dark: boolean) => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getMode() === "system") onChange(mq.matches);
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/**
 * Inline this in the app's <head> BEFORE the bundle to prevent a light→dark
 * flash on first paint. Reads the stored mode (or the OS preference) and sets
 * the `dark` class synchronously.
 */
export const THEME_INIT_SNIPPET = `(function(){try{var k="${THEME_STORAGE_KEY}";var m=localStorage.getItem(k);var d=m==="dark"||((m===null||m==="system")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
