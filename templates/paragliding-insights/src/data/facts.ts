/**
 * Every factual figure shown in the UI lives here, and every figure carries its source.
 *
 * PLAN §4.8 — "If a claim cannot be sourced, it does not go in the app. No exceptions."
 *
 * That rule is enforced in code rather than by discipline: a fact with no `source` renders as a
 * visible defect (see `SourcedFigure`), it does not silently render as a bare number. The point is
 * that an unsourced figure should be *harder* to ship than a sourced one.
 *
 * Note what does NOT belong here. Anything the terrain itself measures — a summit elevation, the
 * height of a launch site, the relief of the valley — is read from the generated heightmap at
 * runtime and carries the geobasis attribution of that dataset. Restating those as constants would
 * hard-code the AOI (§14 Q2) and create a second number that can drift away from the map.
 */

export interface Source {
  /** Title of the document or dataset, as published. */
  title: string;
  /** Issuing body. */
  issuer: string;
  year: number;
  url?: string;
  /** True when the figure is derived or reconstructed rather than measured. */
  reconstruction?: boolean;
  /**
   * Status note where the figure is provisional or has changed since publication — PLAN §4.8
   * requires the current status *and its date* to be stated.
   */
  status?: string;
}

export interface Fact<T> {
  value: T;
  source: Source | null;
  /** Uncertainty range. Required whenever `source.reconstruction` is true. */
  range?: [T, T];
  unit?: string;
}

/**
 * Terrain, orthophotos and LoD2 buildings for the high-resolution core.
 *
 * CC BY 4.0, and the licence prescribes the wording of the notice, which is why the attribution
 * string is quoted from the AOI config rather than paraphrased here.
 */
export const GEOBASIS_BAYERN: Source = {
  title: 'Digitales Geländemodell DGM1, Digitale Orthophotos DOP20, 3D-Gebäudemodell LoD2',
  issuer: 'Bayerische Vermessungsverwaltung (LDBV)',
  year: 2026,
  url: 'https://geodaten.bayern.de/opengeodata/',
};

/** Terrain for the coarse shell, which crosses the Austrian border where LDBV stops. */
export const COPERNICUS_DEM: Source = {
  title: 'Copernicus DEM GLO-30 — global digital surface model, 30 m',
  issuer: 'ESA / DLR / Airbus Defence and Space',
  year: 2019,
  url: 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
  // A DSM on EGM2008, not a bare-earth DTM on DHHN2016 like the core. Stated wherever shell
  // elevations are shown, because the two tiers do not measure the same surface.
  status: 'Oberflächenmodell (DSM), Höhenbezug EGM2008',
};

/** Land cover, roads, the cableway, and the flying sites. */
export const OPENSTREETMAP: Source = {
  title: 'OpenStreetMap — Landnutzung, Verkehrswege, Seilbahnen',
  issuer: 'OpenStreetMap contributors (ODbL)',
  year: 2026,
  url: 'https://www.openstreetmap.org/copyright',
  // Current mapping, not the state at any past date. Matters as soon as a historic flight is
  // drawn over it.
  status: 'Aktueller Erfassungsstand',
};

/**
 * Facts that must be sourced before the app is shown outside the team.
 *
 * Empty during Phase 0, because the app currently displays no figure it has not measured itself.
 * Entries are added as soon as a number is quoted rather than computed — wind and thermal figures,
 * flight statistics, site elevations taken from a register rather than from the terrain.
 */
const RELEASE_GATING_FACTS: Fact<number>[] = [];

/**
 * Whether every gated fact carries a source.
 *
 * ⚠️ An empty registry is deliberately **not** release-ready. `[].every()` is true, so a naive
 * check would report a clean bill of health for an app that has simply not registered its facts
 * yet — which is precisely the failure mode this gate exists to catch.
 */
export function isReleaseReady(): boolean {
  return RELEASE_GATING_FACTS.length > 0 && RELEASE_GATING_FACTS.every((f) => f.source !== null);
}

/** Exposed for the test that pins the sourcing rule. */
export const gatedFacts = (): readonly Fact<number>[] => RELEASE_GATING_FACTS;
