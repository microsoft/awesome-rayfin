import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import de from '@/i18n/de.json';
import en from '@/i18n/en.json';
import { AOIS, DEFAULT_AOI, hasPlanner, supportsLens, type AoiConfig } from '@/config/aoi';
import { EXCLUDED_AOIS, NAVIGATUM_MODE } from '@/config/release';
import { knownSchedulerSites } from '@/api/scheduler';

/**
 * ⚠️ THE BACKEND URLS COME FROM `.env.local`, WHICH `rayfin env` GENERATES AND GIT IGNORES.
 * `knownSchedulerSites()` reads them through `import.meta.env`, so on a fresh clone it is empty
 * and the one case that depends on it fails for a missing prerequisite rather than a defect.
 * Everything else in this file is about the committed registry and runs anywhere.
 *
 * ⚠️ THE GUARD ASKS FOR THE SCHEDULER KEYS SPECIFICALLY, not for the file. `rayfin env` can
 * write a file with only a comment header, or with Fabric identifiers and no backend URLs at all
 * — both leave `knownSchedulerSites()` empty while an existence check says go, which turns a
 * missing prerequisite into a red suite.
 */
const ENV_LOCAL = (() => {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return false;
  return /^VITE_[A-Z0-9_]*SCHEDULER_API/m.test(readFileSync(path, 'utf-8'));
})();

/**
 * The site-registry contract.
 *
 * Campus-Scheduler shipped one university and then acquired a second, which is the moment every
 * "the AOI is configuration" claim gets tested for real. `src/config/aoi.ts` warns about exactly
 * this in its module note, and the warning was earned elsewhere in the same codebase: components
 * that simply imported the one JSON file by name.
 *
 * These checks are about the SEAMS between an AOI and the rest of the app — the places where a
 * second site can be wrong in a way that nothing else notices:
 *
 *   * a tour caption key that has no translation. ⚠️ The i18n catalogue test cannot catch this
 *     one. It scans for literal `t('...')` calls in source, and a tour caption is never written
 *     that way — it arrives from JSON at runtime. A missing `tour.lmu.klinikum` would render as
 *     the raw key on screen, invisible to tsc, to that test, and to any e2e assertion that only
 *     checks an element is present and non-empty. That is precisely the defect the catalogue test
 *     was written to stop, coming in through a door it does not watch.
 *   * a tour stop pointing at a focus place that does not exist
 *   * a focus place or campus box outside the AOI's own core box, which would put the camera or
 *     the building filter somewhere the terrain was never built
 */

const CATALOGUES: Record<string, unknown> = { de, en };

function lookup(catalogue: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalogue,
    );
}

const entries = Object.entries(AOIS) as [string, AoiConfig][];

/**
 * Every site this repository can build, before `config/release.json` has its say.
 *
 * ⚠️ WRITTEN OUT IN FULL ON PURPOSE, then filtered — not read back off `AOIS`. Comparing the
 * registry against itself would pass on an empty registry, which is precisely the accident a
 * release switch can cause.
 */
const ALL_SITES = [
  'aachen',
  'fau-erlangen',
  'garching',
  'koeln',
  'lmu-muenchen',
  'muenster',
  'oth-regensburg',
  'tuebingen',
];
const EXPECTED_SITES = ALL_SITES.filter((id) => !EXCLUDED_AOIS.includes(id));

/** Garching is the only NavigaTUM site, so either lever can take it out of scope. */
const GARCHING_SHIPS = !EXCLUDED_AOIS.includes('garching');

