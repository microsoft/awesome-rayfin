import { createContext, useContext } from 'react';

import {
  type AuthMode,
  type AuthUser,
  type Credentials,
} from '@/services/IAuthService';

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signIn: (credentials?: Credentials) => Promise<AuthUser>;
  signUp: (credentials: Credentials) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  authMode: AuthMode;
  /** Call when an API request fails due to a stale/expired token. */
  handleSessionExpired: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

