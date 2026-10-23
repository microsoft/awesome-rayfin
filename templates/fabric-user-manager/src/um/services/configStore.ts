/**
 * Settings of this app: one key/value table (GovConfig), values stored as JSON text.
 *
 * Keys in use: the three change switches (`um.changes.members`, `um.changes.bindings`,
 * `um.changes.groups`) and the guideline answers (`guidelines.answers`). The table is writable by any
 * signed-in user, so a setting decides what is shown or offered, never what is allowed: Entra and
 * Fabric decide that.
 */
import { getRayfinClient } from '@/services/rayfinClient';

interface ConfigRow {
  id: string;
  config_key: string;
  config_value: string;
}

/** The part of the data client's query builder that a read with named fields needs. */
interface FieldQuery {
  where(conditions: Record<string, unknown>): FieldQuery;
  first(count: number): FieldQuery;
  execute(): Promise<unknown>;
}

/**
 * One stored value, or `undefined` when unset or unreachable.
 *
 * The fields are named on purpose. The data client's `findMany` returns only
 * the `id` of each row unless told otherwise, so a read through it finds the
 * row and then has no value to give (seen live on 2026-10-12: every stored
 * switch read as "not set", although it had been saved).
 */
export async function loadConfigValue(key: string): Promise<unknown> {
  try {
    const table = getRayfinClient().data.GovConfig as unknown as { select(fields: readonly string[]): FieldQuery };
    const rows = (await table
      .select(['id', 'config_key', 'config_value'])
      .where({ config_key: { eq: key } })
      .first(5)
      .execute()) as ConfigRow[];
    // The answer must be about the key that was asked for, and carry a value.
    const row = rows.find((r) => r.config_key === key);
    if (!row) return undefined;
    // The data client turns the stored texts "true" and "false" into booleans
    // before it hands a row over (seen live on 2026-10-12). Everything else
    // arrives as the JSON text that was stored.
    const value: unknown = row.config_value;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The value, or `undefined` when it does not arrive in time. Seen live on
 * 2026-10-10: after hours without use the app once stayed on "loading". The
 * cause was not established; a slow first answer of the database is the
 * likely one, and this wait was the one place without a limit that depends
 * on it. What is shown must not wait for that.
 */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

export async function saveConfigValue(key: string, value: unknown, updatedBy: string): Promise<boolean> {
  try {
    const data = getRayfinClient().data.GovConfig;
    const rows = (await data.findMany({ config_key: { eq: key } } as never)) as unknown as ConfigRow[];
    const config_value = JSON.stringify(value);
    if (rows.length > 0) {
      await data.update({ id: rows[0].id }, { config_value, updated_by: updatedBy, updated_at: new Date() } as never);
    } else {
      await data.create({
        config_key: key,
        config_value,
        user_editable: true,
        updated_by: updatedBy,
        updated_at: new Date(),
      } as never);
    }
    return true;
  } catch {
    return false;
  }
}
