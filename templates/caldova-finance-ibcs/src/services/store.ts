/**
 * The controlling team's records: forecast adjustments, comments and close sign-offs.
 *
 * Two implementations behind one interface: Rayfin data (Fabric SQL database) for a deployment, memory
 * (optionally kept in localStorage) for the offline demo and the tests. Both are append-only.
 */
import type {
  AdjustmentRecord,
  CommentRecord,
  NewAdjustment,
  NewComment,
  NewSignOff,
  RecordStore,
  Records,
  SignOffAction,
  SignOffRecord,
} from '@/domain/records';
import type { Statement } from '@/domain/types';
import type { AuthUser } from '@/services/IAuthService';
import { getRayfinClient } from '@/services/rayfinClient';

/** A write the data API refused, typically a row policy (not a controller, or not your own name). */
export class WriteRefusedError extends Error {
  constructor(readonly entity: string, cause: unknown) {
    super(`The data service refused the ${entity} record.`);
    this.name = 'WriteRefusedError';
    this.cause = cause;
  }
}

const REASON_MAX = 500;
const BODY_MAX = 1000;

/* ───────────────────────────── conversions ───────────────────────────── */

/**
 * A text field as text. The data client converts stored texts on the way out: "true" and "false" become
 * booleans, and anything shaped like an ISO date becomes a Date (Rayfin 1.36). Months are stored as
 * `YYYY-MM`, which it leaves alone, but comments and reasons can be anything.
 */
export function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

function when(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(text(value));
  // Unparsable: far future, so it never sorts before a sign-off.
  return Number.isNaN(d.getTime()) ? new Date(8.64e15) : d;
}

const STATEMENTS: readonly Statement[] = ['PL', 'BS', 'CF'];
const statementOf = (v: unknown): Statement => ((STATEMENTS as readonly string[]).includes(text(v)) ? (text(v) as Statement) : 'PL');
// Anything unknown reads as a reopen: it never locks a close by accident.
const actionOf = (v: unknown): SignOffAction => (text(v) === 'sign-off' ? 'sign-off' : 'reopen');

interface AdjustmentRow {
  id: string;
  account_id: string;
  month: string;
  amount: number | string;
  period: string;
  reason: string;
  author_email: string;
  author_name: string;
  created_at: Date | string;
}
interface CommentRow {
  id: string;
  statement: string;
  account_id: string;
  month: string;
  body: string;
  author_email: string;
  author_name: string;
  created_at: Date | string;
}
interface SignOffRow {
  id: string;
  month: string;
  action: string;
  note?: string | null;
  frozen_ids?: string | null;
  author_email: string;
  author_name: string;
  created_at: Date | string;
}

export const toAdjustment = (r: AdjustmentRow): AdjustmentRecord => ({
  id: text(r.id),
  accountId: text(r.account_id),
  month: text(r.month),
  amount: Number(r.amount),
  period: text(r.period),
  reason: text(r.reason),
  authorEmail: text(r.author_email).toLowerCase(),
  authorName: text(r.author_name),
  createdAt: when(r.created_at),
});
export const toComment = (r: CommentRow): CommentRecord => ({
  id: text(r.id),
  statement: statementOf(r.statement),
  accountId: text(r.account_id),
  month: text(r.month),
  body: text(r.body),
  authorEmail: text(r.author_email).toLowerCase(),
  authorName: text(r.author_name),
  createdAt: when(r.created_at),
});
export const toSignOff = (r: SignOffRow): SignOffRecord => ({
  id: text(r.id),
  month: text(r.month),
  action: actionOf(r.action),
  note: r.note === null || r.note === undefined ? undefined : text(r.note),
  frozenIds: text(r.frozen_ids).split(',').map((s) => s.trim()).filter(Boolean),
  authorEmail: text(r.author_email).toLowerCase(),
  authorName: text(r.author_name),
  createdAt: when(r.created_at),
});

/* ───────────────────────────── memory ───────────────────────────── */

interface MemoryState {
  adjustments: AdjustmentRow[];
  comments: CommentRow[];
  signOffs: SignOffRow[];
}

/** In-memory store for the offline demo and the tests. With a storage key it survives a reload. */
export class MemoryRecordStore implements RecordStore {
  private state: MemoryState = { adjustments: [], comments: [], signOffs: [] };
  private counter = 0;

  constructor(
    private readonly user: AuthUser,
    private readonly storageKey?: string,
    private readonly now: () => Date = () => new Date()
  ) {
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) this.state = JSON.parse(raw) as MemoryState;
      } catch {
        /* a broken or blocked store starts empty */
      }
    }
  }

  private save() {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* the demo keeps working without persistence */
    }
  }

  private id() {
    this.counter += 1;
    return `mem-${this.now().getTime()}-${this.counter}`;
  }

  private author() {
    return { author_email: this.user.email.toLowerCase(), author_name: this.user.name, created_at: this.now().toISOString() };
  }

  async readAll(): Promise<Records> {
    return {
      adjustments: this.state.adjustments.map(toAdjustment),
      comments: this.state.comments.map(toComment),
      signOffs: this.state.signOffs.map(toSignOff),
      readAt: this.now(),
    };
  }

  async addAdjustment(a: NewAdjustment) {
    const row: AdjustmentRow = {
      id: this.id(),
      account_id: a.accountId,
      month: a.month,
      amount: a.amount,
      period: a.period,
      reason: a.reason.slice(0, REASON_MAX),
      ...this.author(),
    };
    this.state.adjustments.push(row);
    this.save();
    return toAdjustment(row);
  }

  async addComment(c: NewComment) {
    const row: CommentRow = { id: this.id(), statement: c.statement, account_id: c.accountId, month: c.month, body: c.body.slice(0, BODY_MAX), ...this.author() };
    this.state.comments.push(row);
    this.save();
    return toComment(row);
  }

  async addSignOff(s: NewSignOff) {
    const row: SignOffRow = { id: this.id(), month: s.month, action: s.action, note: s.note?.slice(0, REASON_MAX), frozen_ids: s.frozenIds?.join(','), ...this.author() };
    this.state.signOffs.push(row);
    this.save();
    return toSignOff(row);
  }
}

