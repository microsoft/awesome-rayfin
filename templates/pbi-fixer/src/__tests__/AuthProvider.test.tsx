import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '@/hooks/AuthContext';
import type { IAuthService } from '@/services/IAuthService';

const stubAuthService: IAuthService = {
  fabricAuthEnabled: false,
  async signIn() {
    return { id: 'u1', email: 'dev@contoso.com', name: 'dev' };
  },
  async signOut() {},
  async getCurrentUser() {
    return null;
  },
  async initEmbeddedAuth() {
    return null;
  },
};

describe('AuthProvider', () => {
  it('renders children once initial auth check completes', async () => {
    render(
      <AuthProvider authService={stubAuthService}>
        <div data-testid="content">ready</div>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('content')).toHaveTextContent('ready');
    });
  });
});
