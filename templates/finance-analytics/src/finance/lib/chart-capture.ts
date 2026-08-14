/**
 * Chart image capture — the D1 seam that lets the Deck Builder / visual exports
 * embed a PIXEL-PERFECT snapshot of a Fabric (`engine="fabric"`) chart, rendered
 * by the official Vega `VegaVisual`, into a slide. The underlying Vega `View`
 * exposes `toImageURL()`; a mounted fabric chart publishes a getter for its live
 * view into a module-singleton registry, and the deck reaches it by id at
 * generate-time. Custom (SVG) charts don't register, so the deck falls back to a
 * native, editable PowerPoint chart — no behavior change for existing consumers.
 *
 * Zero runtime deps: the Vega `View` is referenced only through the minimal
 * structural `CaptureView` interface below, so this module never imports the SDK
 * and stays node-testable.
 */

/** The one Vega `View` capability the deck needs. Structurally satisfied by the
 *  real Vega view (`toImageURL(type, scale) => Promise<string>`). */
export interface CaptureView {
  toImageURL(type: "png" | "svg" | "canvas", scale?: number): Promise<string>;
}

export interface CaptureOptions {
  /** Image format. "png" (default) embeds cleanly in PowerPoint; "svg" stays vector. */
  type?: "png" | "svg";
  /** Device-pixel multiplier for crisp slides on hi-DPI. Default 2. */
  scale?: number;
}

/**
 * Render a live Vega view to a data-URL image. Fully guarded: a null view, a view
 * without `toImageURL`, or a rejected/throwing capture all resolve to `null` so
 * the caller degrades to the native chart instead of failing the export.
 */
export async function captureImage(
  view: CaptureView | null | undefined,
  opts: CaptureOptions = {},
): Promise<string | null> {
  if (!view || typeof view.toImageURL !== "function") return null;
  const type = opts.type ?? "png";
  const scale = opts.scale ?? 2;
  try {
    const url = await view.toImageURL(type, scale);
    return typeof url === "string" && url.length > 0 ? url : null;
  } catch {
    return null;
  }
}

/** Getter published by a mounted chart. Returns the live view, or null if the
 *  visual hasn't finished mounting yet. */
export type ViewGetter = () => CaptureView | null;

const getters = new Map<string, ViewGetter>();

/**
 * Module-singleton registry of live chart views, keyed by a stable capture id.
 * Shared by value across lazy chunks (charts live in an on-demand gallery chunk;
 * the deck builder in another) because both import this same module path — Vite
 * dedupes it to one instance, exactly like `visualSelectionStore`.
 */
export const chartCaptureRegistry = {
  /** Publish a chart's live-view getter under `id`. Returns an unregister fn that
   *  only removes the entry if it's still the one this call registered (so a fast
   *  remount that re-registers before the old cleanup runs isn't clobbered). */
  register(id: string, getView: ViewGetter): () => void {
    getters.set(id, getView);
    return () => {
      if (getters.get(id) === getView) getters.delete(id);
    };
  },
  /** Capture the current image for the chart registered under `id`, or null if no
   *  chart is registered / its view isn't ready / capture fails. */
  async capture(id: string, opts?: CaptureOptions): Promise<string | null> {
    const getView = getters.get(id);
    if (!getView) return null;
    return captureImage(getView(), opts);
  },
  /** Whether a chart is currently registered under `id` (used to decide up-front
   *  whether an image path is even possible). */
  has(id: string): boolean {
    return getters.has(id);
  },
};
