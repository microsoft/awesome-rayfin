import { entity, role, uuid, text, boolean, date, int } from '@microsoft/rayfin-core';

/**
 * A timetable change a planner saved — PLAN §7 and §13.7.
 *
 * ⚠️ THIS EXISTS BECAUSE NOTHING WAS BEING SAVED ANYWHERE. Confirmed drafts lived in a module-level
 * dict inside the solver container (`server/proposals.py::_drafts`), and that container scales to
 * zero — so a planner's confirmed work evaporated the moment the service went idle. It came back
 * looking like a fresh, unmodified plan, which is the worst way to lose work: silently, and
 * indistinguishably from never having done it.
 *
 * ⚠️ AND `confirmedBy` USED TO BE A STRING THE CLIENT CHOSE — literally `"Planer:in (UI)"`. That
 * makes an audit row worth nothing, as PLAN §15.1 says. This is better but NOT yet what §15.1
 * asks for, and the difference matters: the data layer refuses the write outright without a valid
 * Fabric session, and `savedBy` carries the identity on that session rather than a typed-in
 * label — but the column is still populated BY THE CLIENT. It is therefore as trustworthy as the
 * session is, and not a server-stamped audit field. Making it one needs the backend to derive it
 * from the token, which is §15.1's Entra work.
 *
 * The plan is a SHARED artefact, so every signed-in planner can read and manage every saved change
 * rather than only their own. A timetabling office works on one timetable together, and a
 * per-user-private draft would be a worse model of the job, not a safer one. `savedBy` records who,
 * so shared does not mean anonymous.
 */
@entity()
@role('authenticated', '*')
export class PlanChange {
  @uuid() id!: string;

  /** Which university this belongs to — `oth` or `lmu`. One database serves both. */
  @text({ max: 16 }) site!: string;

  /** The session being moved, and enough of it to render the change without the solver. */
  @text({ max: 64 }) sessionId!: string;
  @text({ max: 200 }) course!: string;

  @text({ max: 32 }) fromSlotId!: string;
  @text({ max: 32 }) toSlotId!: string;
  @text({ max: 64 }) roomId!: string;

  /**
   * What the checker said at the moment it was saved, and why.
   *
   * ⚠️ STORED, NOT RECOMPUTED ON READ. A move that was legal when it was made can be made illegal
   * later by somebody else's change, and quietly re-labelling it would erase the fact that it was
   * checked. Keeping the verdict as it stood makes the disagreement visible instead.
   */
  @boolean() legal!: boolean;
  @text({ max: 500, optional: true }) verdict?: string;

  /** How many hard conflicts the checker attributed to this move when it was saved. */
  @int() conflictCount!: number;

  /** The verified identity of whoever saved it, and when. */
  @text({ max: 200 }) savedBy!: string;
  @date() savedAt!: Date;
}
