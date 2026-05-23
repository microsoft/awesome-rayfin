import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

import { AuthStateObserver } from '../components/AuthStateObserver';
import { AuthUser } from '../models/AuthUser';
import { ServiceContainer } from '../services/ServiceContainer';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authService = ServiceContainer.create().authService;

  // Check authentication state on mount
  useEffect(() => {
    console.log('AuthProvider: Initial auth check...');
    authService
      .getCurrentUser()
      .then((currentUser) => {
        console.log('AuthProvider: Current user from storage:', currentUser);
        if (currentUser) {
          setUser(currentUser);
          return;
        }

        // No existing session — try embedded auto-login (no-op if not embedded)
        return authService.initEmbeddedAuth().then((embeddedUser) => {
          if (embeddedUser) {
            console.log('AuthProvider: Embedded auto-login succeeded');
          }
          setUser(embeddedUser);
        });
      })
      .catch((err) => {
        console.log('AuthProvider: Auth init failed:', err);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [authService]);

  // Log user state changes
  useEffect(() => {
    console.log('AuthProvider: User state changed to:', user);
  }, [user]);

  const login = useCallback(
    async (email: string, password: string) => {
      console.log('AuthProvider: Starting login...');
      setError(null);
      setLoading(true);

      try {
        const loggedInUser = await authService.login(email, password);
        console.log('AuthProvider: Login successful! User:', loggedInUser);

        setUser(loggedInUser);
        setLoading(false);

        console.log('AuthProvider: State updated');
        return loggedInUser;
      } catch (err) {
        console.error('AuthProvider: Login failed:', err);
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        setLoading(false);
        throw err;
      }
    },
    [authService]
  );

  const logout = useCallback(async () => {
    console.log('AuthProvider: Logging out...');
    try {
      await authService.logout();
      setUser(null);
      setError(null);
    } catch (err) {
      console.error('AuthProvider: Logout error:', err);
    }
  }, [authService]);

  const refreshUser = useCallback(async () => {
    console.log('AuthProvider: Refreshing user...');
    try {
      const currentUser = await authService.getCurrentUser();
      console.log('AuthProvider: Refreshed user:', currentUser);
      setUser(currentUser);
    } catch (err) {
      console.error('AuthProvider: Refresh user error:', err);
      setUser(null);
    }
  }, [authService]);

  const contextValue: AuthContextType = {
    user,
    loading,
    error,
    login,
    logout,
    refreshUser,
    isAuthenticated: !!user,
  };

  console.log(
    'AuthProvider: Rendering with user:',
    !!user,
    'loading:',
    loading
  );

  const handleAuthStateChange = useCallback(
    (isAuthenticated: boolean) => {
      if (!isAuthenticated && user) {
        // User has been logged out
        setUser(null);
      } else if (isAuthenticated && !user) {
        // User has been logged in, but we need to fetch the details
        authService
          .getCurrentUser()
          .then((currentUser) => {
            if (currentUser) {
              setUser(currentUser);
            }
          })
          .catch((err) => {
            console.error('Error getting current user:', err);
          });
      }
    },
    [user, authService]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      <AuthStateObserver onAuthStateChange={handleAuthStateChange} />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  console.log(
    'useAuth: Hook called, returning user:',
    !!context.user,
    'loading:',
    context.loading
  );
  return context;
}
