import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * Where to send the notice that someone requested an activated group.
 *
 * A requester often cannot read a group's owners, so the owners' mail
 * addresses are kept here, refreshed whenever an app admin or owner reads
 * them live. They are a fallback for the notice only: when the requester can
 * read the owners, those are used. Every signed-in user can write this
 * table, so of the stored addresses only those in the requester's own mail
 * domain are ever written to. Who may approve is always decided from the
 * live owners in Entra, never from this table.
 */
@entity()
@role('authenticated', ['create', 'read', 'update'])
export class UmGroupContact {
  @uuid() id!: string;

  @text({ max: 36, unique: true }) group_id!: string;

  /** Mail addresses separated by `;`. At most ten are used. */
  @text({ max: 1000 }) mails!: string;

  @text({ max: 256 }) updated_by_upn!: string;
  @date() updated_at!: Date;
}
