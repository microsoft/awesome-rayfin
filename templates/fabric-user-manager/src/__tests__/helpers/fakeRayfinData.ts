/**
 * A data client for tests that behaves like the real Rayfin one where it
 * matters. The real client surprised twice in production (2026-10-12):
 *
 * - a plain `findMany` or `findById` answers with the id alone,
 * - a write answers with the fields that were written, not the whole row,
 * - on the way out, the texts "true" and "false" become booleans and texts
 *   shaped like an ISO date become `Date` objects, in any field.
 *
 * An in-memory store or a mocked `findMany` that returns whole rows cannot
 * show a mistake of that kind. This fake keeps all three behaviours.
 */
export type FakeRow = Record<string, unknown> & { id: string };
type Where = Record<string, { eq: unknown }> | undefined;

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
const sniff = (value: unknown) => (value === 'true' ? true : value === 'false' ? false : typeof value === 'string' && ISO.test(value) ? new Date(value) : value);

export function createFakeData() {
  const tables: Record<string, FakeRow[]> = {};
  let counter = 0;
  /** Set to make every read and write fail, like an unreachable backend. */
  const state = { unreachable: false };
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const check = () => {
    if (state.unreachable) throw new Error('ECONNREFUSED');
  };
  const matches = (row: FakeRow, where: Where) => !where || Object.entries(where).every(([field, cond]) => row[field] === cond.eq);
  const only = (row: FakeRow, fields: readonly string[]) => Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, sniff(row[f])]));

  const entity = (name: string) => {
    const rows = () => (tables[name] ??= []);
    const query = (fields: readonly string[]) => {
      let where: Where;
      const q = {
        where(conditions: Where) {
          where = conditions;
          return q;
        },
        orderBy: () => q,
        first: () => q,
        after: () => q,
        execute: async () => {
          check();
          return rows().filter((r) => matches(r, where)).map((r) => only(r, fields));
        },
        executePaginated: async () => {
          check();
          return { items: rows().filter((r) => matches(r, where)).map((r) => only(r, fields)), hasNextPage: false };
        },
      };
      return q;
    };
    return {
      select: (fields: readonly string[]) => query(fields),
      findMany: async (where?: Where) => {
        check();
        return rows().filter((r) => matches(r, where)).map((r) => ({ id: r.id }));
      },
      findById: async (id: string) => {
        check();
        return rows().some((r) => r.id === id) ? { id } : null;
      },
      create: async (data: Record<string, unknown>) => {
        check();
        const row = { ...data, id: newId() };
        rows().push(row);
        return { id: row.id, ...data };
      },
      update: async (key: { id: string }, patch: Record<string, unknown>) => {
        check();
        const row = rows().find((r) => r.id === key.id);
        if (!row) throw new Error('not found');
        Object.assign(row, patch);
        return { id: row.id, ...patch };
      },
      delete: async (key: { id: string }) => {
        check();
        tables[name] = rows().filter((r) => r.id !== key.id);
      },
    };
  };

  return {
    tables,
    state,
    newId,
    /** Put a row into a table as the database would hold it. */
    seed(name: string, row: Record<string, unknown>) {
      (tables[name] ??= []).push({ id: newId(), ...row });
    },
    reset() {
      for (const name of Object.keys(tables)) delete tables[name];
      state.unreachable = false;
    },
    data: new Proxy({}, { get: (_target, name: string) => entity(name) }) as Record<string, ReturnType<typeof entity>>,
  };
}
