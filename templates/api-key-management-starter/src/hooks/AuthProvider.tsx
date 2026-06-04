import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  type AuthUser,
  type Credentials,
  type IAuthService,
} from '@/services/IAuthService';
import { setGlobalSessionExpiredHandler } from '@/services/sessionExpiredHandler';

import { AuthContext, type AuthContextValue } from './AuthContext';

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
    authService
      .initEmbeddedAuth()
      .then((embedded) => embedded ?? authService.getCurrentUser())
      .then((current) => {
        if (!cancelled && current) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authService]);

  const signIn = useCallback(
    async (credentials?: Credentials) => {
      setError(null);
      setLoading(true);
      try {
        const loggedInUser = await authService.signIn(credentials);
        setUser(loggedInUser);
        return loggedInUser;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const signUp = useCallback(
    async (credentials: Credentials) => {
      setError(null);
      setLoading(true);
      try {
        const newUser = await authService.signUp(credentials);
        setUser(newUser);
        return newUser;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Registration failed';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [authService]
  );

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
      setUser(null);
      setError(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, [authService]);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setError('Your session has expired. Please sign in again.');
  }, []);

  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      try {
        const current = await authService.getCurrentUser();
        if (!current) {
          handleSessionExpired();
        }
      } catch {
        handleSessionExpired();
      }
    }, 5_000);

    return () => clearInterval(interval);
  }, [user, authService, handleSessionExpired]);

  useEffect(() => {
    setGlobalSessionExpiredHandler(handleSessionExpired);
  }, [handleSessionExpired]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      isAuthenticated: !!user,
      authMode: authService.authMode,
      handleSessionExpired,
    }),
    [
      user,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      authService,
      handleSessionExpired,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
