import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

import { ServiceContainer } from '../services/ServiceContainer';
import { AuthUser, SignUpResult } from '../services/interfaces/IAuthService';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signInWithFabric: () => Promise<AuthUser>;
  refreshUser: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  usernameAuthEnabled: boolean;
  fabricAuthEnabled: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authService = ServiceContainer.create().authService;

  // Check authentication state on mount; try embedded auth first.
  useEffect(() => {
    authService
      .initEmbeddedAuth()
      .then((embeddedUser) => {
        if (embeddedUser) {
          setUser(embeddedUser);
          return null;
        }
        return authService.getCurrentUser();
      })
      .then((currentUser) => {
        if (currentUser) setUser(currentUser);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [authService]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);

      try {
        const loggedInUser = await authService.signIn(email, password);
        setUser(loggedInUser);
        setLoading(false);
        return loggedInUser;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        setLoading(false);
        throw err;
      }
    },
    [authService]
  );

  const signInWithFabric = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const loggedInUser = await authService.ensureSignedInWithFabric();
      setUser(loggedInUser);
      setLoading(false);
      return loggedInUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      setLoading(false);
      throw err;
    }
  }, [authService]);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  }, [authService]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      setError(null);
      setLoading(true);

      try {
        const result = await authService.signUp(email, password);
        setLoading(false);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Signup failed';
        setError(message);
        setLoading(false);
        throw err;
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

  const contextValue: AuthContextValue = {
    user,
    loading,
    error,
    signInWithFabric,
    refreshUser,
    signIn,
    signUp,
    signOut,
    isAuthenticated: !!user,
    usernameAuthEnabled: authService.usernameAuthEnabled,
    fabricAuthEnabled: authService.fabricAuthEnabled,
  };

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
