/**
 * One place that knows where the scheduler backend is and how to be let in.
 *
 * The two names exist because Rayfin rewrites `RAYFIN_PUBLIC_*` from `rayfin/.env` into
 * `VITE_RAYFIN_*` at deploy time, while a local `.env.local` uses the plain `VITE_*` form. Reading
 * both means a laptop build and a Fabric build take the same path through this file.
 *
 * ⚠️ The key here is NOT a secret. It ships inside the JS bundle, and that bundle is served
 * anonymously from the Fabric static host — anyone can read it. It stops a casual caller and
 * nothing more; the spend limits that actually matter live on the server (see server/app.py).
 */
import { activeAoi } from '@/config/aoi';

const env = (...names: string[]): string => {
  for (const name of names) {
    const value = import.meta.env[name] as string | undefined;
    if (value) return value;
  }
  return '';
};

/**
 * One backend per university.
 *
 * ⚠️ `SCHEDULER_SITE` IS A SINGLE VARIABLE ON A SINGLE CONTAINER, so one backend can only ever
 * answer for one university — that is the whole reason the site guard exists. Now that OTH and LMU
 * each have their own container, the FRONT END has to pick, and picking is not a preference: asking
 * OTH's backend for an LMU cohort returns `not_found`, and asking its assistant returns a confident
 * answer drawn from the wrong university's plan.
 *
 * The site is derived from the ACTIVE AOI rather than held in state, because the AOI is already
 * derived from the URL. A second copy of "which university are we on" is a second thing that can be
 * stale, and this is exactly the fact that must never be.
 */
const SITE_BASES: Record<string, string> = {
  oth: env('VITE_SCHEDULER_API_OTH', 'VITE_RAYFIN_SCHEDULER_API_OTH'),
  lmu: env('VITE_SCHEDULER_API_LMU', 'VITE_RAYFIN_SCHEDULER_API_LMU'),
  tum: env('VITE_SCHEDULER_API_TUM', 'VITE_RAYFIN_SCHEDULER_API_TUM'),
  // OTH's own Untis export, served by its own container beside the generated one.
  'oth-real': env('VITE_SCHEDULER_API_OTHREAL', 'VITE_RAYFIN_SCHEDULER_API_OTHREAL'),
};

/**
 * The single-backend setting, kept as the fallback so a one-container deployment still works.
 *
 * ⚠️ AND IT IS A TRAP FOR A HALF-FINISHED SITE. `hasPlanner` is just `Boolean(schedulerSite)`, so
 * adding that one line to an AOI turns the whole planner on — and if no base is registered above,
 * `apiBase()` falls through to HERE, which is another university's container. The result is not an
 * error: it is TUM's campus rendering OTH's timetable under a TUM heading, confidently and
 * silently. `sites.test.ts` asserts every AOI with a `schedulerSite` has a base, so the two can
 * never be added one at a time.
 */
const FALLBACK_BASE = env('VITE_SCHEDULER_API', 'VITE_RAYFIN_SCHEDULER_API');

export function apiBase(): string {
  const site = activeAoi().schedulerSite;
  if (!site) return FALLBACK_BASE;
  /*
   * ⚠️ A SITE THAT NAMES A BACKEND AND HAS NONE GETS NOTHING, NOT SOMEBODY ELSE'S. Falling back
   * here is what turned a missing environment variable into Garching rendering TUM's campus over
   * OTH's timetable: every request succeeded, every number was real, and all of them were about
   * another university. An empty base makes `schedulerConfigured()` false, so the app says this
   * site has no planner — which is wrong, but visibly and harmlessly wrong, and the deploy
   * verifier catches it. The fallback survives only for sites that never claimed a site id, which
   * is the single-container deployment it was written for.
   */
  return SITE_BASES[site] ?? '';
}

export const API_KEY = env('VITE_SCHEDULER_KEY', 'VITE_RAYFIN_SCHEDULER_KEY');

export const schedulerConfigured = () => apiBase().length > 0;

/**
 * Which sites this build knows how to reach. Exported for the registry test, which is the thing
 * standing between an AOI naming a scheduler site and that site quietly resolving to another
 * university's backend.
 */
