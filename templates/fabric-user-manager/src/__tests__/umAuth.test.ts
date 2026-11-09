import { beforeEach, describe, expect, it, vi } from 'vitest';

const g = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number, username: string) => ({ localAccountId: g(n), tenantId: g(900), username, homeAccountId: `${g(n)}.${g(900)}`, environment: 'login.microsoftonline.com' });
const ANNA = account(1, 'anna@x.example');
const BEN = account(2, 'ben@x.example');

const silent = vi.fn();
const popup = vi.fn();
const accounts = vi.fn((): unknown[] => []);
const created = vi.fn();

vi.mock('@azure/msal-browser', () => ({
  PublicClientApplication: class {
    constructor(config: unknown) {
      created(config);
    }
    initialize = async () => {};
    getAllAccounts = () => accounts();
    acquireTokenSilent = (request: unknown) => silent(request);
    acquireTokenPopup = (request: unknown) => popup(request);
  },
}));

vi.mock('@/um/config/umEnv', async (original) => ({
  ...(await original<typeof import('@/um/config/umEnv')>()),
  getUmEnv: () => ({ tenantId: g(900), clientId: g(901), mock: false }),
}));

const auth = await import('@/um/services/graphAuth');

beforeEach(() => {
  silent.mockReset();
  popup.mockReset();
  accounts.mockReset().mockReturnValue([]);
  auth.resetGraphAccount();
});

/**
 * One account per tab (review finding 1). The identity is read once from
 * Graph `/me`; every later token must belong to that same account.
 */
describe('Graph sign-in', () => {
  it('keeps tokens in session storage', async () => {
    popup.mockResolvedValue({ account: ANNA, accessToken: 't' });
    await auth.getGraphToken('base', { interactive: true });
    expect(created.mock.calls[0][0]).toMatchObject({ cache: { cacheLocation: 'sessionStorage' } });
  });

  it('never falls back to the first cached account', async () => {
    accounts.mockReturnValue([BEN]);
    await expect(auth.getGraphToken('base', { loginHint: 'anna@x.example' })).rejects.toBeInstanceOf(auth.GraphSignInRequiredError);
    expect(silent).not.toHaveBeenCalled();
    await expect(auth.getGraphToken('base')).rejects.toBeInstanceOf(auth.GraphSignInRequiredError);
  });

  it('uses the cached account that matches the hint, without a popup', async () => {
    accounts.mockReturnValue([BEN, ANNA]);
    silent.mockResolvedValue({ account: ANNA, accessToken: 'silent-token' });
    expect(await auth.getGraphToken('base', { loginHint: 'Anna@X.example' })).toBe('silent-token');
    expect(silent.mock.calls[0][0]).toMatchObject({ account: ANNA });
    expect(popup).not.toHaveBeenCalled();
    expect(auth.getPinnedObjectId()).toBe(g(1));
  });

  it('opens a popup only when asked to, and pins the account it returns', async () => {
    await expect(auth.getGraphToken('base')).rejects.toBeInstanceOf(auth.GraphSignInRequiredError);
    expect(popup).not.toHaveBeenCalled();
    popup.mockResolvedValue({ account: ANNA, accessToken: 'popup-token' });
    expect(await auth.getGraphToken('base', { interactive: true, loginHint: 'anna@x.example' })).toBe('popup-token');
    expect(auth.getPinnedObjectId()).toBe(g(1));
  });

  it('throws away a later token that belongs to a different account', async () => {
    popup.mockResolvedValueOnce({ account: ANNA, accessToken: 'anna-base' });
    await auth.getGraphToken('base', { interactive: true });

    // The directory scope needs a popup, and the person picks Ben there.
    silent.mockRejectedValue(new Error('interaction_required'));
    popup.mockResolvedValueOnce({ account: BEN, accessToken: 'ben-directory' });
    await expect(auth.getGraphToken('directory', { interactive: true })).rejects.toBeInstanceOf(auth.GraphAccountMismatchError);
    // The popup was asked for the pinned account, and the pin did not move.
    expect(popup.mock.calls[1][0]).toMatchObject({ account: ANNA });
    expect(auth.getPinnedObjectId()).toBe(g(1));
  });

  it('rejects a silent token for another account instead of opening a popup', async () => {
    popup.mockResolvedValueOnce({ account: ANNA, accessToken: 'anna-base' });
    await auth.getGraphToken('base', { interactive: true });
    silent.mockResolvedValue({ account: BEN, accessToken: 'ben-silent' });
    await expect(auth.getGraphToken('directory', { interactive: true })).rejects.toBeInstanceOf(auth.GraphAccountMismatchError);
    expect(popup).toHaveBeenCalledTimes(1);
  });

  it('forgets the account on reset, so a new person starts clean', async () => {
    popup.mockResolvedValueOnce({ account: ANNA, accessToken: 'a' });
    await auth.getGraphToken('base', { interactive: true });
    auth.resetGraphAccount();
    expect(auth.getPinnedObjectId()).toBeNull();
    popup.mockResolvedValueOnce({ account: BEN, accessToken: 'b' });
    expect(await auth.getGraphToken('base', { interactive: true })).toBe('b');
    expect(auth.getPinnedObjectId()).toBe(g(2));
  });

  it('requests only the scopes of the set asked for', async () => {
    popup.mockResolvedValue({ account: ANNA, accessToken: 't' });
    await auth.getGraphToken('base', { interactive: true });
    expect(popup.mock.calls[0][0].scopes).toEqual(['https://graph.microsoft.com/User.Read']);
    silent.mockRejectedValue(new Error('interaction_required'));
    await auth.getGraphToken('directory', { interactive: true });
    expect(popup.mock.calls[1][0].scopes).toEqual(['https://graph.microsoft.com/GroupMember.Read.All', 'https://graph.microsoft.com/User.ReadBasic.All']);
    const all = popup.mock.calls.flatMap((c) => c[0].scopes as string[]).join(' ');
    expect(all).not.toMatch(/ReadWrite/);
  });
});
