import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import garchingRaw from '@config/aoi/garching.json';
import othRaw from '@config/aoi/oth-regensburg.json';
import { AOIS, DEFAULT_AOI, schedulerOverride } from '@/config/aoi';
import {
  ALL_NAVIGATUM_LENSES,
  CUSTOMER_SCHEDULER_SITES,
  EXCLUDED_AOIS,
  INTERIORS_ARE_SYNTHETIC,
  KEEPS_INTERIORS,
  NAVIGATUM_DEPENDENT_LENSES,
  NAVIGATUM_MODE,
  SHIPS_REAL_CUSTOMER_DATA,
  shipsSchedulerSite,
  usesNavigatum,
} from '@/config/release';
import { LENSES } from '@/lenses/registry';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

/** `?...` on the jsdom URL, so `schedulerOverride()` has something to read. */
function setSearch(search: string) {
  window.history.replaceState({}, '', search === '' ? '/' : `/?${search}`);
}

const GARCHING_SHIPS = !EXCLUDED_AOIS.includes('garching');

/**
 * Guards on the public-release switch (`config/release.json`).
 *
 * ⚠️ THE FAILURE THIS FILE EXISTS FOR IS A **HALF-STRIPPED BUILD** — one configured not to
 * redistribute TUM data that ships it anyway, or one that withholds the data and leaves a lens
 * pointing at nothing. Both look fine on the screen you are not looking at.
 */
describe('public-release switch', () => {
  it('resolves to one of the three modes', () => {
    expect(['include', 'synthetic', 'exclude']).toContain(NAVIGATUM_MODE);
  });

  it('names only real lenses as withholdable', () => {
    // Catches a rename in the registry silently turning the strip list into a no-op.
    for (const id of ALL_NAVIGATUM_LENSES) {
      expect(Object.keys(LENSES)).toContain(id);
    }
  });

  it('accounts for every lens Garching declares', () => {
    // Garching is the only NavigaTUM site, so each lens it declares must be one the switch has an
    // opinion about. Adding a lens there without deciding whether it survives a TUM-free build
    // fails here rather than shipping unexamined.
    const declared = (garchingRaw as { lenses: string[] }).lenses;
    for (const id of declared) {
      expect(ALL_NAVIGATUM_LENSES).toContain(id);
    }
  });

  it('withholds a subset of what a full exclusion withholds', () => {
    for (const id of NAVIGATUM_DEPENDENT_LENSES) {
      expect(ALL_NAVIGATUM_LENSES).toContain(id);
    }
  });

  it('the Python pipeline reads the same switch', () => {
    // ⚠️ The app and the pipeline must not disagree about what ships. There is no way to call
    // Python from here, so assert the same keys are consumed on both sides — a rename on one that
    // is not mirrored on the other is the realistic drift, and this catches it.
    const pipeline = read('tools/geodata/pipeline.py');
    expect(pipeline).toContain('navigatumData');
    expect(pipeline).toContain('excludeAois');
    for (const mode of ['include', 'synthetic', 'exclude']) {
      expect(pipeline).toContain(`"${mode}"`);
    }
  });

  it('never excludes the default AOI out from under the app', () => {
    // `activeAoiId()` falls back to DEFAULT_AOI, so excluding it would strand every visitor.
    expect(EXCLUDED_AOIS).not.toContain(DEFAULT_AOI);
    expect(AOIS[DEFAULT_AOI]).toBeDefined();
  });

  it('drops excluded AOIs from the shipped registry', () => {
    for (const id of EXCLUDED_AOIS) {
      expect(AOIS[id]).toBeUndefined();
    }
  });

  it('does not disturb the sites that were never TUM', () => {
    // LMU and OTH have room data too — an OSM survey with a generated timetable. A switch that
    // took their lenses away would be removing the wrong thing, and quietly.
    for (const id of ['lmu-muenchen', 'oth-regensburg']) {
      const aoi = AOIS[id];
      if (!aoi) continue;
      expect(aoi.lenses).toContain('occupancy');
    }
  });

  describe.runIf(GARCHING_SHIPS && NAVIGATUM_MODE === 'synthetic')('synthetic interiors', () => {
    it('KEEPS the room geometry, because it is OpenStreetMap and not TUM', () => {
      // This is the whole point of the mode: the explode view is geometry, and the geometry was
      // never TUM's to withhold.
      expect(KEEPS_INTERIORS).toBe(true);
      expect(AOIS['garching'].rooms).toBeDefined();
      expect(AOIS['garching'].lenses).toContain('occupancy');
    });

    it('still drops the flow lens', () => {
      // Routed from real consecutive bookings. Inventing where people walk is a bigger claim than
      // inventing a utilisation figure, and would look just as authoritative on screen.
      expect(AOIS['garching'].lenses).not.toContain('flow');
    });

    it('drops the planner, whose dataset is a separate TUM derivation', () => {
      expect(AOIS['garching'].schedulerSite).toBeUndefined();
    });

    it('flags the interiors as needing a badge', () => {
      expect(INTERIORS_ARE_SYNTHETIC).toBe(true);
    });
  });

  describe.runIf(GARCHING_SHIPS && NAVIGATUM_MODE === 'exclude')('no interiors', () => {
    it('leaves no site claiming a TUM source', () => {
      for (const aoi of Object.values(AOIS)) {
        expect(usesNavigatum(aoi)).toBe(false);
      }
    });

    it('leaves no lens without the data behind it', () => {
      const garching = AOIS['garching'];
      expect(garching.rooms).toBeUndefined();
      expect(garching.schedulerSite).toBeUndefined();
      expect(garching.lenses).toEqual([]);
      expect(KEEPS_INTERIORS).toBe(false);
    });
  });
});

