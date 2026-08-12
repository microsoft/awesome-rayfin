import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * WHEN A LECTURER CAN TEACH — one row per (university, lecturer, slot) they have said something about.
 *
 * ⚠️ ONLY THE DEVIATIONS ARE STORED. The dataset's own `availability` table carries a row for every
 * lecturer in every slot (2 800 rows for OTH's 80 people alone), and nearly all of them say
 * "verfügbar" — the default. Copying that here would put thousands of rows in a database to record
 * that nothing was decided. A row exists in THIS table only where somebody stated an intent, so
 * the table answers "what have we been told" rather than "what is the default", and the absence of
 * a row is the honest representation of nobody having said anything.
 *
 * ⚠️ THIS IS NOT PART OF THE PLAN, AND MUST NOT BE STORED AS IF IT WERE. `PlanAssignment` says
 * where a session sits; this says what the plan is JUDGED AGAINST. Blocking a Monday does not move
 * a lecture — it makes the existing one illegal, and repairing that is a separate, confirmed act.
 * Mixing the two would make "I cannot teach Mondays" look like a change to the timetable, which is
 * exactly the confusion the product exists to remove.
 *
 * ⚠️ `id` IS DERIVED from site + teacherId + slotId, not random, for the same reason
 * `PlanAssignment`'s is: a lecturer who changes their mind three times about Tuesday must leave one
 * row, not three. Who last said so is `updatedBy`/`updatedAt`.
 */
@entity()
@role('authenticated', '*')
export class TeacherAvailability {
  /** Deterministic: a UUID derived from `${site}:${teacherId}:${slotId}`. */
  @uuid() id!: string;

  /** Which university this belongs to — `oth`, `lmu` or `tum`. One database serves all. */
  @text({ max: 16 }) site!: string;

  /**
   * The lecturer's id in the dataset, e.g. `IM-T021`.
   *
   * ⚠️ Deliberately NOT the person's name. The name is display text that the dataset owns and can
   * change; the id is what the solver keys on. Storing the name here would create a second,
   * drifting copy of it in a table nobody would think to update.
   */
  @text({ max: 64 }) teacherId!: string;

  /** Which slot in the week, e.g. `Mo-2`. */
  @text({ max: 32 }) slotId!: string;

  /**
   * `verfuegbar` — can teach. `eingeschraenkt` — possible, but only if there is no alternative.
   * `nicht_verfuegbar` — cannot teach.
   *
   * ⚠️ The dataset's own spelling, not a display string. These values are compared against
   * `availability.json` by the solver; translating them here would mean translating them back.
   */
  @text({ max: 24 }) state!: string;

  /**
   * How we came to believe it: `ui` (edited in the cockpit) or `import` (an uploaded spreadsheet).
   *
   * ⚠️ Worth a column because the two carry different weight. A planner clicking a cell was looking
   * at that lecturer's week; a spreadsheet row may have been filled in by somebody else months ago
   * and forwarded. When the two disagree, knowing which is which is the whole argument.
   */
  @text({ max: 16 }) source!: string;

  /** Free text from the person: "Gremiensitzung", "Lehrauftrag extern". Optional, never parsed. */
  @text({ max: 200 }) note?: string;

  @text({ max: 200 }) updatedBy!: string;
  @date() updatedAt!: Date;
}
