/**
 * Where a confirmed plan change is KEPT — PLAN §13.7.
 *
 * ⚠️ THIS EXISTS BECAUSE CONFIRMED WORK WAS EVAPORATING. Drafts live in a module-level dict inside
 * the solver container (`server/proposals.py::_drafts`), and that container scales to zero — so a
 * change a planner had checked and saved came back looking untouched. That is the worst way to lose
 * work: silently, and indistinguishably from never having done it.
 *
 * ⚠️ SAVING IS ADDITIVE, NEVER A GATE. The data layer refuses an unauthenticated write, and Fabric
 * SSO only resolves inside the Fabric-hosted app — never on a laptop, never under Playwright. So
 * every function here reports failure as a VALUE and none of them throw into the confirm flow.
 * Confirming has to keep working exactly as before when there is no session; what must not happen
 * is the app implying a change was kept when it was not. That would recreate the original bug with
 * extra steps and more confidence.
 *
 * The draft in the solver stays the working copy. This is the record of what was COMMITTED — the
 * decision, not the plan. The plan itself is rebuilt from the dataset baked into the solver image,
 * so copying ~980 assignment rows into SQL would persist something already reproducible and create
 * a second source of truth to keep in step.
 */
import { ensureSignedInWithFabric } from '@microsoft/rayfin-auth-provider-fabric';
import { RayfinClient } from '@microsoft/rayfin-client';

const env = (...names: string[]): string => {
  for (const name of names) {
    const value = import.meta.env[name] as string | undefined;
    if (value) return value;
  }
  return '';
};

// Same two-name dance as the scheduler client: Rayfin rewrites `RAYFIN_PUBLIC_*` into
// `VITE_RAYFIN_*` at deploy time, a local `.env.local` uses the plain form.
const BASE_URL = env('VITE_API_URL', 'VITE_RAYFIN_API_URL');
const PUBLISHABLE_KEY = env('VITE_PUBLISHABLE_KEY', 'VITE_RAYFIN_PUBLISHABLE_KEY');

/**
 * ⚠️ THE FABRIC IDENTIFIERS USE A DIFFERENT PREFIX, AND GUESSING IT COST THE WHOLE FEATURE.
 *
 * `rayfin env` emits **`VITE_FABRIC_WORKSPACE_ID`**, `VITE_FABRIC_ITEM_ID`, `VITE_FABRIC_PORTAL_URL`
 * and `VITE_FABRIC_TENANT_ID` — not the `VITE_RAYFIN_*` form the scheduler variables use. These
 * were originally written as `VITE_WORKSPACE_ID` / `VITE_RAYFIN_WORKSPACE_ID` by analogy, so both
 * resolved to '', `planStoreCanSignIn()` was permanently false, the sign-in button never rendered,
 * and there was therefore NO WAY to obtain a session — the table could not have received a row
 * however long anyone used the app.
 *
 * It survived a bundle check too: the workspace and item UUIDs ARE in the shipped JavaScript,
 * because `.env.local` inlines them under their real names. Searching the artefact for the VALUE
 * proved only that Vite had them, never that this file asked for them under the right KEY.
 * `__tests__/planStore.test.ts` now reads `.env.local` and compares the names.
 */
const WORKSPACE_ID = env('VITE_FABRIC_WORKSPACE_ID', 'VITE_WORKSPACE_ID', 'VITE_RAYFIN_WORKSPACE_ID');
const ITEM_ID = env('VITE_FABRIC_ITEM_ID', 'VITE_ITEM_ID', 'VITE_RAYFIN_ITEM_ID');
const PORTAL_URL =
  env('VITE_FABRIC_PORTAL_URL', 'VITE_PORTAL_URL', 'VITE_RAYFIN_PORTAL_URL')
  || 'https://app.fabric.microsoft.com';

/**
 * One row per moved session.
 *
 * ⚠️ Deliberately NOT imported from `rayfin/data/PlanChange.ts`. That file is compiled with TC39
 * decorators under its own tsconfig, and pulling it into the app build drags the schema toolchain
 * into the browser bundle. The duplication is guarded by a unit test that reads the entity file and
 * compares the field names, so a column added there and forgotten here fails the suite rather than
 * failing silently at runtime.
 */
