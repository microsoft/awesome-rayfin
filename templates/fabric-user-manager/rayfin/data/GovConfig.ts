import { entity, role, uuid, text, date, boolean } from '@microsoft/rayfin-core';

/**
 * The app's settings, one row per key, values stored as JSON text
 * (read and written by `src/um/services/configStore.ts`).
 *
 * Keys in use: `um.changes.members`, `um.changes.bindings`, `um.changes.groups`
 * (the three change switches in Setup) and `guidelines.answers` (the questionnaire).
 * Nothing secret is ever stored here. The table name comes from the Governance Hub
 * this app grew out of.
 */
@entity()
@role('authenticated', '*')
export class GovConfig {
  @uuid() id!: string;

  /** Dotted config key, unique per deployment. */
  @text() config_key!: string;

  /** JSON-encoded value. Scalars are encoded too (`"true"`, `"\"en\""`). */
  @text() config_value!: string;

  /** Free-text note explaining why this value was set (audit aid). */
  @text({ optional: true }) note?: string;

  /** False for keys the app manages itself and users should not hand-edit. */
  @boolean() user_editable!: boolean;

  @text() updated_by!: string;
  @date() updated_at!: Date;
}
