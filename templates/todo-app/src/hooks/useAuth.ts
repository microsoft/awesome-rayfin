import { useState, useEffect, useCallback } from 'react';

import { AuthUser } from '../models/AuthUser';
import { ServiceContainer } from '../services/ServiceContainer';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forceRender, setForceRender] = useState(0);

  const authService = ServiceContainer.create().authService;

  // Function to check current auth state
  const checkAuthState = useCallback(async () => {
    try {
      const currentUser = await authService.getCurrentUser();
      console.log('useAuth: Current user from storage:', currentUser);
      setUser(currentUser);
      return currentUser;
    } catch {
      console.log('useAuth: No current user found');
      setUser(null);
      return null;
    }
  }, [authService]);

  // Check authentication state on mount and when forceRender changes
  useEffect(() => {
    console.log('useAuth: Checking authentication state...');
    checkAuthState().finally(() => setLoading(false));
  }, [checkAuthState, forceRender]);

  // Log user state changes
  useEffect(() => {
    console.log('useAuth: User state changed to:', user);
  }, [user]);

  const login = useCallback(
    async (email: string, password: string) => {
      console.log('useAuth: Starting login...');
      setError(null);
      setLoading(true);

      try {
        const loggedInUser = await authService.login(email, password);
        console.log('useAuth: Login successful! User:', loggedInUser);

        // Force React to treat this as a new state by using functional update
        setUser((prevUser) => {
          console.log(
            'useAuth: Setting user via functional update from:',
            prevUser,
            'to:',
            loggedInUser
          );
          return { ...loggedInUser };
        });

        setLoading(false);

        // Force a re-render
        setForceRender((prev) => prev + 1);

        console.log('useAuth: State updated with user copy');
        return loggedInUser;
      } catch (err) {
        console.error('useAuth: Login failed:', err);
        const message = err instanceof Error ? err.message : 'Login failed';
        setError(message);
        setLoading(false);
        throw err;
      }
    },
    [authService]
  );

  const logout = useCallback(async () => {
    console.log('useAuth: Logging out...');
    try {
      await authService.logout();
      setUser(null);
      setError(null);
      setForceRender((prev) => prev + 1);
    } catch (err) {
      console.error('Logout error:', err);
    }
  }, [authService]);

  console.log('useAuth: Current state - user:', !!user, 'loading:', loading);

  return { user, loading, error, login, logout, isAuthenticated: !!user };
}
