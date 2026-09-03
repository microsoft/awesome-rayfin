import { entity, role, uuid, text, int, date } from '@microsoft/rayfin-core';

/**
 * One row per completed DOOM level.
 *
 * DOSBox doesn't expose DOOM's internal counters, so these stats are read off
 * the game's own "level FINISHED" intermission screen (see src/game/doomStats.ts)
 * and recorded here. Together with DoomSession (playtime), this powers a richer
 * leaderboard: farthest level reached, kills, and total playtime.
 *
 * Shared leaderboard: every authenticated user can read all rows, but a row can
 * only be updated/deleted by the player who created it.
 */
@entity()
@role('authenticated', ['read', 'create'])
@role('authenticated', ['update', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class DoomLevelResult {
  @uuid() id!: string;

  @text({ max: 100 }) player_name!: string;

  // Which level was completed (episode 1 for shareware; map 1-9).
  @int() episode!: number;
  @int() map!: number;

  // Per-level completion stats, read from the FINISHED screen (0-100).
  @int() kills_pct!: number;
  @int() items_pct!: number;
  @int() secrets_pct!: number;

  // Level completion time in seconds (-1 if it couldn't be read).
  @int() time_seconds!: number;

  @date() completed_at!: Date;

  // Player association via user_id populated from JWT claims.
  @text({ max: 200 }) user_id!: string;
}
