// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pinned = vi.fn((): string | null => null);
const token = vi.fn(async (_scopeSet: string) => 'tok');
const send = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));

vi.mock('@/um/services/graphAuth', () => ({ getPinnedObjectId: () => pinned(), getGraphToken: (scopeSet: string) => token(scopeSet) }));
vi.mock('@/um/services/graphWrite', () => ({ writeMember: (...args: unknown[]) => send(...args) }));

const { GraphMemberWriter } = await import('@/um/services/graphMemberWriter');

const ACTOR = 'aaaaaaaa-0000-4000-8000-' + '000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-' + '000000000002';
const GROUP = 'bbbbbbbb-0000-4000-8000-' + '000000000001';
const USER = 'cccccccc-0000-4000-8000-' + '000000000001';

beforeEach(() => {
  pinned.mockReset();
  token.mockClear();
  send.mockClear();
});

/** The account whose token writes must be the person the app shows and logs as acting. */
describe('Graph member writer', () => {
  it('writes with the member-change permission when the pinned account is the actor', async () => {
    pinned.mockReturnValue(ACTOR);
    expect(await new GraphMemberWriter().write('add', GROUP, USER, ACTOR.toUpperCase())).toEqual({ ok: true });
    expect(token).toHaveBeenCalledWith('memberChange');
    expect(send).toHaveBeenCalledWith('add', GROUP, USER, 'tok');
  });

  it('sends nothing when the tab is connected as someone else', async () => {
    pinned.mockReturnValue(OTHER);
    expect(await new GraphMemberWriter().write('add', GROUP, USER, ACTOR)).toEqual({ ok: false, code: 'actor-mismatch' });
    expect(token).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when the account changes while the token is fetched', async () => {
    pinned.mockReturnValueOnce(ACTOR).mockReturnValue(OTHER);
    expect(await new GraphMemberWriter().write('remove', GROUP, USER, ACTOR)).toEqual({ ok: false, code: 'actor-mismatch' });
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a missing permission as denied and sends nothing', async () => {
    pinned.mockReturnValue(ACTOR);
    token.mockRejectedValueOnce(new Error('interaction required'));
    expect(await new GraphMemberWriter().write('add', GROUP, USER, ACTOR)).toEqual({ ok: false, code: 'denied' });
    expect(send).not.toHaveBeenCalled();
  });
});