export interface PlanChangeRow {
  site: string;
  sessionId: string;
  course: string;
  fromSlotId: string;
  toSlotId: string;
  roomId: string;
  legal: boolean;
  verdict?: string;
  conflictCount: number;
  savedBy: string;
  savedAt: Date;
}

/**
 * Where a session currently sits — mirrors `rayfin/data/PlanAssignment.ts`.
 *
 * ⚠️ THE WHOLE PLAN LIVES IN SQL, not just the edits. A change log cannot answer "what is the
 * timetable now" without being replayed, so anything reading the database saw the edits and never
 * the plan. One row per session, upserted, so the table always states the current position.
 */
export interface PlanAssignmentRow {
  id: string;
  site: string;
  sessionId: string;
  courseId: string;
  course: string;
  teacherId: string;
  cohortId: string;
  slotId: string;
  roomId: string;
  buildingId: string;
  campusId: string;
  frozen: boolean;
  source: string;
  updatedBy: string;
  updatedAt: Date;
}

/**
 * When a lecturer can teach — mirrors `rayfin/data/TeacherAvailability.ts`.
 *
 * ⚠️ ONLY THE DEVIATIONS. The dataset carries a row per lecturer per slot and nearly all of them
 * say "available"; this table holds only the ones somebody has stated an intent about, so an
 * absent row means "nobody has said" rather than "free".
 */
export interface TeacherAvailabilityRow {
  id: string;
  site: string;
  teacherId: string;
  slotId: string;
  state: string;
  source: string;
  note?: string;
  updatedBy: string;
  updatedAt: Date;
}

type Schema = {
  PlanChange: PlanChangeRow & { id: string };
  PlanAssignment: PlanAssignmentRow;
  TeacherAvailability: TeacherAvailabilityRow;
};

let client: RayfinClient<Schema> | null = null;

/** Configured at all? A laptop build without the Rayfin vars simply has no store. */
export const planStoreConfigured = (): boolean => Boolean(BASE_URL && PUBLISHABLE_KEY);

const getClient = (): RayfinClient<Schema> | null => {
  if (!planStoreConfigured()) return null;
  if (!client) client = new RayfinClient<Schema>({ baseUrl: BASE_URL, publishableKey: PUBLISHABLE_KEY });
  return client;
};

/**
 * Who is signed in, or null.
 *
 * ⚠️ This is the identity ON THE SESSION, and it is still written BY THE CLIENT. It is a large
 * improvement on the `"Planer:in (UI)"` string the app used to send — a label anybody could type
 * is not an audit trail — but it is not yet a server-stamped field either, and PLAN §15.1 is where
 * that gets fixed. Do not describe it as verified provenance.
 */
export function planStoreIdentity(): string | null {
  const c = getClient();
  if (!c) return null;
  try {
    const session = c.auth.getSession();
    if (!session?.isAuthenticated || !session.user) return null;
    const user = session.user as { email?: string; name?: string; id?: string };
    return user.email ?? user.name ?? user.id ?? null;
  } catch {
    return null;
  }
}

export type SaveOutcome =
  | { status: 'saved'; rows: number; savedBy: string }
  | { status: 'no-session' }
  | { status: 'not-configured' }
  | { status: 'failed'; reason: string };

/** Can a sign-in even be attempted? Needs the Fabric coordinates, not just the data-plane URL. */
export const planStoreCanSignIn = (): boolean =>
  planStoreConfigured() && Boolean(WORKSPACE_ID && ITEM_ID);

/**
 * Get a Fabric session, opening the broker if there is not one already.
 *
 * ⚠️ MUST BE CALLED STRAIGHT FROM A CLICK. The last step of the waterfall calls `window.open`,
 * and a browser only allows that inside a user gesture — after an `await` the gesture is spent and
 * the tab is silently blocked. That is why saving is offered as its own button rather than being
 * folded into `confirm()`, which awaits the solver before it could ask.
 *
 * The earlier steps (existing session, refresh token, the postMessage handoff used when the app
 * runs embedded in the Fabric portal) open nothing, so signing in is usually invisible.
 */
