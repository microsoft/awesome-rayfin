import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The lecturer the demo should talk about, asked of the running backend.
 *
 * ⚠️ THREE SPECS HARD-CODED "Hinterberger" AND ALL THREE BROKE AT ONCE. The surname pool is
 * reshuffled whenever the timetable is regenerated, so that name stopped existing at OTH — the
 * cascade question then named nobody, `propose_repairs` had nothing to move, and the failures
 * looked like a broken solver (a 2-minute timeout in `assistant.spec`) or a broken preview (a
 * sub-second crash in `proposal.spec`, where `view.entries` came back undefined from a
 * `not_found` payload).
 *
 * The app already answers this question for itself: `/api/plan/summary.exampleTeacher` is the
 * busiest lecturer, and it is what the UI puts in its own suggested question. Asking the backend
 * keeps the specs pointed at whoever the current plan is actually about.
 *
 * ⚠️ Returns null where the site refuses to name a lecturer at all — TUM invents its people over
 * real teaching, so `exampleTeacher` is deliberately empty there. A caller must skip, not invent.
 */
function envValue(name: string): string | null {
  for (const file of ['.env.local', 'rayfin/.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      const hit = text.match(new RegExp(`^\\s*(?:VITE_)?(?:RAYFIN_PUBLIC_)?${name}\\s*=\\s*(.+)$`, 'm'));
      if (hit) return hit[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // Absent file is a legitimate "not configured", not an error.
    }
  }
  return null;
}

const API =
  envValue('SCHEDULER_API') ??
  envValue('VITE_SCHEDULER_API') ??
  envValue('RAYFIN_PUBLIC_SCHEDULER_API');
const KEY = envValue('SCHEDULER_KEY') ?? envValue('VITE_SCHEDULER_KEY') ?? '';

let cached: string | null | undefined;

async function api(path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!API) throw new Error('demoTeacher: no scheduler API configured in .env.local or rayfin/.env');
  const r = await fetch(new URL(path, API).toString(), {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(KEY ? { 'X-App-Key': KEY } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`demoTeacher: ${path} answered ${r.status}`);
  const payload = (await r.json()) as Record<string, unknown>;
  // `/api/tools/*` wraps its result in `data`; `/api/plan/summary` does not.
  return (payload.data as Record<string, unknown>) ?? payload;
}

/**
 * A lecturer whose Friday cascade the solver can ACTUALLY repair.
 *
 * ⚠️ "THE BUSIEST" IS THE WORST POSSIBLE CHOICE HERE, which is what the first version used
 * (`/api/plan/summary.exampleTeacher`). The busiest lecturer at OTH holds 24 of 35 slots, so
 * lifting their six Friday sessions still leaves them booked almost everywhere — `propose_repairs`
 * correctly answers `no_candidate`, and the cascade test then failed on a two-minute timeout that
 * looked like a broken solver. Measured: 11 of the 12 busiest lecturers have a feasible cascade;
 * exactly that one does not.
 *
 * So the subject is CHOSEN BY ASKING THE SOLVER, not by a heuristic about load. It costs a couple
 * of ~10 s calls in specs that already run for minutes, and it cannot silently pick an
 * unanswerable question again.
 *
 * ⚠️ THROWS if nothing is repairable. That would mean the plan has no headroom left anywhere — a
 * real regression in the product's headline demo — and it must not be reported as a skip.
 */
export async function demoSurname(): Promise<string | null> {
  if (cached !== undefined) return cached;

  const suggestions = (await api('/api/calendar/suggestions?scope=teacher')) as {
    subjects?: { id: string; name?: string }[];
  };
  const subjects = suggestions.subjects ?? [];
  if (!subjects.length) throw new Error('demoTeacher: the backend suggested no lecturers at all');

  const tried: string[] = [];
  for (const subject of subjects.slice(0, 8)) {
    const surname = String(subject.name ?? '').trim().split(/\s+/).pop();
    if (!surname) continue;

    const affected = (await api('/api/tools/get_affected_sessions', {
      teacher: surname,
      day: 'Fr',
    })) as { error?: string; sessions?: { sessionId: string }[] };

    // A site that refuses to name lecturers at all (TUM invents its people over real teaching)
    // is a legitimate skip — the caller has no cascade to demonstrate here.
    if (affected.error === 'teacher_not_published') {
      cached = null;
      return cached;
    }
    const ids = (affected.sessions ?? []).map((s) => s.sessionId);
    if (!ids.length) continue;

    const repaired = (await api('/api/tools/propose_repairs', {
      session_ids: ids,
      k: 1,
      forbid: [{ teacher: surname, day: 'Fr' }],
      time_limit_s: 10,
    })) as { options?: unknown[] };
    tried.push(surname);
    if ((repaired.options ?? []).length > 0) {
      cached = surname;
      return cached;
    }
  }

  throw new Error(
    `demoTeacher: no lecturer has a repairable Friday cascade (tried ${tried.join(', ') || 'none'}) ` +
      '— the plan has no headroom left, which is a regression rather than a reason to skip'
  );
}
