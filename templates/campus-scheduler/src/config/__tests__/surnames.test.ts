import { describe, expect, it } from 'vitest';

import lmu from '@config/academic/lmu.json';
import oth from '@config/academic/oth.json';

/**
 * The two universities' lecturer name pools.
 *
 * ⚠️ THIS EXISTS BECAUSE BOTH PROPERTIES FAILED AT ONCE AND NOTHING NOTICED.
 *
 * LMU's pool held 82 names for 102 teaching posts, and the generator indexed it with
 * `pool[i % len(pool)]` — so twenty professors ended up sharing a full name with a colleague in a
 * different faculty, and both halves carried real teaching. `find_teacher` resolves a lecturer by
 * SURNAME, and both the assistant and `/api/calendar?scope=teacher` go through it, so asking about
 * "Lengfelder" returned one of the two and reported the other's workload with total confidence.
 * Separately, `Oberländer` sat in both universities' pools, so one professor appeared to work at
 * Regensburg and Munich at once.
 *
 * The generator now refuses to build rather than wrap. This checks the other half: that the
 * profiles it is given can actually satisfy it, and that the two universities stay strangers.
 */

interface Profile {
  surnames: string[];
  faculties: { id: string; teachers: number }[];
}

const profiles: [string, Profile][] = [
  ['OTH Regensburg', oth as unknown as Profile],
  ['LMU München', lmu as unknown as Profile],
];

describe('lecturer surname pools', () => {
  it.each(profiles)('%s has a distinct name for every teaching post', (_label, profile) => {
    const needed = profile.faculties.reduce((sum, f) => sum + f.teachers, 0);
    const unique = new Set(profile.surnames);
    expect(unique.size).toBe(profile.surnames.length); // no accidental repeats in the list itself
    expect(unique.size).toBeGreaterThanOrEqual(needed);
  });

  it('gives the two universities entirely different staff', () => {
    const shared = (oth as unknown as Profile).surnames.filter((name) =>
      new Set((lmu as unknown as Profile).surnames).has(name)
    );
    expect(shared).toEqual([]);
  });

  it('keeps each pool recognisably its own region', () => {
    // Not a correctness property, but the reason the pools are separate at all: a second
    // university staffed from the first one's list is a tell that nothing behind the names
    // differs either. A handful of Munich-flavoured names should not appear in the Oberpfalz one.
    const othNames = new Set((oth as unknown as Profile).surnames);
    for (const munich of ['Sendlinger', 'Pasinger', 'Nymphenburger', 'Giesinger']) {
      expect(othNames.has(munich)).toBe(false);
    }
  });
});
