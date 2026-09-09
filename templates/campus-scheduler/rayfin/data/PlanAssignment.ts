import { entity, role, uuid, text, boolean, date } from '@microsoft/rayfin-core';

/**
 * WHERE EVERY SESSION CURRENTLY SITS — one row per session, per university.
 *
 * ⚠️ THIS REVERSES AN EARLIER DECISION, DELIBERATELY. `schema.ts` used to argue that only the
 * DECISION needed persisting, because the plan itself is rebuilt from the dataset baked into the
 * solver image and copying ~980 reproducible rows into SQL would create a second source of truth
 * to keep in step. That reasoning is sound for durability and wrong for QUERYABILITY: a delta log
 * cannot answer "what is the timetable now" without replaying it, so anything reading the database
 * — Power BI, a Data Agent, a colleague with a SQL editor — saw changes and never the plan.
 *
 * The requirement is that no assignment exists only inside the app. So the whole plan lives here,
 * and `PlanChange` remains what it always was: the audit trail of who moved what, and when.
 *
 * ⚠️ THE SECOND SOURCE OF TRUTH IS REAL AND IS MANAGED, NOT WISHED AWAY. Two writers touch this
 * table — a seeding tool that loads the baked baseline, and the app when a planner confirms a move
 * — so `source` records which one put the row there and `updatedAt` says when. A row that says
 * `baseline` is reproducible from the image; a row that says `change` is not, and is the one that
 * would actually be lost.
 *
 * ⚠️ `id` IS DERIVED FROM site + sessionId, NOT RANDOM. That is what makes the write an UPSERT
 * rather than an append: a session moved three times must leave one row saying where it is, not
 * three rows requiring the reader to work out which is current. The history is `PlanChange`'s job.
 */
@entity()
@role('authenticated', '*')
export class PlanAssignment {
  /** Deterministic: a UUID derived from `${site}:${sessionId}` — see the note above. */
  @uuid() id!: string;

  /** Which university this belongs to — `oth` or `lmu`. One database serves both. */
  @text({ max: 16 }) site!: string;

  @text({ max: 64 }) sessionId!: string;
  @text({ max: 64 }) courseId!: string;
  @text({ max: 200 }) course!: string;

  /** Who teaches it and who attends — the two axes a timetable is queried along. */
  @text({ max: 64 }) teacherId!: string;
  @text({ max: 64 }) cohortId!: string;

  /** Where and when it currently sits. */
  @text({ max: 32 }) slotId!: string;
  @text({ max: 64 }) roomId!: string;
  @text({ max: 64 }) buildingId!: string;
  @text({ max: 64 }) campusId!: string;

  /** Pinned by the timetabling office, so the solver may not move it. */
  @boolean() frozen!: boolean;

  /**
   * `baseline` — loaded from the dataset baked into the solver image, and reproducible from it.
   * `change` — a planner moved it here, and this row is the only record of the current position.
   */
  @text({ max: 16 }) source!: string;

  @text({ max: 200 }) updatedBy!: string;
  @date() updatedAt!: Date;
}
