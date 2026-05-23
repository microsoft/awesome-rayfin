import { AuthUser } from '../../models/AuthUser';
import {
  IAuthService,
  MagicLinkCallbackResult,
  MagicLinkSendResult,
  SignUpResult,
} from '../interfaces/IAuthService';
import { IStorageService } from '../interfaces/IStorageService';

export class MockAuthService implements IAuthService {
  private readonly CURRENT_USER_KEY = 'todo_app_current_user';
  private readonly MAGIC_LINK_STATE_KEY = 'todo_app_magic_link_state';

  constructor(private storage: IStorageService) {}

  async signUp(email: string, password: string): Promise<SignUpResult> {
    // Mock implementation - just log the signup
    console.log('MockAuthService: Signing up user:', email);
    // In mock mode, signup always succeeds and email is auto-verified
    // Note: User is NOT automatically logged in - they need to login
    return { emailVerified: true };
  }

  async login(email: string, password: string): Promise<AuthUser> {
    // Mock users for demo
    const users = [
      { Id: '1', Email: 'alice@example.com', Name: 'Alice Johnson' },
      { Id: '2', Email: 'bob@example.com', Name: 'Bob Smith' },
      { Id: '3', Email: 'charlie@example.com', Name: 'Charlie Brown' },
    ];

    const user = users.find((u) => u.Email === email);
    if (!user || password !== 'password123') {
      throw new Error('Invalid credentials');
    }

    const authUser: AuthUser = {
      ...user,
    };

    this.storage.set(this.CURRENT_USER_KEY, authUser);
    return authUser;
  }

  async logout(): Promise<void> {
    this.storage.remove(this.CURRENT_USER_KEY);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.storage.get<AuthUser>(this.CURRENT_USER_KEY);
  }

  async isAuthenticated(): Promise<boolean> {
    return this.storage.get<AuthUser>(this.CURRENT_USER_KEY) !== null;
  }

  async verifyEmail(token: string): Promise<void> {
    // Mock implementation - always succeeds
    console.log('MockAuthService: Verifying email with token', token);
    // In mock mode, verification is instant
  }

  async resendVerificationEmail(
    email: string
  ): Promise<{ success: boolean; message: string }> {
    // Mock implementation - always succeeds
    console.log('MockAuthService: Resending verification email to', email);
    return {
      success: true,
      message: 'Verification email has been resent successfully.',
    };
  }

  async sendMagicLink(
    email: string,
    redirectUri: string
  ): Promise<MagicLinkSendResult> {
    // Mock implementation - simulate sending magic link
    console.log(
      'MockAuthService: Sending magic link to',
      email,
      'with redirect',
      redirectUri
    );

    // Generate a mock state for the magic link flow
    const state = `mock_state_${Date.now()}`;

    // Store the state and email for callback handling
    this.storage.set(this.MAGIC_LINK_STATE_KEY, { state, email, redirectUri });

    return {
      success: true,
      state,
      message: 'Magic link sent! Check your inbox.',
    };
  }

  async handleMagicLinkCallback(): Promise<MagicLinkCallbackResult> {
    // Mock implementation - auto-login the user from stored state
    const storedState = this.storage.get<{
      state: string;
      email: string;
      redirectUri: string;
    }>(this.MAGIC_LINK_STATE_KEY);

    if (!storedState) {
      return {
        success: false,
        error: 'No magic link session found',
      };
    }

    // Clear the stored state
    this.storage.remove(this.MAGIC_LINK_STATE_KEY);

    // Create a mock user from the email
    const user: AuthUser = {
      Id: `mock_${Date.now()}`,
      Email: storedState.email,
      Name: storedState.email.split('@')[0],
    };

    // Store the user as logged in
    this.storage.set(this.CURRENT_USER_KEY, user);

    return {
      success: true,
      user,
    };
  }

  isMagicLinkCallback(): boolean {
    // Check if URL contains magic link callback parameters
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('code') && urlParams.has('state');
  }

  async initiateFabricLogin(): Promise<void> {
    throw new Error('Fabric authentication is not available in mock mode.');
  }

  async ensureSignedInWithFabric(): Promise<AuthUser> {
    throw new Error('Fabric authentication is not available in mock mode.');
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    return null;
  }
}
