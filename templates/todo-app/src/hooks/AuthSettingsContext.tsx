import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useMemo,
} from 'react';

/**
 * Available authentication methods.
 * Matches the AuthMethod type from \@microsoft/rayfin-auth.
 */
export type AuthMethod = 'password' | 'magiclink' | 'fabric';

/**
 * Authentication settings configuration returned by the backend.
 * Matches the AuthSettingsConfig type from \@microsoft/rayfin-auth.
 */
export interface AuthSettingsConfig {
  enabled: boolean;
  password: { enabled: boolean };
  passwordless: { magicLink: { enabled: boolean } };
  fabric?: { enabled: boolean };
  availableMethods: AuthMethod[];
}

/**
 * Auth settings state for the context
 */
interface AuthSettingsState {
  /** Whether auth settings have been loaded */
  loading: boolean;
  /** Auth settings from the backend (null if not loaded or in mock mode) */
  settings: AuthSettingsConfig | null;
  /** Error message if fetching settings failed */
  error: string | null;
}

/**
 * Auth settings context value including computed helpers
 */
interface AuthSettingsContextValue extends AuthSettingsState {
  /** Whether password authentication is available */
  isPasswordAuthAvailable: boolean;
  /** Whether magic link authentication is available */
  isMagicLinkAuthAvailable: boolean;
  /** Whether Fabric brokered authentication is available */
  isFabricAuthAvailable: boolean;
  /** List of available authentication methods */
  availableMethods: AuthMethod[];
}

const AuthSettingsContext = createContext<AuthSettingsContextValue | undefined>(
  undefined
);

interface AuthSettingsProviderProps {
  children: ReactNode;
}

/** Default auth settings - all methods enabled */
const DEFAULT_AUTH_SETTINGS: AuthSettingsConfig = {
  enabled: true,
  password: { enabled: true },
  passwordless: { magicLink: { enabled: true } },
  fabric: { enabled: true },
  availableMethods: ['password', 'magiclink', 'fabric'],
};

/** Provides auth settings to the component tree. */
export function AuthSettingsProvider({ children }: AuthSettingsProviderProps) {
  const [state, setState] = useState<AuthSettingsState>({
    loading: true,
    settings: null,
    error: null,
  });

  useEffect(() => {
    setState({
      loading: false,
      settings: DEFAULT_AUTH_SETTINGS,
      error: null,
    });
  }, []);

  // Compute derived values
  const contextValue = useMemo<AuthSettingsContextValue>(() => {
    const settings = state.settings || DEFAULT_AUTH_SETTINGS;
    return {
      ...state,
      isPasswordAuthAvailable: settings.password.enabled,
      isMagicLinkAuthAvailable: settings.passwordless.magicLink.enabled,
      isFabricAuthAvailable: settings.fabric?.enabled ?? false,
      availableMethods: settings.availableMethods,
    };
  }, [state]);

  return (
    <AuthSettingsContext.Provider value={contextValue}>
      {children}
    </AuthSettingsContext.Provider>
  );
}

/**
 * Hook to access auth settings from the context.
 *
 * @example
 * ```tsx
 * function AuthPage() {
 *   const { isPasswordAuthAvailable, isMagicLinkAuthAvailable, loading } = useAuthSettings();
 *
 *   if (loading) {
 *     return <LoadingSpinner />;
 *   }
 *
 *   return (
 *     <div>
 *       {isPasswordAuthAvailable && <LoginForm />}
 *       {isMagicLinkAuthAvailable && <MagicLinkForm />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAuthSettings(): AuthSettingsContextValue {
  const context = useContext(AuthSettingsContext);
  if (context === undefined) {
    throw new Error(
      'useAuthSettings must be used within an AuthSettingsProvider'
    );
  }
  return context;
}
