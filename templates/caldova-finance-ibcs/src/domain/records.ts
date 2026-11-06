import type { Adjustment } from './engine';
import type { Statement } from './types';

/** The controlling team's records, as the app uses them (rayfin/data/*.ts on the wire). */
export interface AdjustmentRecord extends Adjustment {
  id: string;
  /** The close it was written in: the last closed month at that time. */
  period: string;
  reason: string;
  authorEmail: string;
  authorName: string;
  createdAt: Date;
}

export interface CommentRecord {
  id: string;
  statement: Statement;
  accountId: string;
  month: string;
  body: string;
  authorEmail: string;
  authorName: string;
  createdAt: Date;
}

export type SignOffAction = 'sign-off' | 'reopen';

export interface SignOffRecord {
  id: string;
  month: string;
  action: SignOffAction;
  note?: string;
  /** Sign-off only: the adjustments it freezes. */
  frozenIds?: string[];
  authorEmail: string;
  authorName: string;
  createdAt: Date;
}

export interface Records {
  adjustments: AdjustmentRecord[];
  comments: CommentRecord[];
  signOffs: SignOffRecord[];
  /** When the records were read; shown as "as of". */
  readAt: Date;
}

export type NewAdjustment = Pick<AdjustmentRecord, 'accountId' | 'month' | 'amount' | 'reason' | 'period'>;
export type NewComment = Pick<CommentRecord, 'statement' | 'accountId' | 'month' | 'body'>;
export type NewSignOff = Pick<SignOffRecord, 'month' | 'action' | 'note' | 'frozenIds'>;

/** Where the records live: Rayfin data in Fabric, or memory for the offline demo and the tests. */
export interface RecordStore {
  readAll(): Promise<Records>;
  addAdjustment(a: NewAdjustment): Promise<AdjustmentRecord>;
  addComment(c: NewComment): Promise<CommentRecord>;
  addSignOff(s: NewSignOff): Promise<SignOffRecord>;
}
