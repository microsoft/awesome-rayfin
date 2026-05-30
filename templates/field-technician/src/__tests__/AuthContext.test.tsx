import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthProvider, useAuth } from '../hooks/AuthContext';
import { ServiceContainer } from '../services/ServiceContainer';
import type {
  AuthUser,
  IAuthService,
} from '../services/interfaces/IAuthService';

// Create mock auth service
function createMockAuthService(
  overrides: Partial<IAuthService> = {}
): IAuthService {
  return {
    usernameAuthEnabled: true,
    fabricAuthEnabled: true,
    signUp: vi.fn().mockResolvedValue({ emailVerified: false }),
    signIn: vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    }),
    signOut: vi.fn().mockResolvedValue(undefined),
    getCurrentUser: vi.fn().mockResolvedValue(null),
    isAuthenticated: vi.fn().mockResolvedValue(false),
    initEmbeddedAuth: vi.fn().mockResolvedValue(null),
    initiateFabricLogin: vi.fn().mockResolvedValue(undefined),
    ensureSignedInWithFabric: vi.fn().mockResolvedValue({
      id: 'fabric-user-1',
      email: 'fabric@example.com',
      name: 'Fabric User',
    }),
    ...overrides,
  };
}

// Test component that exposes auth context
function TestAuthConsumer() {
  const { user, loading, error, isAuthenticated, signIn, signUp, signOut } =
    useAuth();

  return (
    <div>
      <div data-testid="loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="error">{error ?? 'none'}</div>
      <div data-testid="is-authenticated">
        {isAuthenticated ? 'true' : 'false'}
      </div>
      <div data-testid="user-email">{user?.email ?? 'none'}</div>
      <button
        onClick={() => signIn('test@example.com', 'password').catch(() => {})}
      >
        Sign In
      </button>
      <button
        onClick={() => signUp('new@example.com', 'password').catch(() => {})}
      >
        Sign Up
      </button>
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  );
}

describe('AuthContext', () => {
  let mockAuthService: IAuthService;

  beforeEach(() => {
    mockAuthService = createMockAuthService();
    vi.spyOn(ServiceContainer, 'create').mockReturnValue({
      authService: mockAuthService,
      userProfileService: {} as never,
      regionService: {} as never,
      customerService: {} as never,
      jobService: {} as never,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('provides initial unauthenticated state', async () => {
    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
    expect(screen.getByTestId('user-email')).toHaveTextContent('none');
  });

  it('restores authenticated user on mount', async () => {
    const existingUser: AuthUser = {
      id: 'user-1',
      email: 'existing@example.com',
      name: 'Existing User',
    };

    mockAuthService.getCurrentUser = vi.fn().mockResolvedValue(existingUser);

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('user-email')).toHaveTextContent(
      'existing@example.com'
    );
  });

  it('signs in user successfully', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    });

    expect(mockAuthService.signIn).toHaveBeenCalledWith(
      'test@example.com',
      'password'
    );
    expect(screen.getByTestId('user-email')).toHaveTextContent(
      'test@example.com'
    );
  });

  it('handles sign in error', async () => {
    mockAuthService.signIn = vi
      .fn()
      .mockRejectedValue(new Error('Invalid credentials'));

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    // Click the button - the error will be caught internally by the context
    await user.click(screen.getByText('Sign In'));

    // Wait for the error to appear in the UI
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent(
        'Invalid credentials'
      );
    });
  });

  it('signs up user successfully', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByText('Sign Up'));

    expect(mockAuthService.signUp).toHaveBeenCalledWith(
      'new@example.com',
      'password'
    );
  });

  it('signs out user successfully', async () => {
    const existingUser: AuthUser = {
      id: 'user-1',
      email: 'existing@example.com',
      name: 'Existing User',
    };

    mockAuthService.getCurrentUser = vi.fn().mockResolvedValue(existingUser);

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    });

    await user.click(screen.getByText('Sign Out'));

    expect(mockAuthService.signOut).toHaveBeenCalled();
    expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
  });
});

describe('useAuth', () => {
  it('throws error when used outside AuthProvider', () => {
    // Suppress console.error for expected error
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestAuthConsumer />);
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleSpy.mockRestore();
  });
});
