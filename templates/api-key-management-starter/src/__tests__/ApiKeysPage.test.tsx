import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/hooks/AuthContext';
import { ApiKeysPage } from '@/pages/ApiKeysPage';

vi.mock('@/services/apiKeys', () => ({
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(async () => {
    throw new Error('expired session');
  }),
  revokeApiKey: vi.fn(),
}));

const authValue: AuthContextValue = {
  user: { id: 'user-1', email: 'dev@contoso.com', name: 'Dev' },
  loading: false,
  error: null,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  isAuthenticated: true,
  authMode: 'password',
  handleSessionExpired: vi.fn(),
};

describe('ApiKeysPage', () => {
  it('shows an error and stops loading when keys fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AuthContext.Provider value={authValue}>
        <ApiKeysPage />
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(
        screen.getByText('Failed to fetch API keys. Please check your session.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