export async function signInToStore(): Promise<string | null> {
  const c = getClient();
  if (!c || !planStoreCanSignIn()) return null;

  const existing = planStoreIdentity();
  if (existing) return existing;

  try {
    await ensureSignedInWithFabric(c.auth, {
      workspaceId: WORKSPACE_ID,
      projectId: ITEM_ID,
      fabricPortalUrl: PORTAL_URL,
      returnOrigin: window.location.origin,
    });
    return planStoreIdentity();
  } catch (err) {
    console.warn('plan change store sign-in:', err);
    return null;
  }
}

/**
 * Write the confirmed moves. Returns what happened rather than throwing, so the caller can say
 * plainly whether the change was KEPT or only applied to the in-memory draft.
 */
export async function savePlanChanges(
  rows: Omit<PlanChangeRow, 'savedBy' | 'savedAt'>[]
): Promise<SaveOutcome> {
  const c = getClient();
  if (!c) return { status: 'not-configured' };
  if (!rows.length) return { status: 'saved', rows: 0, savedBy: '' };

  const savedBy = planStoreIdentity();
  // Without a session the write would be refused by the server anyway. Saying so up front is more
  // useful than a 403 in the console and a UI that looks like it succeeded. Signing in is NOT
  // attempted here: it can open a tab, and a confirmation is not the moment to hijack.
  if (!savedBy) return { status: 'no-session' };
  return writeRows(c, rows, savedBy);
}

/**
 * Sign in if needed, then write. Call this from a click handler and nothing else — see
 * {@link signInToStore} for why the gesture matters.
 */
export async function signInAndSavePlanChanges(
  rows: Omit<PlanChangeRow, 'savedBy' | 'savedAt'>[]
): Promise<SaveOutcome> {
  const c = getClient();
  if (!c) return { status: 'not-configured' };
  const savedBy = await signInToStore();
  if (!savedBy) return { status: 'no-session' };
  return writeRows(c, rows, savedBy);
}

