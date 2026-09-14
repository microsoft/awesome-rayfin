import { entity, role, uuid, text, boolean, date, int, decimal } from '@microsoft/rayfin-core';

/**
 * A sensor plan a planner committed — the network, the measured figures, and the caveats.
 *
 * 🔴 **Why this exists as a SQL entity rather than a file in OneLake.** The first writeback wrote a
 * JSON document plus a ledger line over the ADLS REST API, through the assistant container. That
 * works and it is honest, but it costs **seven sequential round trips** — three to write the
 * document, then a read and three more to rewrite the whole ledger to append one line — and the
 * container runs at min-replicas 0, so the first commit of a session also pays a cold start.
 * Measured: **0.91 s warm, 6.7 s after a restart, ~21 s from scale-to-zero.**
 *
 * This is **one mutation, straight from the browser to Fabric's SQL data plane**, with no container
 * in the path at all. Campus-Scheduler has used the same mechanism since 2026-08-03; the speed
 * difference is structural, not tuning.
 *
 * ⚠️ **The cost is a Fabric sign-in for writes — and this app already requires one.** `AuthGate`
 * refuses to render on any non-localhost host without an Entra session, so the identity the data
 * plane wants is already established before a plan can be placed, let alone committed. The old
 * design paid a container hop to avoid a requirement it was already imposing.
 *
 * ⚠️ `authorAsserted` keeps its name. The data layer refuses the write without a valid session, so
 * this is better than the string the browser used to send — but the column is still populated BY
 * THE CLIENT, not stamped from the token server-side. It is exactly as trustworthy as the session
 * is, and calling it `author` would imply a verification nobody performs.
 *
 * A plan is a SHARED artefact: every signed-in user can read and manage every committed plan. A
 * coastal surveillance plan is argued over by a team, and a per-user-private plan would be a worse
 * model of the job rather than a safer one.
 */
@entity()
@role('authenticated', '*')
export class SensorPlan {
  @uuid() id!: string;

  /** Stable, sortable, human-legible — `20260806T103440-5bd73`. Also the join key for the sites. */
  @text({ max: 64 }) planId!: string;

  /** Which coast this belongs to — `kieler-foerde` or `schlei`. One database serves both. */
  @text({ max: 64 }) aoi!: string;

  @text({ max: 200 }) planName!: string;
  @text({ max: 200 }) authorAsserted!: string;
  @date() committedUtc!: Date;

  /** Which question the plan answers: `maritime` or `counterUas`. */
  @text({ max: 32 }) scenario!: string;

  /** The recorded day the figures were measured against. */
  @text({ max: 32 }) trackDate!: string;

  @int() sites!: number;
  /**
   * 🔴 **Every decimal here carries an explicit scale, because the default truncates.**
   * `@decimal()` with no options maps to `DECIMAL(18,2)` on MSSQL. Measured by round-tripping the
   * real figures through the table: `observedShare` 0.8248 came back **0.82** and `visibleKm2`
   * 34.2164 came back **34.22** — while §13.12's verification asserts 34.2164 exactly. A writeback
   * that is fast and quietly rounds the numbers the product argues from is worse than a slow one.
   */
  @decimal({ precision: 10, scale: 2 }) mastMetres!: number;
  @decimal({ precision: 10, scale: 2 }) targetM!: number;

  /**
   * The traffic figures, on the ONE denominator the whole product uses.
   *
   * ⚠️ `transits` is passages that travelled ≥ `stationaryBelowKm`, NOT all passages — a moored
   * vessel transmits all day and the 20-minute gap rule splits that into several "passages".
   * `excludedStationary` carries the number left out so the denominator can never move silently.
   */
  @int() transits!: number;
  @int() observedTransits!: number;
  /** A share of 1, to six places — the annex quotes it to a tenth of a percentage point. */
  @decimal({ precision: 9, scale: 6 }) observedShare!: number;
  /** Square kilometres to four places; §13.12 pins 34.2164 exactly. */
  @decimal({ precision: 12, scale: 4 }) visibleKm2!: number;
  @int() worstCaseLossTransits!: number;
  @int() excludedStationary!: number;
  @decimal({ precision: 6, scale: 3 }) stationaryBelowKm!: number;

  /**
   * 🔴 The caveats travel with the figures, in the same row.
   *
   * A share read out of a database is further from its definition than one read on the app's own
   * screen, not closer. `includesVegetation` false means the blocking surface carried no measured
   * canopy, so the coverage is an **upper bound** and is not comparable with the rest.
   */
  @boolean() includesVegetation!: boolean;
  @boolean() geometryOnly!: boolean;

  /**
   * The annex model, verbatim, as JSON.
   *
   * 🔴 Stored whole and never re-derived. It is the same object the exported HTML annex renders
   * from, so a committed plan and a forwarded annex cannot describe one network differently — the
   * rule §13.5 established and §13.12 kept. The columns above are a queryable projection OF this,
   * not a second assembly of the same facts.
   *
   * ⚠️ **`@text()` with NO `max`, deliberately.** MSSQL caps a sized string at 4000 characters, and
   * a plan document is tens of kilobytes; asking for `max: 1000000` fails schema validation. Bare
   * `@text()` maps to `NVARCHAR(MAX)`. The failure is worth knowing about because of how it
   * presents: `rayfin up` still deploys the static app, prints "now deployed to Fabric!" and exits
   * 0, while the tables it needed are never created.
   */
  @text() report!: string;
}
