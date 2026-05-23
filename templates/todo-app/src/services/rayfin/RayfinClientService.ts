import { RayfinClient } from '@microsoft/rayfin-client';
import { ExtendableRayfinClient } from '@microsoft/rayfin-client/experimental';
import { createStorageClient, StorageClient } from '@microsoft/rayfin-storage';

import type { TodoAppSchema } from '../../../rayfin/data/schema';
import type { TodoAppStorageSchema } from '../../../rayfin/storage/schema';

/**
 * A singleton service that manages the RayfinClient instance
 */
export class RayfinClientService {
  private static instance: RayfinClientService | null = null;
  private _client:
    | (RayfinClient<TodoAppSchema> & {
        storage: StorageClient<TodoAppStorageSchema>;
      })
    | null = null;

  private constructor() {}

  /**
   * Get the singleton instance of RayfinClientService
   */
  public static getInstance(): RayfinClientService {
    if (!RayfinClientService.instance) {
      RayfinClientService.instance = new RayfinClientService();
    }
    return RayfinClientService.instance;
  }

  /**
   * Initialize the RayfinClient with the provided base URL and publishable key
   *
   * @param baseUrl - The base URL of the Rayfin API
   * @param publishableKey - The publishable key for service-level authentication
   * @param projectId - Optional Rayfin project identifier (set by rayfin up)
   * @returns The initialized RayfinClient instance
   */
  public initialize(
    baseUrl: string,
    publishableKey: string
  ): RayfinClient<TodoAppSchema> & {
    storage: StorageClient<TodoAppStorageSchema>;
  } {
    if (!this._client) {
      console.log(`🔧 Initializing Rayfin client with baseUrl: ${baseUrl}`);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Origin: window.location.origin, // Set Origin header for email verification links
      };

      this._client = ExtendableRayfinClient.create({
        baseUrl: baseUrl,
        publishableKey: publishableKey,
        useProxy: false, // ✨ Fixed: Use direct API calls instead of proxy
        headers,
        schema: {} as unknown as TodoAppSchema,
        services: {
          storage: createStorageClient<TodoAppStorageSchema>,
        },
      });

      // Save the client to the window object for easy access
      (window as any).rayfinServiceContainer = {
        client: this._client,
      };

      console.log(
        `✅ Rayfin client configured for direct API calls to ${baseUrl}`
      );

      // Test the connection to the backend
      this.testConnection();
    }

    return this._client;
  }

  /**
   * Get the RayfinClient instance
   * @throws Error if the client is not initialized
   */
  public getClient(): RayfinClient<TodoAppSchema> & {
    storage: StorageClient<TodoAppStorageSchema>;
  } {
    if (!this._client) {
      throw new Error('RayfinClient not initialized. Call initialize() first.');
    }
    return this._client;
  }

  /**
   * Check if the client is initialized
   */
  public isInitialized(): boolean {
    return this._client !== null;
  }

  /**
   * Reset the client instance (useful for testing or when switching modes)
   */
  public reset(): void {
    this._client = null;
    if ((window as any).rayfinServiceContainer) {
      (window as any).rayfinServiceContainer.client = null;
    }
  }

  /**
   * Test the connection to the backend
   */
  private testConnection(): void {
    if (!this._client) return;

    // Run an async IIFE; ignoring the returned promise is intentional here
    void (async () => {
      try {
        const session = this._client!.auth.getSession();
        if (session.isAuthenticated) {
          console.log('✅ Backend connection test completed successfully');
        } else {
          console.warn('⚠️ Backend connection test: no active session');
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn('⚠️ Backend connection test failed:', errorMessage);
        console.warn(
          'The app will continue to use the Rayfin client, but authentication operations may fail.'
        );
        console.warn('💡 To use mock mode instead, run: npm run dev:mock');
      }
    })();
  }
}

/**
 * Helper function to get the RayfinClient instance
 * @throws Error if the client is not initialized
 */
export function getRayfinClient(): RayfinClient<TodoAppSchema> & {
  storage: StorageClient<TodoAppStorageSchema>;
} {
  return RayfinClientService.getInstance().getClient();
}
