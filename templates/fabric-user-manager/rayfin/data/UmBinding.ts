import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * What an activated group gives access to: the second hop.
 *
 * Stored for activated groups only, because owners need the bindings in
 * every preview and usually cannot read the workspace themselves. The full
 * discovery result stays in the admin's browser session.
 *
 * `provenance` is `read` (seen through a platform API) or `attested` (an
 * admin recorded it for a guided step). Attested is never shown as verified.
 *
 * Deletable, because a binding that no longer exists must be removable.
 *
 * That also means any signed-in user who bypasses the UI can delete or forge
 * a row here. A forged or missing Member or Admin binding would make the app
 * treat such a group like an ordinary one (the admin-only rule for those roles
 * is advisory for exactly this reason). Entra and Fabric still decide every real change.
 */
@entity()
@role('authenticated', ['create', 'read', 'update', 'delete'])
export class UmBinding {
  @uuid() id!: string;

  @text({ max: 36 }) group_id!: string;

  /** Workspace | Audience | ModelRole */
  @text({ max: 16 }) target_kind!: string;

  @text({ max: 36, optional: true }) scope_id?: string;
  @text({ max: 256 }) scope_name!: string;

  /** Workspace role, audience name or model role name. */
  @text({ max: 256 }) label!: string;

  /** read | attested */
  @text({ max: 16 }) provenance!: string;

  @text({ max: 256 }) recorded_by_upn!: string;
  @date() recorded_at!: Date;
}
