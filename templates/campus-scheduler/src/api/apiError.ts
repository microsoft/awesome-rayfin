import type { CalendarView } from '@/api/scheduler';

/**
 * Turning a backend failure into something a German-speaking planner can read.
 *
 * ⚠️ THE SERVER SPEAKS ENGLISH AND THE APP DOES NOT. `calendar_view.py` answers with
 * `{"error": "not_found", "message": "no cohort matches 'MED-MEDI-1'"}`, and the panel used to
 * render `view.message` directly — so a German UI showed an English sentence, in the one place a
 * user is already confused enough to be reading error text. The message is also written for a
 * developer: it names the lookup that failed, not what the reader should do about it.
 *
 * So the CODE is translated and the prose is discarded. The raw text still goes to the console,
 * because throwing away the diagnostic would trade one problem for another.
 */
export interface Localised {
  key: string;
  values: Record<string, string | number>;
}

/** One message per scope, so nothing has to translate a value inside another translation. */
const NOT_FOUND: Record<string, string> = {
  teacher: 'calendar.errNoTeacher',
  cohort: 'calendar.errNoCohort',
  room: 'calendar.errNoRoom',
};

export function calendarError(view: CalendarView): Localised | null {
  if (!view.error) return null;
  if (view.message) console.warn(`calendar: ${view.error} — ${view.message}`);

  // ⚠️ `key`, not `subject.id`: the error responses carry no subject at all, so naming the failed
  // lookup from it left the message quoting an empty string.
  const subject = view.key ?? view.subject?.id ?? '';
  switch (view.error) {
    case 'not_found':
      return { key: NOT_FOUND[view.scope] ?? 'calendar.errUnknown', values: { key: subject } };
    case 'ambiguous':
      return { key: 'calendar.errAmbiguous', values: { key: subject } };
    // ⚠️ NOT A LOOKUP FAILURE, AND MUST NOT READ AS ONE. On a dataset whose teaching is real but
    // whose lecturers are invented, the person was never real — "no lecturer matches Wimmer" would
    // invite the reader to conclude the university has no such professor. Its own message says
    // what is actually true.
    case 'teacher_not_published':
      return { key: 'calendar.errTeacherNotPublished', values: {} };
    case 'bad_scope':
      return { key: 'calendar.errBadScope', values: {} };
    default:
      // An error the client has never heard of still has to say something, and saying it in the
      // reader's language beats echoing a string written for a stack trace.
      return { key: 'calendar.errUnknown', values: {} };
  }
}

/**
 * A thrown request failure — a network drop, a 500, a cold container that never woke.
 *
 * `postJson` throws `"/api/... → HTTP 502"`, which is precise, English, and meaningless to a
 * planner. It goes to the console; the screen gets a sentence.
 */
export function requestError(err: unknown): Localised {
  console.warn('scheduler request failed', err);
  return { key: 'calendar.errRequest', values: {} };
}
