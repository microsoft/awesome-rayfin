import { entity, role, uuid, text, int, date } from '@microsoft/rayfin-core';

/**
 * Persisted DOOM save game — one row per player per save slot.
 *
 * DOOM runs inside DOSBox on an in-memory (MEMFS) filesystem, so its native
 * save files (DOOMSAV*.DSG) are lost on every page reload. This entity mirrors
 * those files to the backend: the raw .DSG bytes (base64) are read out of the
 * emulator FS after a save and written back into it on the next boot, so saves
 * survive reloads and follow the player across devices (see game/doomSaves.ts).
 *
 * Private per player: create + read + mutate are all scoped to the owner.
 */
@entity()
@role('authenticated', ['create'])
@role('authenticated', ['read', 'update', 'delete'], {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class DoomSave {
  @uuid() id!: string;

  // Player association via user_id populated from JWT claims.
  @text({ max: 200 }) user_id!: string;

  // DOOM save slot (0-5) and the slot description shown in the menu.
  @int() slot!: number;
  @text({ max: 100 }) name!: string;

  // Emulator FS path the .DSG was read from / must be restored to.
  @text({ max: 400 }) path!: string;

  // Raw .DSG file bytes, base64-encoded. Unbounded (nvarchar(max)).
  @text() data!: string;

  @date() updated_at!: Date;
}
