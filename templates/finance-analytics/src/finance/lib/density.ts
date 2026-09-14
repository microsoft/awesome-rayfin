/**
 * Global density mode. Toggling to "compact" tightens the spacing scale app-wide
 * by overriding the `--spacing-*` tokens (see theme.css), so every component that
 * uses standard spacing utilities compacts together — no per-component props.
 */

export type Density = "comfortable" | "compact";

export const DENSITY_STORAGE_KEY = "fabric-standard-density";

export function readDensity(): Density {
  if (typeof localStorage === "undefined") return "compact";
  try {
    // Compact is the default; only an explicit "comfortable" opts out.
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "comfortable" ? "comfortable" : "compact";
  } catch {
    return "compact";
  }
}

/** Apply a density to the document root and persist it. */
export function applyDensity(density: Density): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.density = density;
  }
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    /* ignore */
  }
}

/** No-flash init: inline in <head> before the bundle to set density on first paint. */
export const DENSITY_INIT_SNIPPET = `(function(){try{var d=localStorage.getItem("${DENSITY_STORAGE_KEY}");document.documentElement.dataset.density=d==="comfortable"?"comfortable":"compact";}catch(e){}})();`;