describe('the AOI registry', () => {
  it('ships every university and defaults to the first customer', () => {
    // ⚠️ SIX OF THESE EIGHT HAVE NO PLANNER, AND THAT IS DELIBERATE. Garching and Tübingen came
    // from Campus-Insights as campus twins: scenes, rooms and lenses, no timetable. FAU Erlangen,
    // Köln, Aachen and Münster were built later for the top-ten-by-students set and are twins for
    // the same reason — none of them publishes a timetable this project can read. They are in the
    // registry so one build can be shown to any of eight universities; `hasPlanner` is what keeps
    // the calendar and the assistant off the six that have nothing to plan.
    expect(Object.keys(AOIS).sort()).toEqual(EXPECTED_SITES);
    expect(DEFAULT_AOI).toBe('oth-regensburg');
  });

  it('gives a planner exactly to the sites that have a timetable behind it', () => {
    // The pairing that matters: a site claiming a backend must name which one, and a site with no
    // backend must not be quietly carrying a stale `schedulerSite` from whatever it was forked
    // from. Pinned by id so adding a fifth site is a decision rather than an inherited default.
    //
    // ⚠️ GARCHING'S PLANNER IS TUM'S TIMETABLE, so it drops out in every mode that withholds it.
    // Substituting the twin's occupancy does NOT substitute the planner: its dataset is a
    // separate derivation of the same TUMonline bookings, in `data/tum/`.
    const expected = ['garching', 'lmu-muenchen', 'oth-regensburg'].filter(
      (id) => !EXCLUDED_AOIS.includes(id) && !(NAVIGATUM_MODE !== 'include' && id === 'garching'),
    );
    const withPlanner = entries.filter(([, aoi]) => hasPlanner(aoi)).map(([id]) => id);
    expect(withPlanner.sort()).toEqual(expected);
    for (const [id, aoi] of entries) {
      expect(Boolean(aoi.schedulerSite), id).toBe(hasPlanner(aoi));
    }
  });

  it.skipIf(!ENV_LOCAL)(
    'knows a backend for every site that claims one (needs `rayfin env --framework vite`)',
    () => {
    /*
     * ⚠️ THE TRAP THIS EXISTS FOR. `hasPlanner` is `Boolean(schedulerSite)`, so one line in an AOI
     * turns the entire planner on — and `apiBase()` resolves an unregistered site to the
     * single-backend FALLBACK, which is another university's container. Adding the AOI line
     * without the base would render Garching's campus over OTH's timetable under a TUM heading:
     * every request succeeds, every number is real, and all of them are about someone else.
     *
     * The failure is silent by construction, so it has to be caught here rather than noticed.
     */
    const known = knownSchedulerSites();
    for (const [id, aoi] of entries) {
      if (!aoi.schedulerSite) continue;
      expect(known, `${id} names scheduler site "${aoi.schedulerSite}" with no backend URL`).toContain(
        aoi.schedulerSite
      );
    }
    },
  );

  it.each(entries)('%s keys itself by its own id', (id, aoi) => {
    // A registry keyed by one id holding a config that calls itself another is how the wrong
    // terrain directory gets loaded — `public/terrain/<aoi.id>` is derived from the config.
    expect(aoi.id).toBe(id);
  });

  it.runIf(GARCHING_SHIPS)(
    'offers no lens that would divide real teaching among invented people',
    () => {
      /*
       * ⚠️ A RATIFIED PRODUCT DECISION, PINNED SO IT CANNOT BE UNDONE BY ACCIDENT.
       *
       * Both of these lenses answer questions about PEOPLE and COHORTS: `staffing` divides
       * teaching load against each lecturer's contracted SWS, `quality` measures how a cohort's
       * day is shaped. At Garching the sessions, rooms and hours are really TUM's, and the
       * lecturers and cohorts are invented — TUMonline publishes neither. So both lenses would
       * compute exact, confident findings about fabricated staff, attached by name to real courses.
       *
       * That is the single most misleading pairing this project can produce, and it would look
       * completely normal on screen. The site simply does not declare them (`lenses` is
       * `["occupancy", "flow"]`), but "we happened not to add it" is not a guarantee — this is.
       *
       * Skipped when `config/release.json` withholds Garching outright; when it withholds only
       * the TUM data the site is still here with `lenses: []`, which satisfies this just as well.
       */
      const garching = AOIS['garching'];
      expect(garching.lenses).not.toContain('staffing');
      expect(garching.lenses).not.toContain('quality');
      expect(supportsLens(garching, 'staffing')).toBe(false);
      expect(supportsLens(garching, 'quality')).toBe(false);
    },
  );
});

