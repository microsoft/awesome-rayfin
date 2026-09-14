import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `?scheduler=` must not be bypassed.
 *
 * One campus can be shown on either its generated or its real timetable (§25), and `activeAoi()`
 * is what applies that choice. `AOIS[id]` returns the CONFIGURED site and knows nothing about the
 * override — so any component reading it directly quietly talks to the other university's data.
 *
 * That is not hypothetical. `CalendarPanel` did exactly this: on `?scheduler=oth` it asked the
 * `oth-real` backend for teacher `M-T029`, an id that only exists on the generated site. The
 * backend answered `teacher_not_found`, the availability view arrived without a `teacherId`, and
 * "Vorlage für diese Person" silently became a 414-lecturer workbook.
 *
 * ⚠️ A SOURCE SCAN, because the fault is invisible to a rendering test: both sites answer, both
 * return valid JSON, and the only symptom is that the answer belongs to somebody else. This repo
 * already uses source comparison for the same reason in `planStore.test.ts`.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe('the scheduler-site override', () => {
  it('is never bypassed by reading the AOI registry directly', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      // `config/aoi.ts` is where the registry LIVES and where the override is applied.
      if (file.replace(/\\/g, '/').endsWith('src/config/aoi.ts')) continue;
      const text = readFileSync(file, 'utf8');
      // `AOIS[...]` followed by `.schedulerSite` — the exact shape that skips the override.
      if (/AOIS\s*\[[^\]]+\]\s*\??\.\s*schedulerSite/.test(text)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      'read the site from activeAoi(), which applies ?scheduler=; AOIS[id] does not'
    ).toEqual([]);
  });
});
