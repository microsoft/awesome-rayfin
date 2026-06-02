import {
  entity,
  role,
  uuid,
  text,
  boolean,
  int,
  decimal,
  date,
} from '@microsoft/rayfin-core';

/**
 * One row per completed Jump & Run play-through.
 *
 * Mirrors the JSON payload the game emits from `stats.toJSON()` in
 * `public/game/ibcs_trainer.html`. Each record is associated with the
 * signed-in player via `user_id` (populated from the JWT `sub` claim), so a
 * player only ever sees their own runs.
 */
@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class GameStats {
  @uuid() id!: string;

  @text() player_name!: string;
  @int() score!: number;
  @boolean() won!: boolean;
  @int() lives_left!: number;
  @decimal() duration_seconds!: number;

  @int() deaths_total!: number;
  @int() deaths_enemy!: number;
  @int() deaths_water!: number;
  @int() deaths_fall!: number;
  @int() deaths_lava!: number;

  @int() coins_collected!: number;
  @int() enemies_stomped!: number;
  @int() enemies_zapped!: number;
  @int() bosses_killed!: number;
  @int() attacks_used!: number;
  @int() jumps!: number;

  @text({ optional: true }) forms_collected?: string;
  @text() final_form!: string;
  @int() max_x_reached!: number;
  @int() level_reached!: number;

  @date() playedAt!: Date;

  // Player association via user_id populated from JWT claims.
  @text() user_id!: string;
}
