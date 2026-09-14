/**
 * The sites this app ships, and the rule for choosing between them.
 *
 * PLAN §4 said no location belongs in code — the geodata pipeline honours that through
 * `config/aoi/<id>.json`, and this is the browser's half of the same promise. It carries only what
 * the UI needs to name and order the sites; every coordinate, bound and attribution still comes
 * from the built assets under `public/terrain/<id>/`, so the two halves cannot drift.
 *
 * 🔴 **The second site exists because the first one's water is too open.** On the Kieler Förde a
 * 25 m mast's geometric horizon is about 21 km and the fjord runs out well before that, so the
 * coverage disc swallows the map and the shadows that make the argument are hard to see. Measured
 * on Copernicus DEM GLO-30, the longest unobstructed straight line from a sea cell is:
 *
 *     Kieler Förde   median 5.6 km, p90 7.6 km
 *     Schlei         median 2.8 km, p90 4.8 km
 *
 * so the water itself stops a sight line about twice as soon. That is the whole reason for the
 * switcher, and it is a measurement rather than an impression of the map.
 */
export interface AoiEntry {
  id: string;
  /** Shown in the switcher and the window title. */
  name: string;
  /** Sub-label, so the switcher says where in the world these are. */
  region: string;
  /** Used to name the exported annex. ASCII, because it becomes a filename. */
  slug: string;
}

export const AOIS: Record<string, AoiEntry> = {
  "kieler-foerde": {
    id: "kieler-foerde",
    name: "Kieler Förde",
    region: "Kieler Bucht, Schleswig-Holstein",
    slug: "Kieler-Foerde",
  },
  schlei: {
    id: "schlei",
    name: "Schlei",
    region: "Angeln / Schwansen, Schleswig-Holstein",
    slug: "Schlei",
  },
};

/**
 * The order the switcher lists them in, and the first entry is the default.
 *
 * Explicit rather than `Object.keys`, because "which site loads when nobody chose one" is a
 * decision and not something to inherit from object property order.
 */
export const AOI_ORDER = ["kieler-foerde", "schlei"] as const;

export const DEFAULT_AOI = AOI_ORDER[0];

/**
 * The two cores sit inside **one shared coarse shell** (8.9–11.7 E, 53.75–55.15 N) and are about
 * 32 km apart, so the horizon tier is downloaded once and the ground between them is real. The
 * switcher therefore swaps the analysis core without a page load, and the world stays continuous
 * underneath — the same argument the sibling alpine app makes for its two sites.
 *
 * ⚠️ It is a *shared shell*, not a shared analysis. Coverage, traffic and the optimiser stay scoped
 * to one core, because a percentage computed across two fjords a ship cannot sail between would
 * be arithmetic rather than a measurement.
 */
export const SHARED_SHELL = { west: 8.9, east: 11.7, south: 53.75, north: 55.15 };

/**
 * Which site a fresh load starts on: `?aoi=` if it names one we ship, else the default.
 *
 * 🔴 The id becomes part of a fetch path, so an unrecognised value is **replaced**, never echoed.
 * ⚠️ The membership test is `Object.prototype.hasOwnProperty`, not `in`: `in` walks the prototype
 * chain, so `?aoi=constructor` and `?aoi=toString` would both have passed it and been handed
 * straight to the loader.
 */
export function activeAoiId(search: string = window.location.search): string {
  const requested = new URLSearchParams(search).get("aoi");
  return requested && Object.prototype.hasOwnProperty.call(AOIS, requested)
    ? requested
    : DEFAULT_AOI;
}

/**
 * Keep the address bar in step without reloading, so a copied URL hands over the site on screen.
 * The default site drops the parameter rather than spelling it out — a link should be as short as
 * it can be and still be right.
 */
export function writeAoiToUrl(id: string): void {
  const url = new URL(window.location.href);
  if (id === DEFAULT_AOI) url.searchParams.delete("aoi");
  else url.searchParams.set("aoi", id);
  window.history.replaceState(null, "", url);
}
