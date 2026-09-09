import { describe, expect, it } from 'vitest';

import index from '@config/campus-index.json';
import { AOIS } from '@/config/aoi';
import { shipsAoi } from '@/config/release';

/**
 * The national index is GENERATED, and a generated file fails quietly.
 *
 * ⚠️ NOTHING ELSE LOOKS AT THIS DATA. TypeScript checks the shape and is satisfied by a dot in the
 * North Sea; the e2e spec clicks two known dots and never sees the other forty-nine. So a bad
 * regeneration — a changed key upstream, a university with no campus falling back to a null point,
 * a stale `aoi` after a rename — ships a map that renders perfectly and is wrong.
 *
 * The bug that motivated this had already happened once: the first build placed the four BUILT
 * twins on their city centres, so TUM's dot sat on Munich's town hall, 12 km from Garching. It
 * looked entirely plausible. The `twin` case below is the assertion that would have caught it.
 */

const dots = index.universities;

/** Germany, generously. Anything outside this is not a German university's campus. */
const GERMANY = { minLat: 47.2, maxLat: 55.1, minLon: 5.8, maxLon: 15.1 };

describe('the national campus index', () => {
  it('is not empty and has no duplicate universities', () => {
    expect(dots.length).toBeGreaterThan(0);
    const ids = dots.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every university inside Germany', () => {
    const stray = dots.filter(
      (d) =>
        d.lat < GERMANY.minLat ||
        d.lat > GERMANY.maxLat ||
        d.lon < GERMANY.minLon ||
        d.lon > GERMANY.maxLon
    );
    expect(stray.map((d) => `${d.name} ${d.lat},${d.lon}`)).toEqual([]);
  });

  it('says how precise each position is, using only the three known kinds', () => {
    const kinds = new Set(dots.map((d) => d.centreFrom));
    expect([...kinds].sort()).toEqual(
      expect.arrayContaining([...kinds].filter((k) => ['twin', 'campus', 'city'].includes(k)))
    );
    expect(dots.filter((d) => !['twin', 'campus', 'city'].includes(d.centreFrom))).toEqual([]);
  });

  it('only claims a twin that actually exists', () => {
    // ⚠️ A SITE WITHHELD BY `config/release.json` IS NOT A DANGLING REFERENCE. It is absent on
    // purpose, and `NationalMap` blanks its `aoi` so the dot stops offering to open it. What this
    // guard is still for is the typo — an index entry naming a twin that was never built.
    const dangling = dots.filter((d) => d.aoi && shipsAoi(d.aoi) && !(d.aoi in AOIS));
    expect(dangling.map((d) => `${d.name} -> ${d.aoi}`)).toEqual([]);
  });

  /**
   * ⚠️ EVERY BUILT TWIN MUST BE REACHABLE FROM THE MAP. The map is becoming the way into the app,
   * so a twin that exists but has no dot is a campus nobody can get to — the same dead-end as the
   * dropdown that could not list them all, just harder to notice.
   */
  it('offers a dot for every AOI that is built', () => {
    const reachable = new Set(dots.map((d) => d.aoi).filter(Boolean));
    const unreachable = Object.keys(AOIS).filter((id) => !reachable.has(id));
    expect(unreachable).toEqual([]);
  });

  /**
   * ⚠️ THIS IS THE CITY-POINT BUG'S GUARD. A dot claiming `twin` precision has to sit inside the
   * box that twin actually renders — otherwise the map points at a town hall and the click loads a
   * campus somewhere else, which is worse than an approximate dot honestly labelled.
   */
  it('puts every twin dot inside the twin it opens', () => {
    const wrong: string[] = [];
    for (const dot of dots) {
      // A twin withheld by `config/release.json` has no bbox to be inside of. `NationalMap`
      // blanks those dots' `aoi` for the same reason, so this skip mirrors the app rather than
      // excusing it.
      if (dot.centreFrom !== 'twin' || !dot.aoi || !shipsAoi(dot.aoi)) continue;
      const box = AOIS[dot.aoi].bbox;
      const inside =
        dot.lon >= box.west && dot.lon <= box.east && dot.lat >= box.south && dot.lat <= box.north;
      if (!inside) wrong.push(`${dot.name} ${dot.lat},${dot.lon} outside ${dot.aoi}`);
    }
    expect(wrong).toEqual([]);
  });

  it('gives an approximate position a reason to be approximate', () => {
    // `city` means the matcher refused to confirm a campus. Such a dot must not also claim to
    // know how many campuses it has — that number comes from evidence it does not have.
    const contradictory = dots.filter((d) => d.centreFrom === 'city' && d.campusCount > 0);
    expect(contradictory.map((d) => d.name)).toEqual([]);
  });

  /**
   * ⚠️ TWO UNIVERSITIES ON ONE CAMPUS MEANS ONE OF THEM IS WRONG, and this is the failure mode of
   * searching the right city for the wrong institution. Universität Hohenheim is searched in
   * Stuttgart — which also contains Universität Stuttgart — so a matcher that leaned on "big
   * university area in Stuttgart" rather than on the token `hohenheim` would hand both dots the
   * same box and look entirely plausible on the map.
   *
   * Identical centres, not merely close ones: universities genuinely do sit near each other, and a
   * proximity threshold would fail on real neighbours. The same box to six decimal places is the
   * same match applied twice.
   */
  it('never puts two universities on exactly the same spot', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const dot of dots) {
      if (dot.centreFrom === 'city') continue; // town centres legitimately repeat within a city
      const at = `${dot.lat},${dot.lon}`;
      const already = seen.get(at);
      if (already) collisions.push(`${already} and ${dot.name} share ${at}`);
      else seen.set(at, dot.name);
    }
    expect(collisions).toEqual([]);
  });
});
