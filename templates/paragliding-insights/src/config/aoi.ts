import oberstdorf from '@config/aoi/oberstdorf.json';
import tegelberg from '@config/aoi/tegelberg.json';

/**
 * The area of interest, as configuration — PLAN §4.4, decision 21.
 *
 * ⚠️ **This module is the point of phase 7.** The claim throughout has been that the AOI is genuinely
 * configuration rather than a set of constants that happen to live in a JSON file — and until now
 * that claim was false in the most ordinary way possible: two components imported
 * `@config/aoi/oberstdorf.json` by name. One file, one hard-coded site, and a plan that said
 * otherwise. A second AOI is what makes the difference visible, which is exactly why decision 21
 * asked for one.
 *
 * Switching sites reloads the page rather than swapping the scene in place. That is deliberate: a
 * site change replaces the heightmap, the land cover, the buildings, 200 000 trees, the drape and
 * the cable car, so the honest implementation of "switch" is the one that tears everything down. An
 * in-place swap would be a large amount of disposal code whose only purpose is to avoid a reload
 * the viewer would not notice.
 */

export interface AoiBbox {
  west: number;
  east: number;
  south: number;
  north: number;
}

/**
 * A webcam looking at this site — PLAN §5.9, decision 26.
 *
 * ⚠️ `use` is a licence, not a preference. `link-only` means the app may place a marker and open
 * the operator's page; it may **not** fetch, embed, cache or draw the image. foto-webcam.eu's
 * terms forbid copying or altering their pictures without written consent and in the same breath
 * welcome links, so the marker links. Anything that displays a picture needs the operator asked
 * first, and `NOTICE.md` says so beside the entry.
 */
export interface AoiWebcam {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Metres above sea level, from the OSM node's own `ele`. */
  eleM: number;
  /** Degrees clockwise from north — the direction the camera looks, verified twice. */
  bearingDeg: number;
  page: string;
  operator: string;
  use: 'link-only';
  osm: string;
}

export interface AoiConfig {
  id: string;
  site: {
    name: Record<string, string>;
    region: Record<string, string>;
    timezone: string;
  };
  bbox: AoiBbox;
  shell: AoiBbox;
  elevationRangeM: { min: number; max: number };
  focusPlaces: { id: string; name: string; lat: number; lon: number }[];
  geobasis: { attribution: string; licence: string; licenceUrl: string };
  shellGeobasis: { attribution: string; licence: string; licenceUrl: string };
  tour: { placeId: string; captionKey: string; rangeM: number; holdMs: number }[];
  webcams?: AoiWebcam[];
  flights: { heroFlight: string | null };
}

/**
 * Every AOI that ships.
 *
 * Listed rather than globbed, so adding a site is a deliberate act with a diff, and so a stray
 * JSON file in `config/aoi/` cannot become a shipped location by accident.
 */
export const AOIS: Record<string, AoiConfig> = {
  oberstdorf: oberstdorf as unknown as AoiConfig,
  tegelberg: tegelberg as unknown as AoiConfig,
};

export const DEFAULT_AOI = 'oberstdorf';

/**
 * Which site to show.
 *
 * `?aoi=tegelberg` in the URL, falling back to a build-time default. A URL parameter rather than a
 * stored preference because the demonstration is *showing someone the swap*, and a link is the
 * simplest thing to hand over — including to a colleague, which is how this app is shared.
 */
export function activeAoiId(): string {
  const fromUrl =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('aoi') : null;
  const requested = fromUrl ?? import.meta.env.VITE_AOI ?? DEFAULT_AOI;
  return requested in AOIS ? requested : DEFAULT_AOI;
}

export function activeAoi(): AoiConfig {
  return AOIS[activeAoiId()];
}

/** Switch site. Reloads, for the reason in the module note. */
export function switchAoi(id: string): void {
  if (!(id in AOIS) || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id === DEFAULT_AOI) url.searchParams.delete('aoi');
  else url.searchParams.set('aoi', id);
  window.location.href = url.toString();
}
