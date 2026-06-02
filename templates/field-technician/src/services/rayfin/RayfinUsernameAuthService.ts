import {
  AuthUser,
  IUsernameAuthService,
  SignUpResult,
} from '../interfaces/IAuthService';

import { getRayfinClient } from './RayfinClientService';

export class RayfinUsernameAuthService implements IUsernameAuthService {
  async signUp(email: string, password: string): Promise<SignUpResult> {
    try {
      const client = getRayfinClient();
      const response = await client.auth.signUp({ email, password });
      return { emailVerified: response.emailVerified };
    } catch (error: unknown) {
      console.error('RayfinUsernameAuthService signUp error:', error);

      // Check for duplicate email (HTTP 409)
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 409
      ) {
        throw new Error('An account with this email already exists.');
      }

      throw new Error('Signup failed. Please try again.');
    }
  }

  async signIn(email: string, password: string): Promise<AuthUser> {
    try {
      const client = getRayfinClient();
      await client.auth.signIn({ email, password });

      const session = client.auth.getSession();

      if (!session.isAuthenticated || !session.user) {
        throw new Error('Failed to establish session');
      }

      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.email.split('@')[0],
      };
    } catch (error: unknown) {
      console.error('RayfinUsernameAuthService signIn error:', error);

      if (error && typeof error === 'object' && 'status' in error) {
        if (error.status === 403) {
          throw new Error(
            'Please verify your email before signing in. Check your inbox for the verification link.'
          );
        }
        if (error.status === 401) {
          throw new Error('Invalid email or password.');
        }
      }

      throw new Error('Login failed. Please check your credentials.');
    }
  }
}
