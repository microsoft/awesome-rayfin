import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_INIT_WAIT_MS, AuthProvider, useAuth } from '@/hooks/AuthContext';
import type { AuthUser, IAuthService } from '@/services/IAuthService';

const USER: AuthUser = { id: 'u1', email: 'uwe@x.example', name: 'Uwe User' };

function Probe() {
  const { loading, isAuthenticated, user } = useAuth();
  return <p>{loading ? 'loading' : isAuthenticated ? `in:${user?.email}` : 'out'}</p>;
}

function service(over: Partial<IAuthService>): IAuthService {
  return {
    fabricAuthEnabled: true,
    signIn: async () => USER,
    signOut: async () => undefined,
    getCurrentUser: async () => null,
    initEmbeddedAuth: async () => null,
    ...over,
  };
}

const show = (authService: IAuthService) =>
  render(
    <AuthProvider authService={authService}>
      <Probe />
    </AuthProvider>
  );

describe('the start of the session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('answers at once when the embedded check does', async () => {
    show(service({ getCurrentUser: async () => USER }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
  });

  it('does not stay on loading when the embedded check never answers, and never treats that as signed in', async () => {
    show(service({ initEmbeddedAuth: () => new Promise(() => undefined) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS - 1);
    });
    expect(screen.getByText('loading')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText('out')).toBeInTheDocument();
  });

  it('in a window of its own, falls back to the session this browser already holds', async () => {
    show(service({ initEmbeddedAuth: () => new Promise(() => undefined), getCurrentUser: async () => USER }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
  });

  it('inside another page, shows the sign-in instead of a session that may belong to someone else', async () => {
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
    const getCurrentUser = vi.fn(async () => USER);
    show(service({ initEmbeddedAuth: () => new Promise(() => undefined), getCurrentUser }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS);
    });
    expect(screen.getByText('out')).toBeInTheDocument();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('after a late failure takes back the kept session it showed, but not a sign-in the person made themselves', async () => {
    let fail: (error: Error) => void = () => undefined;
    const pending = () => new Promise<AuthUser | null>((_resolve, reject) => (fail = reject));

    // The fallback showed the kept session; the check then fails: signed out again.
    const first = show(service({ initEmbeddedAuth: pending, getCurrentUser: async () => USER }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
    await act(async () => {
      fail(new Error('handoff failed'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('out')).toBeInTheDocument();
    first.unmount();

    // The person signed in with the button after the timeout; the late failure leaves them signed in.
    function SignIn() {
      const { signIn } = useAuth();
      return <button onClick={() => void signIn()}>sign in</button>;
    }
    render(
      <AuthProvider authService={service({ initEmbeddedAuth: pending })}>
        <Probe />
        <SignIn />
      </AuthProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS);
    });
    expect(screen.getByText('out')).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'sign in' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
    await act(async () => {
      fail(new Error('handoff failed'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
  });

  it('still takes a late answer of the embedded check', async () => {
    let answer: (user: AuthUser | null) => void = () => undefined;
    show(service({ initEmbeddedAuth: () => new Promise((resolve) => (answer = resolve)) }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTH_INIT_WAIT_MS);
    });
    expect(screen.getByText('out')).toBeInTheDocument();
    await act(async () => {
      answer(USER);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('in:uwe@x.example')).toBeInTheDocument();
  });
});
