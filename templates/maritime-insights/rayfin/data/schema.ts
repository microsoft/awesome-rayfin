// ⚠️ The `.js` extension is REQUIRED and is not a typo. `rayfin/tsconfig.json` resolves modules as
// nodenext, so an extensionless relative import fails compilation with TS2835 — and the way that
// failure presents is the dangerous part: `rayfin up` deploys the static app, prints "now deployed
// to Fabric!", exits 0, and only a line buried in its log says the database configuration failed.
// The app ships, the tables do not exist, and every commit fails at runtime. Read the deploy log.
import { SensorPlan } from './SensorPlan.js';
import { SensorPlanSite } from './SensorPlanSite.js';

/**
 * The entities Rayfin provisions and exposes.
 *
 * TWO tables, and the split is between a DOCUMENT and a PROJECTION.
 *
 * `SensorPlan` is one row per committed plan, carrying the headline figures, the caveats that
 * qualify them, and the whole annex model as JSON. `SensorPlanSite` is one row per mast — the same
 * facts the JSON already holds, in the shape a query can reach.
 *
 * 🔴 The duplication is deliberate and is the same call Campus-Scheduler's schema documents: a
 * store that keeps only the document makes the plan unqueryable, so every reader outside the app —
 * Power BI, a Data Agent, anyone with a SQL editor — would see a blob and never a network. Both
 * are written from one commit, so they cannot disagree.
 */
export type AppSchema = {
  SensorPlan: typeof SensorPlan;
  SensorPlanSite: typeof SensorPlanSite;
};

export const schema: AppSchema = { SensorPlan, SensorPlanSite };
