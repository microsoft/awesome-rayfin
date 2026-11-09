import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { type AuthUser, type IAuthService } from '@/services/IAuthService';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<AuthUser>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  fabricAuthEnabled: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** How long the start waits for the embedded sign-in check before it shows what it has. */
export const AUTH_INIT_WAIT_MS = 15_000;

/** True when the app runs inside another page. Unknown counts as inside. */
function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

interface AuthProviderProps {
  children: ReactNode;
  authService: IAuthService;
}

export function AuthProvider({ children, authService }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let answered = false;
    let timedOut = false;
    /** The session the fallback put on screen, if any. */
    let fromFallback: AuthUser | null = null;
    // The embedded check normally answers at once. If it does not, the app
    // must not stay on "loading" for good (seen live once, 2026-10-10).
    const timer = setTimeout(() => {
      if (cancelled || answered) return;
      timedOut = true;
      // No answer is never "signed in". In a window of its own the session
      // this browser already holds is what the check would have fallen back
      // to anyway. Inside another page (embedded in Fabric) a kept session
      // could belong to the previous person, so there the sign-in page is
      // shown instead.
      const cached = isFramed() ? Promise.resolve(null) : authService.getCurrentUser();
      cached
        .then((current) => {
          if (cancelled || answered) return;
          if (current) {
            fromFallback = current;
            setUser(current);
          }
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled && !answered) setLoading(false);
        });
    }, AUTH_INIT_WAIT_MS);

    authService
      .initEmbeddedAuth()
      .then((embedded) => embedded ?? authService.getCurrentUser())
      .then((current) => {
        answered = true;
        // A late answer still counts: it is the real one.
        if (!cancelled && current) setUser(current);
      })
      .catch(() => {
        answered = true;
        if (cancelled) return;
        // In time: not signed in, as before. Late: the check takes back only
        // what the fallback showed in its place. Someone who signed in with
        // the button in the meantime stays signed in.
        if (!timedOut) setUser(null);
        else setUser((prev) => (prev !== null && prev === fromFallback ? null : prev));
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authService]);

  const signIn = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const loggedInUser = await authService.signIn();
      setUser(loggedInUser);
      return loggedInUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authService]);

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
      setUser(null);
      setError(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signIn,
      signOut,
      isAuthenticated: !!user,
      fabricAuthEnabled: authService.fabricAuthEnabled,
    }),
    [user, loading, error, signIn, signOut, authService]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
