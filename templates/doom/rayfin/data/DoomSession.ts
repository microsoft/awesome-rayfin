import { entity, role, uuid, text, int, boolean, date } from '@microsoft/rayfin-core';

/**
 * One row per Doom play session.
 *
 * DOOM runs inside DOSBox (js-dos), a black-box emulator that does not expose
 * the game's internal score to JavaScript — so instead of an in-game score we
 * record the *session*: who played, when, and for how long. `booted` is true
 * once DOOM.EXE actually starts (the player clicked "Click to start").
 *
 * Shared leaderboard: every authenticated user can read all rows, but a row
 * can only be updated/deleted by the player who created it.
 */
@entity()
@role('authenticated', ['read', 'create'])
@role('authenticated', ['update', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class DoomSession {
  @uuid() id!: string;

  @text({ max: 100 }) player_name!: string;
  @int() duration_seconds!: number;
  @boolean() booted!: boolean;

  @date() started_at!: Date;
  @date() ended_at!: Date;

  // Player association via user_id populated from JWT claims.
  @text({ max: 200 }) user_id!: string;
}
