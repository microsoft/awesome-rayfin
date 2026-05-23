import { AuthUser } from '../../models/AuthUser';
import {
  IAuthService,
  MagicLinkCallbackResult,
  MagicLinkSendResult,
  SignUpResult,
} from '../interfaces/IAuthService';

import { getRayfinClient } from './RayfinClientService';

/**
 * Implementation of IAuthService using Rayfin client
 *
 * NOTE: This service requires a running backend API that implements
 * the authentication endpoints. When no backend is available,
 * use the mock implementation through ServiceContainer.create('mock')
 */
export class RayfinAuthService implements IAuthService {
  async signUp(email: string, password: string): Promise<SignUpResult> {
    try {
      const client = getRayfinClient();
      const response = await client.auth.signUp({ email, password });
      return { emailVerified: response.emailVerified };
    } catch (error: any) {
      console.error('RayfinAuthService signUp error:', error);

      // Check for duplicate email (HTTP 409)
      if (error.status === 409) {
        throw new Error('An account with this email already exists.');
      }

      // Generic fallback error
      throw new Error('Signup failed. Please try again.');
    }
  }

  async login(email: string, password: string): Promise<AuthUser> {
    try {
      const client = getRayfinClient();
      await client.auth.signIn({ email, password });

      // Get user info from the session (opaque, doesn't expose tokens)
      const session = client.auth.getSession();

      if (!session.isAuthenticated || !session.user) {
        throw new Error('Failed to establish session');
      }

      // Map from session to our User model
      return {
        Id: session.user.id,
        Email: session.user.email,
        Name: session.user.email.split('@')[0], // Simple fallback if name not provided
      };
    } catch (error: any) {
      console.error('RayfinAuthService login error:', error);

      // Check for email not verified error (HTTP 403 from backend)
      if (error.status === 403 || error.code === 'EMAIL_NOT_VERIFIED') {
        throw new Error(
          'Please verify your email before signing in. Check your inbox for the verification link.'
        );
      }

      // Check for invalid credentials (HTTP 401)
      if (error.status === 401) {
        throw new Error('Invalid email or password.');
      }

      // Generic fallback error
      throw new Error('Login failed. Please check your credentials.');
    }
  }

  async logout(): Promise<void> {
    try {
      const client = getRayfinClient();
      await client.auth.signOut();
    } catch (error) {
      console.error('RayfinAuthService logout error:', error);
      throw new Error('Logout failed.');
    }
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const client = getRayfinClient();
    const session = client.auth.getSession();
    if (!session || !session.user) {
      return null;
    }

    return {
      Id: session.user.id,
      Email: session.user.email,
      Name: session.user.email.split('@')[0], // Simple fallback
    };
  }

  async isAuthenticated(): Promise<boolean> {
    const client = getRayfinClient();
    const session = client.auth.getSession();
    return !!session;
  }

  async verifyEmail(token: string): Promise<void> {
    try {
      const client = getRayfinClient();
      await client.auth.verifyEmail(token);
    } catch (error: any) {
      console.error('RayfinAuthService verifyEmail error:', error);

      // Check for expired token
      if (error.status === 400 || error.message?.includes('expired')) {
        throw new Error(
          'Verification link has expired. Please request a new one.'
        );
      }

      // Check for invalid token
      if (error.status === 404 || error.message?.includes('invalid')) {
        throw new Error('Invalid verification link.');
      }

      throw new Error('Email verification failed. Please try again.');
    }
  }

