import { describe, expect, it } from 'vitest';

import { MemoryRecordStore, readAllPages, toAdjustment, toComment, toSignOff } from './store';

const user = { id: 'u1', email: 'Ana@Contoso.com', name: 'Ana' };

describe('record store', () => {
  it('writes append-only records in the signed-in person\'s name', async () => {
    const store = new MemoryRecordStore(user);
    await store.addAdjustment({ accountId: '6500', month: '2026-11', amount: 1000, reason: 'rent increase', period: '2026-09' });
    await store.addComment({ statement: 'PL', accountId: '6500', month: '2026-09', body: 'true' });
    await store.addSignOff({ month: '2026-09', action: 'sign-off' });
    const r = await store.readAll();
    expect(r.adjustments[0]).toMatchObject({ accountId: '6500', amount: 1000, authorEmail: 'ana@contoso.com' });
    expect(r.comments[0].body).toBe('true');
    expect(r.signOffs[0].action).toBe('sign-off');
  });

  it('keeps texts as texts when the data client converts them (Rayfin 1.36 quirk)', () => {
    const at = new Date('2026-10-05T09:00:00Z');
    // What the real client hands back for a comment "true" and a reason that looks like a date.
    expect(toComment({ id: 'c', statement: 'PL', account_id: '6500', month: '2026-09', body: true as unknown as string, author_email: 'A@x', author_name: 'A', created_at: at }).body).toBe('true');
    const a = toAdjustment({ id: 'a', account_id: '6500', month: '2026-11', amount: '12.5', period: '2026-09', reason: new Date('2026-12-01T00:00:00Z') as unknown as string, author_email: 'A@x', author_name: 'A', created_at: at.toISOString() });
    expect(a.reason).toBe('2026-12-01T00:00:00.000Z');
    expect(a.amount).toBe(12.5);
    expect(a.createdAt.getTime()).toBe(at.getTime());
  });

  it('reads an unknown sign-off action as a reopen, never as a lock', () => {
    expect(toSignOff({ id: 's', month: '2026-09', action: 'SIGN-OFF', author_email: 'a', author_name: 'a', created_at: new Date() }).action).toBe('reopen');
  });

  it('reads every page, and refuses a list that does not end', async () => {
    const pages = [{ items: [1, 2], endCursor: 'x', hasNextPage: true }, { items: [3], hasNextPage: false }];
    let i = 0;
    expect(await readAllPages(async () => pages[i++])).toEqual([1, 2, 3]);
    await expect(readAllPages(async () => ({ items: [1], endCursor: 'same', hasNextPage: true }))).rejects.toThrow('paging-failed');
  });
});