/**
 * Lever C — a customer's own timetable export.
 *
 * ⚠️ THE FAILURE THIS EXISTS FOR IS NOT A LEAKED FILE. `/data/` is gitignored, so OTH's Untis
 * export was never going to be committed. What WAS committed is a tracked AOI config naming
 * `schedulerSite: "oth-real"` as the default — the product pointed at a customer's week, in a
 * file that ships. The substitution below is what stops that, and a substitution nobody checks is
 * one that gets refactored away by somebody who cannot see what it was for.
 */
describe('customer-data switch', () => {
  it('only the literal "include" includes', () => {
    // Mirrors the fail-closed bias in release.ts. Reading the file rather than the module so a
    // future default of `?? true` on the import side cannot make this test agree with itself.
    const declared = JSON.parse(read('config/release.json')).realCustomerData;
    expect(SHIPS_REAL_CUSTOMER_DATA).toBe(declared === 'include');
  });

  it('names only sites the app knows about', () => {
    const aoiSrc = read('src/config/aoi.ts');
    const declared = /const SCHEDULER_SITES = \[([^\]]+)\]/.exec(aoiSrc)?.[1] ?? '';
    for (const site of CUSTOMER_SCHEDULER_SITES) {
      expect(declared, `SCHEDULER_SITES does not list "${site}"`).toContain(`'${site}'`);
    }
  });

  it('the shipped gate agrees with itself in both directions', () => {
    for (const site of CUSTOMER_SCHEDULER_SITES) {
      expect(shipsSchedulerSite(site)).toBe(SHIPS_REAL_CUSTOMER_DATA);
    }
    // The mirror. Without it, a `shipsSchedulerSite` that returned false for everything would
    // pass the line above and silently strip every planner in the product.
    expect(shipsSchedulerSite('oth')).toBe(true);
    expect(shipsSchedulerSite('lmu')).toBe(true);
  });

  describe.runIf(!SHIPS_REAL_CUSTOMER_DATA)('withheld', () => {
    it('no shipped AOI names a customer site', () => {
      for (const [id, aoi] of Object.entries(AOIS)) {
        expect(CUSTOMER_SCHEDULER_SITES, `${id} still names its customer backend`).not.toContain(
          aoi.schedulerSite,
        );
      }
    });

    it('OTH keeps its planner, on the generated week', () => {
      // ⚠️ THE POINT OF SUBSTITUTING RATHER THAN DELETING. `hasPlanner` is
      // `Boolean(schedulerSite)`, so dropping the field would leave the published template
      // demonstrating a 3D campus viewer — the calendar, the cascade and the solver are the
      // product. `oth` is the same campus with a week this repository generates itself.
      expect(AOIS['oth-regensburg'].schedulerSite).toBe('oth');
    });

    it('the AOI config it substitutes really did ask for the customer site', () => {
      // Otherwise this whole describe block passes vacuously the day someone edits the JSON by
      // hand — and the internal demo silently loses the real week with nothing to say so.
      expect((othRaw as { schedulerSite?: string }).schedulerSite).toBe('oth-real');
    });

    it('ignores ?scheduler=oth-real instead of pointing at a backend that is not there', () => {
      // Substituting the default protects the site someone LANDS on; this protects the one they
      // TYPE. `apiBase()` returns '' for an unregistered site, so honouring the override would
      // render an empty week — a withheld dataset that reads as a broken product.
      const original = window.location.search;
      try {
        setSearch('scheduler=oth-real');
        expect(schedulerOverride()).toBeNull();
        setSearch('scheduler=oth');
        expect(schedulerOverride()).toBe('oth');
      } finally {
        setSearch(original.replace(/^\?/, ''));
      }
    });
  });
});