describe.each(entries)('%s', (_id, aoi) => {
  it('describes itself in both languages', () => {
    for (const lang of Object.keys(CATALOGUES)) {
      expect(aoi.site.name[lang]?.length).toBeGreaterThan(0);
      expect(aoi.site.region[lang]?.length).toBeGreaterThan(0);
    }
  });

  it('has a tour whose stops all exist as focus places', () => {
    const places = new Set(aoi.focusPlaces.map((p) => p.id));
    expect(aoi.tour.length).toBeGreaterThan(0);
    for (const stop of aoi.tour) {
      expect(places, `tour stop '${stop.placeId}'`).toContain(stop.placeId);
    }
  });

  it('has a translated caption for every tour stop, in every language', () => {
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      for (const stop of aoi.tour) {
        const caption = lookup(catalogue, stop.captionKey);
        expect(typeof caption, `${lang}: ${stop.captionKey}`).toBe('string');
        expect((caption as string).length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * ⚠️ A SITE THAT SHOWS ROOMS MUST SAY WHERE THEY CAME FROM — IN ITS OWN WORDS.
   *
   * Both provenance lines used to be one hard-coded sentence about OTH's published storey plans,
   * and it was rendered over TUM Garching and LMU as well. At Garching it was wrong in both
   * directions at once: the floor plans there are OpenStreetMap indoor mapping, not an OTH CAD
   * drawing, and the bookings are REAL TUMonline data, not a generated timetable — the app was
   * disclaiming as invented the one dataset in the whole project that is genuinely measured.
   *
   * These keys are built from the AOI id at runtime, so `catalogue.test.ts` cannot see them: its
   * scan finds literal `t('...')` calls, and this is a template. Same door the tour captions come
   * through, which is why the check lives here.
   */
  it('names its own room provenance in every language, when it has rooms', () => {
    if (!aoi.rooms) return;
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of [`rooms.provenance.${aoi.id}`, `occupancy.provenance.${aoi.id}`]) {
        const line = lookup(catalogue, key);
        expect(typeof line, `${lang}: ${key}`).toBe('string');
        expect((line as string).length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps every focus place inside its own core box', () => {
    for (const place of aoi.focusPlaces) {
      expect(place.lat, place.id).toBeGreaterThanOrEqual(aoi.bbox.south);
      expect(place.lat, place.id).toBeLessThanOrEqual(aoi.bbox.north);
      expect(place.lon, place.id).toBeGreaterThanOrEqual(aoi.bbox.west);
      expect(place.lon, place.id).toBeLessThanOrEqual(aoi.bbox.east);
    }
  });

  it('nests its core box inside its shell', () => {
    expect(aoi.bbox.west).toBeGreaterThanOrEqual(aoi.shell.west);
    expect(aoi.bbox.east).toBeLessThanOrEqual(aoi.shell.east);
    expect(aoi.bbox.south).toBeGreaterThanOrEqual(aoi.shell.south);
    expect(aoi.bbox.north).toBeLessThanOrEqual(aoi.shell.north);
  });

  it('holds exactly the campuses it is supposed to, all inside the core box', () => {
    // ⚠️ PINNED BY ID, NOT BY COUNT. This asserted `toHaveLength(2)` and had to be revisited the
    // moment OTH gained a third location — which is the wrong kind of revisit, because a bare
    // count cannot tell "we added TechBase on purpose" from "we silently lost Prüfening". Naming
    // them catches a loss, a rename and an accidental addition, and it makes the third site a
    // deliberate edit here rather than a number that quietly changed.
    const expected: Record<string, string[]> = {
      // ⚠️ TECHBASE IS NOT HERE, AND WAS BRIEFLY LISTED AS A CAMPUS BY MISTAKE. OTH is a TENANT in
      // the TechBase building — `building=office` operated by TechBase Regensburg, with Vector
      // Informatik, GEFASOFT and intive at the same address — and its presence is one node, the
      // Sensorik-Applikationszentrum. The AOI config's own comment said "ONE TENANCY IN ONE
      // BUILDING, not a campus" while the entry sat in `campuses[]` regardless. The tenancy still
      // shows up in `ownership.extraIds`, which is the honest place for it: a building OTH
      // operates in, not a site OTH has.
      'oth-regensburg': ['pruefening', 'seyboth'],
      'lmu-muenchen': ['klinikum', 'stammgelaende'],
      // ⚠️ GARCHING AND TÜBINGEN CARRY NO `campuses` BLOCK, AND THE ABSENCE IS THE STATEMENT.
      // Both are single-site AOIs — one research campus, one old town — so there is no corridor
      // between two locations for the plan to have to reason about, which is the only reason the
      // block exists. They are listed here with an empty expectation rather than left out of the
      // table, because omitting them would quietly drop them from this guard and a `campuses`
      // block appearing later by accident would then go unnoticed.
      garching: [],
      tuebingen: [],
      // ⚠️ FAU HAS TWO CAMPUSES ON THE GROUND AND STILL DECLARES NONE, WHICH IS NOT AN OVERSIGHT.
      // The Südgelände and Röthelheim clusters really are separate places about 2 km apart, so on
      // the face of it this should look like OTH. But `campuses` exists to let the PLANNER reason
      // about a corridor — travel time between sites, a break too short to cross the city — and
      // FAU has no timetable behind it. Declaring the block without a planner would add data
      // nothing reads, and would assert a split the app cannot act on.
      'fau-erlangen': [],
      // Köln is genuinely one campus: the second cluster the locator found is a 40 x 10 m fragment.
      koeln: [],
      // Aachen and Münster each have two halves about 2.5 km apart — Templergraben and Melaten,
      // Schlossplatz and the Coesfelder Kreuz. Same reasoning as FAU: real on the ground, and not
      // declared, because `campuses` exists for a planner to reason about a corridor and neither
      // site has a timetable to reason with.
      aachen: [],
      muenster: [],
    };
    const campuses =
      (aoi as unknown as { campuses?: { id: string; bbox: Record<string, number> }[] }).campuses ??
      [];
    expect(campuses.map((c) => c.id).sort()).toEqual(expected[aoi.id]);
    for (const campus of campuses) {
      expect(campus.bbox.west, campus.id).toBeGreaterThanOrEqual(aoi.bbox.west);
      expect(campus.bbox.east, campus.id).toBeLessThanOrEqual(aoi.bbox.east);
      expect(campus.bbox.south, campus.id).toBeGreaterThanOrEqual(aoi.bbox.south);
      expect(campus.bbox.north, campus.id).toBeLessThanOrEqual(aoi.bbox.north);
    }
  });

  it('declares an elevation bracket that contains its own measurement', () => {
    expect(aoi.elevationRangeM.min).toBeLessThan(aoi.elevationRangeM.max);
  });

  it('only offers lenses it lists', () => {
    // `supportsLens` is what the UI asks before showing a control. A lens offered by an AOI that
    // cannot answer it is the "grey means unknown, never zero" rule broken at the panel level.
    for (const lens of aoi.lenses) {
      expect(supportsLens(aoi, lens)).toBe(true);
    }
    expect(supportsLens(aoi, 'condition')).toBe(aoi.lenses.includes('condition'));
  });
});

/**
 * The scheduler-site list in `aoi.ts` must match the one `scheduler.ts` has URLs for.
 *
 * ⚠️ THIS IS THE GUARD THAT MAKES A DELIBERATE DUPLICATION SAFE. `scheduler.ts` imports
 * `activeAoi` from `aoi.ts`, so `aoi.ts` cannot import back without a module cycle — and a cycle
 * resolved during initialisation degrades to an EMPTY list, which would silently reject every
 * `?scheduler=` override instead of failing. So the list is written twice and compared here, the
 * same technique `planStore.test.ts` uses across the entity boundary.
 */
describe('the scheduler override list', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

  it('names exactly the sites scheduler.ts can reach', () => {
    const aoiSrc = read('src/config/aoi.ts');
    const apiSrc = read('src/api/scheduler.ts');

    const declared = /const SCHEDULER_SITES = \[([^\]]+)\]/.exec(aoiSrc);
    expect(declared, 'SCHEDULER_SITES not found in aoi.ts').toBeTruthy();
    const listed = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    const block = /const SITE_BASES[^{]*\{([\s\S]*?)\n\};/.exec(apiSrc);
    expect(block, 'SITE_BASES not found in scheduler.ts').toBeTruthy();
    const keys = [...block![1].matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]).sort();

    expect(keys.length).toBeGreaterThan(2);
    expect(listed).toEqual(keys);
  });
});