/* ───────────────────────────── Rayfin ───────────────────────────── */

export const PAGE_LIMITS = { size: 200, pages: 100 } as const;

export interface Page<T> {
  items: T[];
  endCursor?: string | null;
  hasNextPage: boolean;
}

/**
 * Read a whole table page by page. A plain list query returns only the first page; an incomplete list must
 * never be used as if it were complete (a missing sign-off would unlock a close).
 */
export async function readAllPages<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMITS.pages; page++) {
    const result = await fetchPage(cursor);
    all.push(...result.items);
    if (!result.hasNextPage) return all;
    if (!result.endCursor || seen.has(result.endCursor)) throw new Error('paging-failed');
    seen.add(result.endCursor);
    cursor = result.endCursor;
  }
  throw new Error('paging-limit');
}

/** The chainable query surface of the data client that paging needs. */
interface PagedQuery {
  orderBy(order: Record<string, 'asc' | 'desc'>): PagedQuery;
  first(count: number): PagedQuery;
  after(cursor: string): PagedQuery;
  executePaginated(): Promise<unknown>;
}
interface PagedEntity {
  select(fields: readonly string[]): PagedQuery;
  create(values: Record<string, unknown>): Promise<unknown>;
}

// Without select() the client returns only the id of each row (Rayfin 1.36).
const FIELDS = {
  FcAdjustment: ['id', 'account_id', 'month', 'amount', 'period', 'reason', 'author_email', 'author_name', 'created_at'],
  LineComment: ['id', 'statement', 'account_id', 'month', 'body', 'author_email', 'author_name', 'created_at'],
  MonthSignOff: ['id', 'month', 'action', 'note', 'frozen_ids', 'author_email', 'author_name', 'created_at'],
} as const;

export class RayfinRecordStore implements RecordStore {
  constructor(private readonly user: AuthUser) {}

  private entity(name: keyof typeof FIELDS): PagedEntity {
    return getRayfinClient().data[name] as unknown as PagedEntity;
  }

  private all<R>(name: keyof typeof FIELDS): Promise<R[]> {
    return readAllPages<R>(async (cursor) => {
      let q = this.entity(name).select(FIELDS[name]).orderBy({ id: 'asc' }).first(PAGE_LIMITS.size);
      if (cursor) q = q.after(cursor);
      return (await q.executePaginated()) as Page<R>;
    });
  }

  private async create(name: keyof typeof FIELDS, values: Record<string, unknown>) {
    const row = {
      ...values,
      // The row policy compares this with the caller's email claim: it must be the signed-in address.
      author_email: this.user.email.toLowerCase(),
      author_name: this.user.name.slice(0, 256),
      created_at: new Date(),
    };
    let created: { id?: string } | undefined;
    try {
      created = (await this.entity(name).create(row)) as { id?: string };
    } catch (err) {
      throw new WriteRefusedError(name, err);
    }
    // The answer to a write carries only what was written; the id is enough, the rest is ours.
    return { ...row, id: text(created?.id), created_at: row.created_at };
  }

  async readAll(): Promise<Records> {
    const [a, c, s] = await Promise.all([
      this.all<AdjustmentRow>('FcAdjustment'),
      this.all<CommentRow>('LineComment'),
      this.all<SignOffRow>('MonthSignOff'),
    ]);
    return { adjustments: a.map(toAdjustment), comments: c.map(toComment), signOffs: s.map(toSignOff), readAt: new Date() };
  }

  async addAdjustment(a: NewAdjustment) {
    const row = await this.create('FcAdjustment', {
      account_id: a.accountId,
      month: a.month,
      amount: Math.round(a.amount * 100) / 100,
      period: a.period,
      reason: a.reason.slice(0, REASON_MAX),
    });
    return toAdjustment(row as unknown as AdjustmentRow);
  }

  async addComment(c: NewComment) {
    const row = await this.create('LineComment', { statement: c.statement, account_id: c.accountId, month: c.month, body: c.body.slice(0, BODY_MAX) });
    return toComment(row as unknown as CommentRow);
  }

  async addSignOff(s: NewSignOff) {
    const row = await this.create('MonthSignOff', { month: s.month, action: s.action, note: s.note?.slice(0, REASON_MAX), frozen_ids: s.frozenIds?.join(',') ?? '' });
    return toSignOff(row as unknown as SignOffRow);
  }
}