export const knownSchedulerSites = (): string[] =>
  // ⚠️ ONLY THE ONES THAT RESOLVE. `SITE_BASES` always HAS a `tum` key — the entry exists in the
  // source — but its value is the empty string until the environment supplies a URL, and the first
  // version of this returned the keys. The registry test therefore passed while the shipped bundle
  // carried no TUM backend at all, and Garching fell through to the fallback, which is OTH's
  // container. A site is only "known" when there is somewhere to send its requests.
  Object.entries(SITE_BASES)
    .filter(([, base]) => base.length > 0)
    .map(([site]) => site);

export type { PlanConflict } from '@/planner/moveCheck';
import type { PlanConflict } from '@/planner/moveCheck';

/**
 * Which university's plan the backend is actually serving.
 *
 * ⚠️ THIS IS STILL ASKED, EVEN NOW THAT EACH UNIVERSITY HAS ITS OWN BACKEND. The guard is not made
 * redundant by the second container — it is what catches the container being pointed at the wrong
 * dataset, an env var that did not take, or a build shipped with only one URL configured. The
 * failure it prevents is the assistant answering confidently from the other university's plan, and
 * that failure is silent: every request succeeds, the numbers are real, and they are about someone
 * else's campus.
 *
 * Cached PER SITE: switching AOI must re-ask, or the answer for OTH is used to clear LMU.
 */
const sitePromises = new Map<string, Promise<string | null>>();

export function backendSite(): Promise<string | null> {
  if (!schedulerConfigured()) return Promise.resolve(null);
  const base = apiBase();
  let pending = sitePromises.get(base);
  if (!pending) {
    pending = getJson<{ data?: { site?: string } }>('/api/health')
      .then((response) => response.data?.site ?? null)
      // A backend that cannot say which site it serves is treated as unknown rather than as a
      // match — silence is not agreement.
      .catch(() => null);
    sitePromises.set(base, pending);
  }
  return pending;
}

/**
 * Is this university's timetable REAL, or did this project invent it?
 *
 * ⚠️ THE STRONGEST THING THE APP CAN SAY, AND IT WAS INVISIBLE. Rooms have carried a provenance
 * badge since the twin shipped; the week never did, so a published TUMonline timetable and a
 * generated one looked identical on screen. Read from the same `/api/health` the guard above
 * already fetches, and cached per backend for the same reason.
 *
 * `null` means not known — never assume "generated", because claiming a real week is invented is
 * as wrong as the reverse and there is no safe default.
 */
const provenancePromises = new Map<string, Promise<PlanFacts>>();

export interface PlanFacts {
  /** Whether the week is the university's own. `null` when not known. */
  provenance: 'measured' | 'generated' | null;
  /**
   * Whether a lecturer can be looked up at all.
   *
   * ⚠️ Defaults to TRUE when unknown, because withholding a scope that does work is the more
   * damaging error: it would hide the assistant's main subject on every site whose backend was
   * merely slow to answer.
   */
  lecturerLookup: boolean;
  /**
   * Per-session fields that are INVENTED while the lecture itself is real, so the grid can leave
   * them off rather than print fiction beside a published module code and room.
   *
   * ⚠️ Defaults to EMPTY when unknown, and that is the opposite bias to `lecturerLookup` above
   * on purpose. Withholding a scope that works hides a feature; withholding a name costs nothing
   * but a suffix — but blanking fields on every site because one backend was slow would silently
   * strip real, useful information from OTH and LMU. Hide only what the server has confirmed.
   */
  inventedAttributes: string[];
  /**
   * Lecturers are identified by an Untis short code rather than a name.
   *
   * ⚠️ `Ant` IS NOT A NAME AND MUST NOT LOOK LIKE ONE. OTH's real export carries short codes
   * only, so the grid would otherwise print a three-letter string where every other site prints
   * "Prof. Dr. ..." — which reads as a rendering fault, or worse as somebody's actual name. The
   * decision (2026-08-06) was to show the code and badge it, rather than withhold it as TUM does:
   * the code is what the planner types into Untis, so it is useful, it is simply not a person.
   */
  lecturerNamesAreCodes: boolean;
  /**
   * Rooms that are placed on a campus but have no geometry to draw.
   *
   * ⚠️ AN UNDRAWN ROOM IS NOT AN EMPTY BUILDING. 666 real Prüfening sessions sit in rooms whose
   * building OpenStreetMap holds as an unnamed polygon, so the twin can say WHICH SITE they are on
   * and nothing more. Without this the campus looks unused, which is the opposite of true.
   */
  roomsWithoutGeometry: number;
  /** The campuses affected by the above, so the note can name them. */
  roomsCampusOnly: string[];
  /** False when the source publishes no room capacities, so capacity checks were never performed. */
  capacityPublished: boolean;
}