  async resendVerificationEmail(
    email: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = getRayfinClient();
      const result = await client.auth.resendVerificationEmail(email);
      return result;
    } catch (error: any) {
      console.error('RayfinAuthService resendVerificationEmail error:', error);
      throw new Error('Failed to resend verification email. Please try again.');
    }
  }

  async sendMagicLink(
    email: string,
    redirectUri: string
  ): Promise<MagicLinkSendResult> {
    try {
      const client = getRayfinClient();
      const result = await client.auth.sendMagicLink({
        email,
        redirectUri,
      });
      return {
        success: result.success,
        state: result.state,
        message: result.message,
      };
    } catch (error: any) {
      console.error('RayfinAuthService sendMagicLink error:', error);

      // Check for rate limiting
      if (error.status === 429) {
        throw new Error(
          'Too many requests. Please wait a moment and try again.'
        );
      }

      throw new Error('Failed to send magic link. Please try again.');
    }
  }

  async handleMagicLinkCallback(): Promise<MagicLinkCallbackResult> {
    try {
      const client = getRayfinClient();
      const result = await client.auth.handleMagicLinkCallback();

      if (!result.success) {
        return {
          success: false,
          error: result.error ?? 'Magic link authentication failed',
        };
      }

      // Get user info from the session
      const session = client.auth.getSession();

      if (!session.isAuthenticated || !session.user) {
        return {
          success: false,
          error: 'Failed to establish session',
        };
      }

      const user: AuthUser = {
        Id: session.user.id,
        Email: session.user.email,
        Name: session.user.email.split('@')[0],
      };

      return {
        success: true,
        user,
      };
    } catch (error: any) {
      console.error('RayfinAuthService handleMagicLinkCallback error:', error);

      // Check for expired token
      if (error.status === 400 || error.message?.includes('expired')) {
        return {
          success: false,
          error: 'Magic link has expired. Please request a new one.',
        };
      }

      // Check for invalid token
      if (error.status === 404 || error.message?.includes('invalid')) {
        return {
          success: false,
          error: 'Invalid magic link.',
        };
      }

      return {
        success: false,
        error: 'Magic link authentication failed. Please try again.',
      };
    }
  }

  isMagicLinkCallback(): boolean {
    const client = getRayfinClient();
    return client.auth.isMagicLinkCallback();
  }

  async initiateFabricLogin(): Promise<void> {
    const { initiateFabricLogin: sdkInitiateFabricLogin } =
      await import('@microsoft/rayfin-auth-provider-fabric');
    const { getFabricConfig } = await import('../../utils/environment');

    const client = getRayfinClient();
    const fabricConfig = getFabricConfig();

    if (
      !fabricConfig.workspaceId ||
      !fabricConfig.projectId ||
      !fabricConfig.fabricPortalUrl
    ) {
      throw new Error('Fabric authentication is not configured.');
    }

    await sdkInitiateFabricLogin(client.auth, {
      workspaceId: fabricConfig.workspaceId,
      projectId: fabricConfig.projectId,
      fabricPortalUrl: fabricConfig.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });
  }

  async ensureSignedInWithFabric(): Promise<AuthUser> {
    const { ensureSignedInWithFabric: sdkEnsureSignedIn } =
      await import('@microsoft/rayfin-auth-provider-fabric');
    const { getFabricConfig } = await import('../../utils/environment');

    const client = getRayfinClient();
    const fabricConfig = getFabricConfig();

    if (
      !fabricConfig.workspaceId ||
      !fabricConfig.projectId ||
      !fabricConfig.fabricPortalUrl
    ) {
      throw new Error('Fabric authentication is not configured.');
    }

    const session = await sdkEnsureSignedIn(client.auth, {
      workspaceId: fabricConfig.workspaceId,
      projectId: fabricConfig.projectId,
      fabricPortalUrl: fabricConfig.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });

    if (!session.isAuthenticated || !session.user) {
      throw new Error(
        'Fabric authentication completed but no session was established.'
      );
    }

    return {
      Id: session.user.id,
      Email: session.user.email,
      Name: session.user.email.split('@')[0],
    };
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    const { initEmbeddedAuth: sdkInitEmbedded } =
      await import('@microsoft/rayfin-auth-provider-fabric');
    const { getFabricConfig } = await import('../../utils/environment');

    const client = getRayfinClient();
    const fabricConfig = getFabricConfig();

    if (
      !fabricConfig.workspaceId ||
      !fabricConfig.projectId ||
      !fabricConfig.fabricPortalUrl
    ) {
      return null;
    }

    const session = await sdkInitEmbedded(client.auth, {
      workspaceId: fabricConfig.workspaceId,
      projectId: fabricConfig.projectId,
      fabricPortalUrl: fabricConfig.fabricPortalUrl,
      returnOrigin: window.location.origin,
    });

    if (!session?.isAuthenticated || !session.user) {
      return null;
    }

    return {
      Id: session.user.id,
      Email: session.user.email,
      Name: session.user.email.split('@')[0],
    };
  }
}
