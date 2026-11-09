import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * The app's own log.
 *
 * Append-only at the API: create and read, no update, no delete.
 *
 * Advisory. Entries are written from the browser, so a person who bypasses
 * the UI can omit or forge one. The authoritative records of changes are the
 * Entra and Fabric audit logs.
 */
@entity()
@role('authenticated', ['create', 'read'])
export class UmAudit {
  @uuid() id!: string;

  @date() at!: Date;

  /** Entra object id from Graph `/me`, never the app session. */
  @text({ max: 36 }) actor_oid!: string;
  @text({ max: 256 }) actor_upn!: string;

  /** e.g. activate | deactivate | edit | import | rollback | bindings */
  @text({ max: 32 }) action!: string;

  @text({ max: 36, optional: true }) group_id?: string;

  /** ok | refused | failed */
  @text({ max: 16 }) outcome!: string;

  /** Before and after, as JSON. Bounded; no member lists. */
  @text({ max: 4000, optional: true }) detail?: string;
}
