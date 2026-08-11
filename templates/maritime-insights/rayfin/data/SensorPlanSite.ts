import { entity, role, uuid, text, int, decimal } from '@microsoft/rayfin-core';

/**
 * One mast in a committed plan.
 *
 * 🔴 **A separate table, for the same reason Campus-Scheduler splits state from history.** The
 * whole plan is already stored as JSON on `SensorPlan.report`, so this is duplication — and it is
 * duplication with a purpose: a JSON blob is unqueryable. "How many masts have we planned across
 * every site, and how tall" has to be answerable from a SQL editor, a notebook or Power BI without
 * anyone parsing a document first. The projection is derived from the same commit in the same
 * transaction, so it cannot drift from the blob it summarises.
 *
 * ⚠️ **`gridCol`/`gridRow` are the restore key, not the coordinates.** A site is restored from the
 * solver's own grid cell, never from lat/lon: rebuilding a cell from a rounded coordinate moves the
 * mast by up to half a cell, and every figure follows from where the mast is. Verified in §13.12 —
 * restore reproduces 34.2164 km² and 113 transits exactly. The coordinates are here because they
 * are what a map needs; they are not what a reload uses.
 */
@entity()
@role('authenticated', '*')
export class SensorPlanSite {
  @uuid() id!: string;

  /** Joins to `SensorPlan.planId`. */
  @text({ max: 64 }) planId!: string;
  @text({ max: 64 }) aoi!: string;

  /** Position within the plan, 0-based — the order the panel lists them in. */
  @int() siteIndex!: number;

  /**
   * 🔴 **Seven decimal places, and this is the field that forced the rule.** `@decimal()` defaults
   * to `DECIMAL(18,2)` on MSSQL, which stores 54.3831 as **54.38** — an error of about 450 m at
   * this latitude. A mast plotted half a kilometre from where it was planned is not a rounding
   * problem, it is a different plan. Seven places is ~1 cm, comfortably finer than the 16 m LOS
   * cell the position came from.
   */
  @decimal({ precision: 10, scale: 7 }) lat!: number;
  @decimal({ precision: 10, scale: 7 }) lon!: number;

  /** The LOS grid cell. This is what a restore reads; see the class note. */
  @int() gridCol!: number;
  @int() gridRow!: number;

  @decimal({ precision: 8, scale: 2 }) mastM!: number;
  @decimal({ precision: 8, scale: 2 }) groundM!: number;
  /** Ground plus mast — the height the viewshed was actually solved from. */
  @decimal({ precision: 8, scale: 2 }) eyeM!: number;
  @decimal({ precision: 8, scale: 3 }) horizonKm!: number;

  /**
   * What this mast alone observed, and what only it observed.
   *
   * 🔴 `uniquePassages` is the number that matters and the one a combined percentage hides. §13.4
   * measured a three-site network whose exclusive contributions were 6 / 38 / **0** — the third
   * mast could be struck out without moving the headline at all. A plan table that stored only the
   * total would make that undiscoverable.
   */
  @int() observedPassages!: number;
  @int() uniquePassages!: number;
}
