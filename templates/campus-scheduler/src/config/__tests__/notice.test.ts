import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AOIS } from '@/config/aoi';

const NOTICE = readFileSync(resolve(process.cwd(), 'NOTICE.md'), 'utf-8');

/**
 * Attribution, checked against the sites that actually ship.
 *
 * ⚠️ THIS EXISTS BECAUSE THE CREDIT HAS BEEN WRONG THREE TIMES, always in the same shape: a
 * survey authority written down once, while the number of AOIs kept going up.
 *
 *  - `build_lod2_mesh.py` hard-coded the **Bavarian** LDBV notice and stamped it on Tübingen,
 *    which is Baden-Württemberg's LGL.
 *  - NOTICE.md described itself as belonging to a different product entirely (`Campus-Insights`),
 *    left over from the fork.
 *  - NOTICE.md credited two state surveys while the app shipped **four** — Aachen, Köln and
 *    Münster arrived from Geobasis NRW and nothing said so.
 *
 * Every one of those was invisible from the code and visible on the screen. The fix is not to
 * write the list down more carefully; it is to stop writing it down twice. `AOIS` is the shipped
 * registry after `config/release.json` has been applied, so a site that is withheld is not
 * required here, and a site that is added is.
 */
describe('NOTICE.md credits every survey the app actually uses', () => {
  const shipped = Object.entries(AOIS);

  it('has some sites to check', () => {
    // Guard against the vacuous pass: an empty registry would satisfy every `for` below.
    expect(shipped.length).toBeGreaterThan(0);
  });

  it.each(shipped)('%s: its core geobasis attribution appears verbatim', (_id, aoi) => {
    // Verbatim, not "mentions the authority". The attribution string is prescribed by the
    // licence — LGL's is `Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0` and a paraphrase of it
    // is not the notice the licence asks for.
    expect(NOTICE).toContain(aoi.geobasis.attribution);
  });

  it.each(shipped)('%s: its horizon-shell attribution appears verbatim', (_id, aoi) => {
    expect(NOTICE).toContain(aoi.shellGeobasis.attribution);
  });

  it.each(shipped)('%s: the site is named, so a reader can tell which credit is theirs', (id) => {
    // A notice that lists four authorities without saying which place came from which is
    // technically complete and practically useless — and it is how Tübingen ended up under the
    // Bavarian credit without anyone noticing.
    expect(NOTICE).toContain(id);
  });

  it('does not credit the app under the name of the project it was forked from', () => {
    expect(NOTICE).not.toContain('Campus-Insights renders');
  });
});