async function writeRows(
  c: RayfinClient<Schema>,
  rows: Omit<PlanChangeRow, 'savedBy' | 'savedAt'>[],
  savedBy: string
): Promise<SaveOutcome> {
  const savedAt = new Date();
  try {
    // Sequential on purpose: a partial write is easier to reason about than a partial write with an
    // unpredictable order, and a confirmed repair is a handful of rows, not a bulk load.
    for (const row of rows) {
      await c.data.PlanChange.create({ ...row, savedBy, savedAt });
    }
    return { status: 'saved', rows: rows.length, savedBy };
  } catch (err) {
    // ⚠️ The server's prose never reaches the screen — same rule as every other failure path in
    // this app. The caller turns the status into a sentence in the reader's own language.
    console.warn('plan change store:', err);
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Everything kept for one university, newest first. Shared, because a timetable is shared.
 *
 * ⚠️ READING THE STORE NEEDS A SESSION, SO WITHOUT ONE IT MUST NOT ASK. The Fabric data plane
 * answers an anonymous GraphQL POST with 401, and the browser writes that to the console whatever
 * the caller does with the promise — a `catch` cannot suppress the network log. Two of them showed
 * on every anonymous visit that opened the week, on the LIVE app, for weeks: `TwinShell` guarded
 * its copy of this call on `planStoreIdentity()` and `CalendarPanel` made the same call ungated.
 *
 * The guard belongs HERE rather than at each call site, because the store is what knows it needs a
 * session. A third caller would otherwise have to remember, and the second one already did not.
 * An empty list is the honest answer: with nobody signed in there are no saved decisions to read.
 */
/**
 * Read EVERY row a query matches, following DAB's cursor to the end.
 *
 * ⚠️ `.execute()` IS NOT "ALL ROWS", AND IT DOES NOT SAY SO. Without an explicit `first:` the
 * Data API Builder applies its own default page — 100 rows — and returns them as a plain array
 * with no marker that anything was left behind. Every list in this module used to end in
 * `.execute()`, so each one quietly described the first 100 rows of a 1 925-row table as the whole
 * table. Measured, not theorised: a reset over 3 published rows deleted exactly ONE of them and
 * reported success, because only that one happened to fall inside the first page. A read-modify-
 * write over a truncated read is worse than a failed read — it half-does the job and calls it done.
 *
 * ⚠️ THE PAGE SIZE IS THE CLIENT'S MAXIMUM, NOT A GUESS. DAB caps `first:` at 1 000; asking for
 * more is an error rather than a bigger page, so the loop is what gets past that ceiling.
 */
export async function fetchAllPages<T>(
  build: () => { first: (n: number) => { after: (c: string) => unknown; executePaginated: () => Promise<{ items: T[]; endCursor?: string; hasNextPage?: boolean }> } }
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  // A stop that cannot run away: 1 000 pages is 1 000 000 rows, far past any timetable, so a
  // server that kept claiming `hasNextPage` would end the loop rather than the browser tab.
  for (let page = 0; page < 1000; page += 1) {
    let q = build().first(1000) as {
      after: (c: string) => unknown;
      executePaginated: () => Promise<{ items: T[]; endCursor?: string; hasNextPage?: boolean }>;
    };
    if (cursor) q = q.after(cursor) as typeof q;
    const res = await q.executePaginated();
    out.push(...(res.items ?? []));
    if (!res.hasNextPage || !res.endCursor) break;
    cursor = res.endCursor;
  }
  return out;
}

export async function listPlanChanges(site: string): Promise<(PlanChangeRow & { id: string })[]> {
  const c = getClient();
  if (!c || !planStoreIdentity()) return [];
  try {
    return await fetchAllPages<PlanChangeRow & { id: string }>(() =>
      c.data.PlanChange.select([
        'id',
        'site',
        'sessionId',
        'course',
        'fromSlotId',
        'toSlotId',
        'roomId',
        'legal',
        'verdict',
        'conflictCount',
        'savedBy',
        'savedAt',
      ])
        .where({ site: { eq: site } })
        .orderBy({ savedAt: 'desc' }) as never
    );
  } catch (err) {
    console.warn('plan change store:', err);
    return [];
  }
}

/** One session's current whereabouts, as the saved decisions leave it. */
export interface RestoredMove {
  sessionId: string;
  slotId: string;
  roomId: string;
}

/**
 * The id a session's row has, derived from `${site}:${sessionId}` rather than drawn at random.
 *
 * ⚠️ THIS IS WHAT MAKES THE WRITE AN UPSERT. A session moved three times must leave ONE row saying
 * where it is; appending three would make the reader work out which is current, which is exactly
 * the job the plan table exists to remove. The history is `PlanChange`'s.
 *
 * FNV-1a folded into the RFC-4122 v4 layout: this is a stable identifier, not a random one, and
 * the version nibbles are set only so the column's UUID type accepts it. It is not a security
 * primitive and collision resistance across ~2 000 sessions is all that is being asked of it.
 */
export function assignmentId(site: string, sessionId: string): string {
  const key = `${site}:${sessionId}`;
  const hex: string[] = [];
  // Four independent FNV-1a passes, each salted, to fill 16 bytes without a crypto dependency.
  for (let pass = 0; pass < 4; pass += 1) {
    let hash = 0x811c9dc5 ^ pass;
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hex.push(hash.toString(16).padStart(8, '0'));
  }
  const raw = hex.join('');
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    ((parseInt(raw.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + raw.slice(17, 20),
    raw.slice(20, 32),
  ].join('-');
}

/**
 * Put the current position of one or more sessions into SQL.
 *
 * ⚠️ UPSERT, NOT CREATE. Called on every confirmed move, and a session can be moved repeatedly.
 * Reports failure as a value like every other function here — a plan row that did not land must
 * not break a confirmation that otherwise succeeded, but it must also not be claimed.
 */
export async function savePlanAssignments(
  rows: Omit<PlanAssignmentRow, 'id' | 'updatedBy' | 'updatedAt'>[],
  savedBy: string
): Promise<{ written: number; failed: number }> {
  const c = getClient();
  if (!c || !rows.length) return { written: 0, failed: 0 };

  const updatedAt = new Date();
  let written = 0;
  let failed = 0;
  for (const row of rows) {
    const id = assignmentId(row.site, row.sessionId);
    const full = { ...row, id, updatedBy: savedBy, updatedAt };
    /*
     * ⚠️ THE UPDATE HALF IS DELIBERATELY NARROWER THAN THE CREATE HALF. A move knows where the
     * session went; it does NOT know everything about the session. The solver's proposal diff
     * carries no `courseId`, so writing the whole row on every update would blank a field the
     * baseline seed had filled in — losing data by "updating" it. Only what a move actually
     * changes is written back.
     */
    const moved = {
      slotId: row.slotId,
      roomId: row.roomId,
      buildingId: row.buildingId,
      campusId: row.campusId,
      source: row.source,
      updatedBy: savedBy,
      updatedAt,
    };
    try {
      await c.data.PlanAssignment.upsert({ id }, full, moved);
      written += 1;
    } catch (err) {
      console.warn('plan assignment upsert:', err);
      failed += 1;
    }
  }
  return { written, failed };
}

/**
 * The current timetable as SQL holds it, for one university.
 *
 * ⚠️ Same guard, same reason as `listPlanChanges` — a read without a session is a guaranteed 401
 * written straight to the browser console.
 */
export async function listPlanAssignments(site: string): Promise<PlanAssignmentRow[]> {
  const c = getClient();
  if (!c || !planStoreIdentity()) return [];
  try {
    // ⚠️ PAGED, NOT `.execute()` — this table is ~1 925 rows per site and a single page is 100.
    return await fetchAllPages<PlanAssignmentRow>(() =>
      c.data.PlanAssignment.select([
        'id',
        'site',
        'sessionId',
        'courseId',
        'course',
        'teacherId',
        'cohortId',
        'slotId',
        'roomId',
        'buildingId',
        'campusId',
        'frozen',
        'source',
        'updatedBy',
        'updatedAt',
      ]).where({ site: { eq: site } }) as never
    );
  } catch (err) {
    console.warn('plan assignment store:', err);
    return [];
  }
}

/** The id an availability row has, derived from site + teacher + slot rather than drawn at random. */
export function availabilityId(site: string, teacherId: string, slotId: string): string {
  return assignmentId(site, `${teacherId}@${slotId}`);
}

/**
 * Every availability statement we hold for one university.
 *
 * ⚠️ Paged, like every other list here — a busy semester at LMU's 102 lecturers can pass 100 rows
 * with three people's worth of statements.
 */
export async function listAvailability(site: string): Promise<TeacherAvailabilityRow[]> {
  const c = getClient();
  if (!c || !planStoreIdentity()) return [];
  try {
    return await fetchAllPages<TeacherAvailabilityRow>(() =>
      c.data.TeacherAvailability.select([
        'id',
        'site',
        'teacherId',
        'slotId',
        'state',
        'source',
        'note',
        'updatedBy',
        'updatedAt',
      ]).where({ site: { eq: site } }) as never
    );
  } catch (err) {
    console.warn('availability store:', err);
    return [];
  }
}

/**
 * Record what a lecturer has told us about one or more slots.
 *
 * ⚠️ UPSERT, and `verfuegbar` IS STORED RATHER THAN DELETED. Saying "actually I can teach Monday
 * after all" is a statement, not the absence of one — deleting the row would make it
 * indistinguishable from never having been asked, and the next spreadsheet import would have no
 * way to know the difference. `updatedBy`/`updatedAt` are what make it an account of who said what.
 *
 * ⚠️ Reports failure as a value, like every other write in this module: an availability row that
 * did not land must not break the edit the planner already made in the running app, but it must
 * also not be claimed as saved.
 */
export async function saveAvailability(
  site: string,
  teacherId: string,
  entries: { slotId: string; state: string; note?: string }[],
  source: 'ui' | 'import',
  savedBy: string
): Promise<{ written: number; failed: number }> {
  const c = getClient();
  if (!c || !entries.length) return { written: 0, failed: 0 };
  const updatedAt = new Date();
  let written = 0;
  let failed = 0;
  for (const e of entries) {
    const id = availabilityId(site, teacherId, e.slotId);
    const full = {
      id,
      site,
      teacherId,
      slotId: e.slotId,
      state: e.state,
      source,
      note: e.note ?? '',
      updatedBy: savedBy,
      updatedAt,
    };
    try {
      // The update half carries only what a restatement changes — the identity columns are what
      // the id is derived from, so rewriting them could only ever write the same values back.
      await c.data.TeacherAvailability.upsert({ id }, full, {
        state: e.state,
        source,
        note: e.note ?? '',
        updatedBy: savedBy,
        updatedAt,
      });
      written += 1;
    } catch (err) {
      console.warn('availability upsert:', err);
      failed += 1;
    }
  }
  return { written, failed };
}

/** Drop every availability statement for one university — the availability half of a full reset. */
export async function clearAvailability(site: string): Promise<number> {
  const c = getClient();
  if (!c || !planStoreIdentity()) return 0;
  let rows = 0;
  for (const row of await listAvailability(site)) {
    try {
      await c.data.TeacherAvailability.delete({ id: row.id });
      rows += 1;
    } catch (err) {
      console.warn('availability delete:', err);
    }
  }
  return rows;
}

/** Collapse a newest-first change log into the plan it adds up to.
 *
 * ⚠️ ORDER IS LOAD-BEARING AND EASY TO GET BACKWARDS. `listPlanChanges` returns newest first, so
 * this walks the list in REVERSE: the last write must win, and iterating as given would let the
 * oldest decision overwrite the newest and quietly resurrect a move somebody had already replaced.
 * Exported separately from the fetch so that exact mistake is unit-testable without a data layer.
 */
export function collapseToMoves(rows: Pick<PlanChangeRow, 'sessionId' | 'toSlotId' | 'roomId'>[]): RestoredMove[] {
  const latest = new Map<string, RestoredMove>();
  for (const row of [...rows].reverse()) {
    latest.set(row.sessionId, {
      sessionId: row.sessionId,
      slotId: row.toSlotId,
      roomId: row.roomId,
    });
  }
  return [...latest.values()];
}

/**
 * The saved changes collapsed into the plan they add up to — one row per session.
 *
 * ⚠️ THE TABLE IS A LOG, NOT A STATE. A session moved on Monday and moved again on Tuesday has two
 * rows, and only the second one is true. Collapsing here means the backend is handed a plan rather
 * than a history, and the count the UI reports is "sessions that differ from the baseline" instead
 * of "times anyone pressed save" — which is the number a planner would actually recognise.
 */
export async function currentPlanMoves(site: string): Promise<RestoredMove[]> {
  return collapseToMoves(await listPlanChanges(site));
}

/** What a deletion did. Reported rather than thrown, like every other write in this module. */
export interface DeleteOutcome {
  status: 'deleted' | 'no-session' | 'not-configured' | 'failed';
  rows?: number;
  sessions?: number;
  reason?: string;
}

/** Where the shipped dataset puts a session, as `/api/plan/reset` reports it. */
export interface BaselinePosition {
  sessionId: string;
  slotId: string;
  roomId: string;
  buildingId: string;
  campusId: string;
}

/**
 * The sessions this app has moved away from their shipped position, for one university.
 *
 * Read before the reset so the caller can ask the server where those sessions BELONG; the answer
 * is what turns a reset from a deletion into a restoration.
 */
export async function dirtyAssignmentSessions(site: string): Promise<string[]> {
  return (await listPlanAssignments(site))
    .filter((a) => a.source !== 'baseline')
    .map((a) => a.sessionId);
}

/**
 * Put one university's plan back the way it shipped, in BOTH tables.
 *
 * ⚠️ TWO TABLES, AND MISSING ONE IS THE WHOLE PROBLEM. `PlanChanges` is the LOG and
 * `PlanAssignments` is the STATE. Truncating the log by hand leaves the state rows behind —
 * measured after exactly that: 4 `change` rows and 1 `published` row survived, so the app went on
 * replaying a published plan whose history no longer existed. Clearing has to name both or it
 * leaves the two disagreeing, which is harder to diagnose than either being wrong.
 *
 * ⚠️ THE STATE TABLE IS RESTORED, NOT EMPTIED, AND THE DIFFERENCE IS A LOST SESSION. There is ONE
 * row per session: saving a move UPSERTS over that session's baseline row rather than adding a
 * second one. So "delete every non-baseline row" — which is what this function used to do — does
 * not put the session back, it removes the session from the timetable altogether. Measured: after
 * resetting three moved sessions the table held 1 922 rows instead of 1 925 and one lecturer's
 * week was a session short, with nothing in the table able to say what had been there. The caller
 * therefore passes the shipped positions (from `/api/plan/reset`, which has just re-read the baked
 * dataset) and each dirty row is written BACK to them with `source='baseline'`.
 *
 * ⚠️ Rows are only deleted when the server says the shipped dataset has no such session — a true
 * orphan, which is the one case where removal is the restoration.
 */
export async function clearPlanStore(
  site: string,
  baseline: BaselinePosition[] = [],
  orphans: string[] = []
): Promise<DeleteOutcome> {
  const c = getClient();
  if (!c) return { status: 'not-configured' };
  const identity = planStoreIdentity();
  if (!identity) return { status: 'no-session' };
  try {
    let rows = 0;
    for (const row of await listPlanChanges(site)) {
      await c.data.PlanChange.delete({ id: row.id });
      rows += 1;
    }

    const updatedAt = new Date();
    for (const b of baseline) {
      // The narrow update half of the upsert: position and provenance only, so course, teacher
      // and cohort — which a move never carried — survive the restore instead of being blanked.
      await c.data.PlanAssignment.upsert(
        { id: assignmentId(site, b.sessionId) },
        {
          id: assignmentId(site, b.sessionId),
          site,
          sessionId: b.sessionId,
          courseId: '',
          course: b.sessionId,
          teacherId: '',
          cohortId: '',
          slotId: b.slotId,
          roomId: b.roomId,
          buildingId: b.buildingId,
          campusId: b.campusId,
          frozen: false,
          source: 'baseline',
          updatedBy: identity,
          updatedAt,
        },
        {
          slotId: b.slotId,
          roomId: b.roomId,
          buildingId: b.buildingId,
          campusId: b.campusId,
          source: 'baseline',
          updatedBy: identity,
          updatedAt,
        }
      );
      rows += 1;
    }

    for (const sessionId of orphans) {
      await c.data.PlanAssignment.delete({ id: assignmentId(site, sessionId) });
      rows += 1;
    }

    return { status: 'deleted', rows, sessions: baseline.length + orphans.length };
  } catch (err) {
    console.warn('plan store clear:', err);
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Delete saved changes for whole sessions — the only way a decision leaves the store.
 *
 * ⚠️ EVERY ROW FOR THE SESSION, NOT THE NEWEST ONE. `PlanChange` is a LOG: a session moved twice
 * has two rows and `collapseToMoves` reports the later one. Deleting only that row would let the
 * EARLIER move resurface, so the change would not disappear — it would silently become a different
 * change. That is worse than the bug this function exists to fix, because it looks like it worked.
 *
 * ⚠️ IT DOES NOT REVERT A PUBLISHED PLAN, AND MUST NOT PRETEND TO. If a session was published, the
 * plan of record holds it in `PlanAssignments` with `source='published'`; removing its history
 * leaves that row exactly where it is. Rolling a published plan back is a different act that this
 * product does not have yet (PLAN §24.4), and quietly half-doing it here would be the worst of
 * both — a plan that no longer matches the log that explains it.
 */
export async function deletePlanChanges(
  site: string,
  sessionIds: string[]
): Promise<DeleteOutcome> {
  const c = getClient();
  if (!c) return { status: 'not-configured' };
  if (!planStoreIdentity()) return { status: 'no-session' };
  if (!sessionIds.length) return { status: 'deleted', rows: 0, sessions: 0 };

  const wanted = new Set(sessionIds);
  try {
    const all = await listPlanChanges(site);
    const doomed = all.filter((r) => wanted.has(r.sessionId));
    // Sequential for the same reason the write is: a partial delete is easier to reason about
    // than a partial delete in an unpredictable order, and this is a handful of rows.
    for (const row of doomed) {
      await c.data.PlanChange.delete({ id: row.id });
    }
    return { status: 'deleted', rows: doomed.length, sessions: wanted.size };
  } catch (err) {
    console.warn('plan change store:', err);
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