export function planFacts(): Promise<PlanFacts> {
  if (!schedulerConfigured())
    return Promise.resolve({
      provenance: null, lecturerLookup: true, inventedAttributes: [],
      // Same bias as `inventedAttributes`: assume the ORDINARY case when nothing is known, so a
      // slow backend never paints a caveat over a site that does not need one.
      lecturerNamesAreCodes: false, roomsWithoutGeometry: 0, roomsCampusOnly: [],
      capacityPublished: true,
    });
  const base = apiBase();
  let pending = provenancePromises.get(base);
  if (!pending) {
    pending = getJson<{
      data?: {
        timetableProvenance?: 'measured' | 'generated';
        lecturerLookup?: boolean;
        inventedAttributes?: string[];
        lecturerNamesAreCodes?: boolean;
        roomsWithoutGeometry?: number;
        roomsCampusOnly?: string[];
        capacityPublished?: boolean;
      };
    }>('/api/health')
      .then((response) => ({
        provenance: response.data?.timetableProvenance ?? null,
        lecturerLookup: response.data?.lecturerLookup !== false,
        inventedAttributes: response.data?.inventedAttributes ?? [],
        lecturerNamesAreCodes: response.data?.lecturerNamesAreCodes === true,
        roomsWithoutGeometry: response.data?.roomsWithoutGeometry ?? 0,
        roomsCampusOnly: response.data?.roomsCampusOnly ?? [],
        // Absent means an older backend, which only ever served datasets that DO publish
        // capacities — so the ordinary case is the safe default here.
        capacityPublished: response.data?.capacityPublished !== false,
      }))
      .catch(
        () => ({
          provenance: null, lecturerLookup: true, inventedAttributes: [],
          lecturerNamesAreCodes: false, roomsWithoutGeometry: 0, roomsCampusOnly: [],
          capacityPublished: true,
        }) as PlanFacts
      );
    provenancePromises.set(base, pending);
  }
  return pending;
}

export function timetableProvenance(): Promise<'measured' | 'generated' | null> {
  return planFacts().then((f) => f.provenance);
}

export async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, apiBase());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url.toString(), {
    headers: API_KEY ? { 'X-App-Key': API_KEY } : {},
  });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ── The week grid (server/calendar_view.py) ────────────────────────────────────────────────
export type CalendarScope = 'teacher' | 'cohort' | 'room';

export interface CalendarSlot {
  slotId: string;
  day: string;
  dayIndex: number;
  block: number;
  startTime: string;
  endTime: string;
  desirability: number | null;
}

export interface CalendarEntry {
  sessionId: string;
  slotId: string;
  course: string | null;
  courseId: string | null;
  kind: string | null;
  teacherId: string | null;
  teacher: string | null;
  cohortId: string | null;
  cohort: string | null;
  roomId: string | null;
  roomType: string | null;
  seats: number | null;
  buildingId: string | null;
  campusId: string | null;
  attendance: number | null;
  frozen: boolean;
}

export interface CalendarView {
  scope: CalendarScope;
  subject: { id: string; name: string | null };
  days: string[];
  blocks: number[];
  slots: CalendarSlot[];
  entries: CalendarEntry[];
  bookedSlots: number;
  availability?: { slotId: string; state: string }[];
  error?: string;
  message?: string;
  /**
   * The lookup that failed, echoed back on the error paths only.
   *
   * ⚠️ `subject` is ABSENT on an error — `calendar_view.py` returns `{error, scope, key, message}`
   * and nothing else. Reading `subject.id` to name the failed lookup therefore produced an empty
   * quotation in the message, which read as corrupt data rather than a missing cohort.
   */
  key?: string;
  candidates?: string[];
}

export interface CalendarSubject {
  id: string;
  name: string | null;
  sessions: number;
}

