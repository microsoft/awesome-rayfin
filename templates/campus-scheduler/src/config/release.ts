import release from '@config/release.json';

/**
 * The public-release switch, read from `config/release.json`.
 *
 * Three levers, deliberately separate because they answer different questions:
 *
 * - `navigatumData` — what may Garching's interiors be made of? include / synthetic / exclude.
 * - `excludeAois` — should the site appear at all? Garching goes.
 * - `realCustomerData` — may a customer's own timetable export ship? OTH's Untis week goes.
 *
 * ⚠️ THE SAME FILE DRIVES THE PYTHON PIPELINE (`tools/geodata/pipeline.py`). Excluding a source
 * in the app while the pipeline still fetches it would produce a build that looks clean and
 * ships the assets anyway — the failure mode this file exists to prevent.
 */

/** Minimal structural shape, so this module needs no import from `aoi.ts` and cannot cycle. */
export interface NavigatumSourced {
  rooms?: { navigatumBase?: string };
}

export type NavigatumMode = 'include' | 'synthetic' | 'exclude';

const RAW_MODE = (release as { navigatumData?: string }).navigatumData;

/**
 * ⚠️ AN UNRECOGNISED VALUE FAILS CLOSED, to `exclude`.
 *
 * A typo — `"syntetic"` — must not silently resolve to `include` and publish TUM's timetable.
 * Withholding too much is a far smaller mistake than redistributing data we were told not to.
 */
export const NAVIGATUM_MODE: NavigatumMode =
  RAW_MODE === 'include' || RAW_MODE === 'synthetic' || RAW_MODE === 'exclude'
    ? RAW_MODE
    : 'exclude';

export const EXCLUDED_AOIS: readonly string[] = Array.isArray(release.excludeAois)
  ? (release.excludeAois as string[])
  : [];

/**
 * Does this AOI's interior come from NavigaTUM/TUMonline?
 *
 * ⚠️ `rooms` IS THE WRONG TEST and would catch the wrong sites. OTH, LMU and Garching all carry a
 * `rooms` block, because in this repository that block means "the app has room geometry". Where
 * that geometry came from is a different question, and only one AOI answers it with a TUM API.
 * This mirrors `from_navigatum()` in `tools/geodata/pipeline.py` exactly — if one changes, so
 * must the other, and `release.test.ts` fails if they disagree about Garching.
 */
export function usesNavigatum(aoi: NavigatumSourced): boolean {
  return Boolean(aoi.rooms?.navigatumBase);
}

/**
 * Lenses withheld from a TUM-sourced site, by mode.
 *
 * ⚠️ THE TWO LENSES ARE NOT EQUALLY REPLACEABLE, which is the whole reason this is a map rather
 * than one list:
 *
 * - `occupancy` needs room geometry and a week. The geometry is OpenStreetMap's and survives
 *   intact; the week can be invented and badged. So it SURVIVES in `synthetic`.
 * - `flow` is routed from real consecutive course bookings between real rooms. Inventing where
 *   people walk across a campus is a materially bigger claim than inventing a utilisation
 *   percentage, and it would look just as authoritative. So it goes in `synthetic` too.
 *
 * Listed here rather than derived from `LENSES` to keep this module free of runtime imports —
 * `release.test.ts` asserts the lists still match the registry's own requirements.
 */
const WITHHELD_LENSES: Record<NavigatumMode, readonly string[]> = {
  include: [],
  synthetic: ['flow'],
  exclude: ['occupancy', 'flow'],
};

export const NAVIGATUM_DEPENDENT_LENSES: readonly string[] = WITHHELD_LENSES[NAVIGATUM_MODE];

/** Every lens any mode can withhold — what `release.test.ts` checks against the registry. */
export const ALL_NAVIGATUM_LENSES: readonly string[] = WITHHELD_LENSES.exclude;

/** True while Garching still has interiors of some kind, real or invented. */
export const KEEPS_INTERIORS = NAVIGATUM_MODE !== 'exclude';

/**
 * True when the interiors shown are invented and must be badged as such.
 *
 * The scene is of a REAL place with REAL room numbers, so an unbadged synthetic utilisation would
 * read as TUM's own measured figure. `TwinShell` uses this to pick the data note.
 */
export const INTERIORS_ARE_SYNTHETIC = NAVIGATUM_MODE === 'synthetic';

/**
 * Does this build ship the named AOI?
 *
 * ⚠️ ANYTHING THAT OFFERS TO OPEN A TWIN MUST ASK THIS FIRST. The national campus index is a
 * separate file from the AOI registry, so withholding a site leaves its dot behind, still drawn
 * as enterable. `switchAoi()` then falls back to the default site — the map says "open TUM" and
 * opens Regensburg, which is worse than not offering it at all.
 */
export function shipsAoi(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.length > 0 && !EXCLUDED_AOIS.includes(id);
}

/* ------------------------------------------------------------------------------------------- *
 * LEVER C — a customer's own timetable export
 * ------------------------------------------------------------------------------------------- */

/**
 * ⚠️ FAILS CLOSED, AND WITH A HARDER BIAS THAN LEVER A: only the literal `"include"` includes.
 *
 * TUM's data is at least published somewhere. A university's own Untis export is not public in any
 * form, so a missing key or a typo must withhold it. The generated site is a complete substitute,
 * which is what makes failing closed cheap here.
 */
export const SHIPS_REAL_CUSTOMER_DATA =
  (release as { realCustomerData?: string }).realCustomerData === 'include';

/**
 * Scheduler sites whose dataset is a customer's own export rather than something we generated.
 *
 * A LIST, not a flag on the site id, because the question "did we make this data up?" is asked in
 * three places (which backend the AOI names, which `?scheduler=` overrides are honoured, and what
 * `check_release.mjs` looks for on disk) and one of them forgetting is exactly how the OTH week
 * would reach a public build.
 */
export const CUSTOMER_SCHEDULER_SITES: readonly string[] = ['oth-real'];

/**
 * What a withheld customer site becomes.
 *
 * ⚠️ SUBSTITUTED, NOT DROPPED. Deleting `schedulerSite` would be the safe-looking move and it is
 * the wrong one: `hasPlanner` is `Boolean(schedulerSite)`, so OTH — the site the whole product is
 * about, the one every e2e spec pins, the one the README opens on — would lose its calendar, its
 * cascade and its solver, and the published template would demonstrate a 3D campus viewer. The
 * generated `oth` dataset is the same campus, the same rooms and the same buildings with a week
 * this repository produces itself from `config/academic/oth.json`. Nothing is lost but provenance,
 * and provenance is exactly what the badge already says.
 *
 * A customer site with no generated counterpart maps to `undefined` and the AOI does lose its
 * planner — correct, because there would be nothing honest to put in the week.
 */
const GENERATED_SUBSTITUTE: Record<string, string | undefined> = {
  'oth-real': 'oth',
};

/** Is this scheduler site one this build may talk to at all? */
export function shipsSchedulerSite(site: string | null | undefined): boolean {
  if (typeof site !== 'string' || site.length === 0) return false;
  return SHIPS_REAL_CUSTOMER_DATA || !CUSTOMER_SCHEDULER_SITES.includes(site);
}

/** The site an AOI should actually name, once Lever C has been applied. */
export function substituteSchedulerSite(site: string | undefined): string | undefined {
  if (site === undefined) return undefined;
  if (shipsSchedulerSite(site)) return site;
  return GENERATED_SUBSTITUTE[site];
}
