/**
 * Judging a hand-made move — PLAN §6.2.
 *
 * The rule this file exists to enforce: **a move is illegal only if it CAUSES a conflict.** The
 * checker on the server returns every conflict in the whole plan, and the honest question a
 * planner is asking when they drag a lecture is not "is this timetable perfect" but "did I just
 * break something". Those differ the moment a plan carries a pre-existing problem somewhere else
 * on campus — and a drag that turned red because of a clash three buildings away, in a session the
 * planner has never seen, would be indistinguishable from a bug.
 *
 * So the verdict is a DIFFERENCE: conflicts after the move, minus the ones that were already
 * there. Kept pure and separate from the panel so it can be tested against real conflict payloads
 * rather than through a drag gesture.
 */

/** One conflict as `server/tools.py::detect_conflicts` emits it. */
export interface PlanConflict {
  type: string;
  severity?: string;
  slotId?: string;
  roomId?: string;
  teacherId?: string;
  attendeeId?: string;
  sessionId?: string;
  sessions?: string[];
  capacity?: number;
  attendees?: number;
  is?: string;
  needs?: string;
  [key: string]: unknown;
}

export interface MoveVerdict {
  /** True when the move introduces no new hard conflict. */
  legal: boolean;
  /** Conflicts this move is responsible for, in the order the server reported them. */
  caused: PlanConflict[];
}

/**
 * A stable identity for a conflict, so "the same problem" is recognised across two checks.
 *
 * ⚠️ THE SESSION LIST HAS TO BE ORDER-INDEPENDENT. `room_double_booked` reports its two sessions
 * as `[incumbent, newcomer]`, and which is which depends on dictionary order in the server's
 * placement map — so the identical pre-existing clash can come back with its pair the other way
 * round and would count as new every time the plan is re-checked.
 */
export function conflictKey(conflict: PlanConflict): string {
  const parts = [
    conflict.type,
    conflict.slotId ?? '',
    conflict.roomId ?? '',
    conflict.teacherId ?? '',
    conflict.attendeeId ?? '',
    conflict.sessionId ?? '',
    [...(conflict.sessions ?? [])].sort().join('+'),
  ];
  return parts.join('|');
}

/**
 * What the move broke, if anything.
 *
 * `before` is the published plan's own conflicts. Passing an empty list is legitimate — this
 * plan is conflict-free — but the subtraction still runs, because "the demo data happens to be
 * clean" is not a property worth depending on.
 */
export function verdictFor(
  sessionId: string,
  before: PlanConflict[],
  after: PlanConflict[]
): MoveVerdict {
  const known = new Set(before.map(conflictKey));
  const caused = after.filter((conflict) => !known.has(conflictKey(conflict)));

  // A conflict that mentions the moved session anywhere is its responsibility; one that does not
  // is collateral the move caused elsewhere, which still counts — displacing a session into a
  // room someone else is using breaks THEIR booking, and hiding that would be worse than useless.
  const mine = caused.filter(
    (c) => c.sessionId === sessionId || (c.sessions ?? []).includes(sessionId)
  );
  const ordered = [...mine, ...caused.filter((c) => !mine.includes(c))];

  return {
    legal: ordered.every((c) => c.severity && c.severity !== 'hard'),
    caused: ordered,
  };
}

/** Everything the UI needs to phrase a conflict, without the UI knowing the server's vocabulary. */
export function conflictReason(conflict: PlanConflict): { key: string; values: Record<string, string | number> } {
  switch (conflict.type) {
    case 'room_double_booked':
      return { key: 'move.clashRoom', values: { room: conflict.roomId ?? '' } };
    case 'teacher_double_booked':
      return { key: 'move.clashTeacher', values: { teacher: conflict.teacherId ?? '' } };
    case 'cohort_double_booked':
      return { key: 'move.clashCohort', values: { cohort: conflict.attendeeId ?? '' } };
    case 'over_capacity':
      return {
        key: 'move.clashCapacity',
        values: { seats: conflict.capacity ?? 0, attendees: conflict.attendees ?? 0 },
      };
    case 'wrong_room_type':
      return {
        key: 'move.clashRoomType',
        values: { is: conflict.is ?? '', needs: conflict.needs ?? '' },
      };
    case 'teacher_unavailable':
      return { key: 'move.clashUnavailable', values: { teacher: conflict.teacherId ?? '' } };
    case 'impossible_transfer':
      return { key: 'move.clashTransfer', values: {} };
    default:
      return { key: 'move.clashOther', values: { type: conflict.type } };
  }
}