/**
 * Check a hypothetical move against the published plan — PLAN §6.2.
 *
 * ⚠️ THE SERVER DECIDES, NOT THE CLIENT. `detect_conflicts` already accepts `moves` overrides and
 * answers from the whole plan, which is the only place the answer exists: the panel holds one
 * subject's week, so it can see that a teacher is free but not that the room is taken by a cohort
 * it has never loaded. A plausible-looking client-side check would be wrong precisely in the cases
 * a planner drags something to find out about.
 *
 * ⚠️ AND IT WRITES NOTHING. The tool is explicitly a what-if; the only endpoint that changes a
 * plan is `/api/draft/apply`, which takes a solver proposal id and therefore cannot accept a
 * hand-made move at all. That is why a dragged session is held locally and badged as unsaved.
 */
export async function checkMoves(
  moves: { sessionId: string; slotId?: string; roomId?: string }[]
): Promise<PlanConflict[]> {
  // ⚠️ `conflicts` IS A COUNT, NOT THE LIST. The payload is
  // `{checked, conflicts: 0, hard: 0, byType: {}, detail: []}` — the list lives in `detail`.
  // Reading the obvious-looking field handed `verdictFor` the number 0, which failed with
  // "before.map is not a function" and left the verdict stuck on "checking" forever, because a
  // rejected check and an unfinished one looked identical on screen. Both halves of that are
  // fixed; this is the half that was actually wrong.
  const response = await postJson<{ detail?: PlanConflict[]; conflicts?: number }>(
    '/api/tools/detect_conflicts',
    { moves }
  );
  return response.detail ?? [];
}

// ── Proposals and the confirm gate (server/proposals.py) ───────────────────────────────────
export interface ProposalChange {
  sessionId: string;
  course: string | null;
  teacherId: string | null;
  cohortId: string | null;
  attendance: number | null;
  from: { slotId: string | null; roomId: string | null; buildingId: string | null; campusId: string | null };
  to: { slotId: string | null; roomId: string | null; buildingId: string | null; campusId: string | null };
  slotChanged: boolean;
  roomChanged: boolean;
  campusChanged: boolean;
}

export interface ProposalDiff {
  proposalId: string;
  option: number;
  options: { option: number; sessionsMoved: number; cost: number; optimalityProven: boolean }[];
  cost: number;
  optimalityProven: boolean;
  sessionsMoved: number;
  changes: ProposalChange[];
  affects: { teachers: string[]; cohorts: string[]; rooms: string[] };
  error?: string;
}

/**
 * Replan around somebody becoming unavailable — PLAN §1, the thing the product exists for.
 *
 * ⚠️ `forbid` IS NOT OPTIONAL, whatever the schema says. Without it the solver is asked to improve
 * a plan that is already conflict-free, correctly moves nothing, and returns "0 verschoben" — which
 * reads as "no repair is possible" and is the single most misleading answer this system can give.
 * The constraint IS the question; a repair with nothing forbidden is not a weaker question, it is a
 * different one with no answer.
 *
 * Two calls because they are two questions: how big is the hole, and what can be done about it.
 * The first is worth showing even when the second finds nothing.
 */
export async function replanWithout(
  teacher: string,
  day: string
): Promise<{ affected: AffectedSessions; proposal: ProposalDiff | null }> {
  const affected = await postJson<AffectedSessions>('/api/tools/get_affected_sessions', {
    teacher,
    day,
  });
  const ids = (affected.sessions ?? []).map((s) => s.sessionId);
  if (!ids.length) return { affected, proposal: null };

  const proposal = await postJson<ProposalDiff>('/api/tools/propose_repairs', {
    session_ids: ids,
    k: 3,
    forbid: [{ teacher, day }],
  });
  return { affected, proposal: proposal.proposalId ? proposal : null };
}

export interface AffectedSession {
  sessionId: string;
  course: string;
  cohortId: string;
  attendees: number;
  slotId: string;
  roomId: string;
  buildingId: string | null;
}

export interface AffectedSessions {
  sessions?: AffectedSession[];
  count?: number;
  students?: number;
  cohorts?: string[];
  error?: string;
}

export interface AppliedDraft {
  draftId: string;
  label: string;
  confirmedBy: string;
  sessionsChanged: number;
  publishedUntouched: boolean;
  error?: string;
  message?: string;
}

export interface DraftSummary {
  draftId: string;
  label: string;
  confirmedBy: string;
  sessionsChanged: number;
  created: number;
}

