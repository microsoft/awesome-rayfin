import { expect, type Page } from '@playwright/test';

/**
 * The lecturer the teaching-load lens will actually SHOW, read from the file the lens reads.
 *
 * ⚠️ THIS EXISTS BECAUSE THREE SPECS NAMED A LECTURER OUT LOUD AND THE DATA MOVED UNDER THEM.
 * `IM-T029` was OTH's worst case at 36 of 18 SWS, and `MIS-T044` was "the one LMU lecturer over
 * contract". When the room stock was corrected — buildings with a published floor plan stopped
 * having storeys invented on top of them — the timetable re-placed, and both fell back inside
 * their contracts. The lens was working perfectly, naming the twelve people who ARE overloaded;
 * the tests failed because they were looking for two who no longer are.
 *
 * The panel only lists the notable cases (`staffing-over` and `staffing-idle`), so a link to an
 * unremarkable lecturer has no row to select — which is correct behaviour and an unusable fixture.
 * Deriving the subject keeps the assertions about BEHAVIOUR (a link selects the person it names)
 * instead of about which person happened to be worst on the day the test was written.
 */
export interface ListedLecturer {
  teacherId: string;
  name: string;
  contractSws: number;
  plannedSws: number;
}

export async function worstOverloaded(page: Page, aoiId: string): Promise<ListedLecturer> {
  const res = await page.request.get(`/terrain/${aoiId}/staffing.json`);
  expect(res.ok(), `${aoiId} does not serve the staffing model this lens reads`).toBeTruthy();
  const model = (await res.json()) as { teachers: ListedLecturer[] };

  const ranked = model.teachers
    .filter((t) => t.contractSws > 0 && t.plannedSws > t.contractSws)
    .sort((a, b) => b.plannedSws / b.contractSws - a.plannedSws / a.contractSws);

  expect(
    ranked.length,
    `no lecturer at ${aoiId} is over contract, so the overload list has nothing to show`
  ).toBeGreaterThan(0);
  return ranked[0];
}
