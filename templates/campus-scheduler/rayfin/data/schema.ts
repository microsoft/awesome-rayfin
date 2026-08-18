// ⚠️ The `.js` extension is REQUIRED and is not a typo. `rayfin/tsconfig.json` resolves modules as
// nodenext, so an extensionless relative import fails compilation with TS2835 — and the way that
// failure presents is the dangerous part: `rayfin up` deploys the static app, prints "now deployed
// to Fabric!", exits 0, and only a line buried in its log says the database configuration failed.
// The app ships, the table does not exist, and every save fails at runtime. Read the deploy log.
import { PlanChange } from './PlanChange.js';
import { PlanAssignment } from './PlanAssignment.js';
import { TeacherAvailability } from './TeacherAvailability.js';

/**
 * The entities Rayfin provisions and exposes — PLAN §13.7.
 *
 * TWO tables, and the split is between a STATE and a HISTORY.
 *
 * `PlanAssignment` is where every session currently sits — the whole timetable, one row each.
 * `PlanChange` is the record of who moved what, and when.
 *
 * ⚠️ THIS FILE PREVIOUSLY ARGUED FOR ONE TABLE, and the argument was about the wrong property. It
 * said copying ~980 reproducible rows into SQL would add a second source of truth to keep in step
 * — true, and the right call if the only goal is surviving a redeploy, because the decisions are
 * the part that cannot be regenerated. But it makes the plan unqueryable: answering "what is the
 * timetable now" from a change log means replaying it, so every reader outside the app — Power BI,
 * a Data Agent, anyone with a SQL editor — could see the edits and never the plan.
 *
 * The requirement is that no assignment exists only inside the app. So the state is stored too,
 * and the duplication it creates is handled explicitly rather than avoided: `PlanAssignment.source`
 * says whether a row came from the baked baseline or from a planner, which is exactly the
 * distinction "a second source of truth" would otherwise blur.
 *
 * `TeacherAvailability` is the third, and it is neither of those two things. It records what the
 * plan is JUDGED AGAINST — when each lecturer can teach — and it stores only the slots somebody
 * has actually stated an intent about, so an absent row means "nobody has said", not "available".
 */
export type AppSchema = {
  PlanChange: typeof PlanChange;
  PlanAssignment: typeof PlanAssignment;
  TeacherAvailability: typeof TeacherAvailability;
};

export const schema: AppSchema = { PlanChange, PlanAssignment, TeacherAvailability };