export async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, apiBase()).toString(), {
    method: 'DELETE',
    headers: API_KEY ? { 'X-App-Key': API_KEY } : {},
  });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, apiBase()).toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-App-Key': API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ── availability: when a lecturer can teach ───────────────────────────────────────────────

/** One slot of one lecturer's week, as the backend reports it. */
export interface AvailabilitySlot {
  slotId: string;
  day: string;
  block: number;
  startTime: string;
  endTime: string;
  state: 'verfuegbar' | 'eingeschraenkt' | 'nicht_verfuegbar';
  /** The session they already teach here, if any — so the editor can warn before the click. */
  teaches?: string | null;
}

export interface AvailabilityView {
  teacherId: string;
  teacher: string;
  availabilityVersion: number;
  slots: AvailabilitySlot[];
  error?: string;
  didYouMean?: string[];
}

/** A session that the new availability has just made illegal. Nothing moved; the rule changed. */
export interface AvailabilityClash {
  sessionId: string;
  slotId: string;
  roomId?: string;
  course: string;
}

export interface AvailabilityWrite {
  teacherId: string;
  teacher: string;
  changed: number;
  applied: { slotId: string; from: string; to: string }[];
  availabilityVersion: number;
  nowInConflict: AvailabilityClash[];
  error?: string;
  didYouMean?: string[];
}

export const getAvailability = (site: string, teacher: string) =>
  getJson<AvailabilityView>('/api/availability', { site, teacher });

export const setAvailability = (
  site: string,
  teacher: string,
  entries: { slotId: string; state: string }[],
  changedBy: string
) => postJson<AvailabilityWrite>('/api/availability', { site, teacher, entries, changedBy });

/**
 * The URL of the spreadsheet to fill in.
 *
 * ⚠️ A LINK, NOT A FETCH. The file has to reach the user's disk, and an `<a download>` lets the
 * browser do that with its own progress and its own save dialog. Fetching it into memory to make a
 * blob would buy nothing and would lose the filename the server chose.
 *
 * ⚠️ The app key rides in the query string here because a download cannot carry a header. It is
 * not a secret — it is compiled into this bundle and the bundle is served anonymously (PLAN §16) —
 * so this exposes nothing that a reader of the JavaScript does not already have.
 */
export function availabilityTemplateUrl(site: string, teacher?: string): string {
  const url = new URL('/api/availability/template', apiBase());
  url.searchParams.set('site', site);
  if (teacher) url.searchParams.set('teacher', teacher);
  if (API_KEY) url.searchParams.set('key', API_KEY);
  return url.toString();
}

/** What an uploaded spreadsheet would do, or — with `apply` — what it did. */
export interface AvailabilityImport {
  fileName: string;
  sheet: string;
  teachersRead: number;
  teachersChanged: number;
  changes: {
    teacherId: string;
    teacher: string;
    changed: number;
    entries: { slotId: string; state: string }[];
  }[];
  unknownTeachers: string[];
  unknownColumns: string[];
  badValues: { teacher: string; slotId: string; value: string }[];
  applied: boolean;
  nowInConflict?: AvailabilityClash[];
  /**
   * What the file WOULD break, answered by the dry run without writing anything.
   *
   * ⚠️ This is the half a planner is actually deciding on. The preview used to report only how
   * many cells differ — measured on the live app, a sheet blocking four slots the lecturer teaches
   * in previewed as "4 changes" and said nothing about the four lectures it was about to
   * invalidate. A count of edits is not a description of consequences.
   */
  wouldConflict?: AvailabilityClash[];
  error?: string;
  detail?: string;
}

export async function importAvailability(
  site: string,
  file: File,
  apply: boolean,
  changedBy: string
): Promise<AvailabilityImport> {
  const url = new URL('/api/availability/import', apiBase());
  url.searchParams.set('site', site);
  url.searchParams.set('apply', String(apply));
  url.searchParams.set('changed_by', changedBy);
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(url.toString(), {
    method: 'POST',
    // ⚠️ No Content-Type: the browser must set it, because only it knows the multipart boundary.
    headers: API_KEY ? { 'X-App-Key': API_KEY } : {},
    body: form,
  });
  if (!response.ok) throw new Error(`import → HTTP ${response.status}`);
  return (await response.json()) as AvailabilityImport;
}
