import { entity, role, uuid, text, date, boolean, int } from '@microsoft/rayfin-core';

/**
 * A group that app admins activated for owner management.
 *
 * Owners are never stored: they are the group's owners in Entra, read live.
 * Member lists are never stored either.
 *
 * Row policy: create, read and update only. A group is deactivated, not
 * deleted, so its history stays readable. Who may write is NOT enforced here:
 * Rayfin policies compare a field with a claim of the caller and cannot
 * express "is a member of the admin group". The admin
 * check is in the browser, and Entra decides every real change.
 */
@entity()
@role('authenticated', ['create', 'read', 'update'])
export class UmManagedGroup {
  @uuid() id!: string;

  /** Entra object id. The only identifier the app acts on. One row per group. */
  @text({ max: 36, unique: true }) group_id!: string;

  /** Name read from Graph at activation. Informational. */
  @text({ max: 256 }) name_snapshot!: string;

  @boolean() requestable!: boolean;
  @text({ max: 1000, optional: true }) description?: string;

  /** Upper limit for a review date in days. 0 means none. */
  @int() max_days!: number;

  @boolean() active!: boolean;

  /** Incremented on every change, so a request can detect an edited row. */
  @int() version!: number;

  @text({ max: 36 }) activated_by_oid!: string;
  @text({ max: 256 }) activated_by_upn!: string;
  @date() activated_at!: Date;
  @date() updated_at!: Date;

  /** Editable fields and attested bindings before the last import, as JSON. */
  @text({ max: 4000, optional: true }) previous_json?: string;
  @text({ max: 36, optional: true }) import_id?: string;
}
