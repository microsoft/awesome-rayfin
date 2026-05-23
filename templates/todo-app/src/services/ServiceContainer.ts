import { IAuthService } from './interfaces/IAuthService';
import { ICategoryService } from './interfaces/ICategoryService';
import { IProfileImageService } from './interfaces/IProfileImageService';
import { IStorageService } from './interfaces/IStorageService';
import { ITodoService } from './interfaces/ITodoService';
import { LocalStorageService } from './mock/LocalStorageService';
import { MockAuthService } from './mock/MockAuthService';
import { MockCategoryService } from './mock/MockCategoryService';
import { MockProfileImageService } from './mock/MockProfileImageService';
import { MockTodoService } from './mock/MockTodoService';
import { RayfinAuthService } from './rayfin/RayfinAuthService';
import { RayfinCategoryService } from './rayfin/RayfinCategoryService';
import { RayfinClientService } from './rayfin/RayfinClientService';
import { RayfinProfileImageService } from './rayfin/RayfinProfileImageService';
import { RayfinTodoService } from './rayfin/RayfinTodoService';

export class ServiceContainer {
  private static instance: ServiceContainer | null = null;

  private constructor(
    public readonly storageService: IStorageService,
    public readonly authService: IAuthService,
    public readonly todoService: ITodoService,
    public readonly categoryService: ICategoryService,
    public readonly profileImageService: IProfileImageService
  ) {}

  /**
   * Get the RayfinClient instance if in Rayfin mode
   */
  public get rayfinClient():
    | ReturnType<
        ReturnType<typeof RayfinClientService.getInstance>['getClient']
      >
    | undefined {
    try {
      return RayfinClientService.getInstance().isInitialized()
        ? RayfinClientService.getInstance().getClient()
        : undefined;
    } catch (error) {
      return undefined;
    }
  }

  static create(mode: 'mock' | 'rayfin' = 'mock'): ServiceContainer {
    if (!ServiceContainer.instance) {
      if (mode === 'mock') {
        console.log('Creating ServiceContainer with mock services');
        const storage = new LocalStorageService();
        const auth = new MockAuthService(storage);
        ServiceContainer.instance = new ServiceContainer(
          storage,
          auth,
          new MockTodoService(storage, auth),
          new MockCategoryService(storage, auth),
          new MockProfileImageService(storage)
        );
      } else {
        try {
          // Rayfin implementation
          const storage = new LocalStorageService();

          // Get API URL from environment variables with fallback
          const apiUrl =
            import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
          console.log('🔧 Initializing Rayfin services with API URL:', apiUrl);

          // Get publishable key from environment variables
          const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;
          if (!publishableKey) {
            throw new Error(
              'VITE_RAYFIN_PUBLISHABLE_KEY environment variable is required for Rayfin mode'
            );
          }

          // Initialize the Rayfin client through the singleton service
          const rayfinClientService = RayfinClientService.getInstance();
          rayfinClientService.initialize(
            apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
            publishableKey
          );

          const authService = new RayfinAuthService();

          // Create the Rayfin service container with full @microsoft/rayfin-data integration
          ServiceContainer.instance = new ServiceContainer(
            storage, // Still use localStorage for local app state
            authService, // RayfinAuthService for authentication
            new RayfinTodoService(), // Now uses @microsoft/rayfin-data DataApi for real database operations
            new RayfinCategoryService(), // RayfinCategoryService for category operations
            new RayfinProfileImageService() // RayfinProfileImageService for profile image storage
          );

          console.log('✅ Rayfin services initialized successfully');

          // Add a safety check and fallback for CORS or connection issues
          window.addEventListener('unhandledrejection', (event) => {
            // If we get an unhandled rejection that could be related to CORS
            if (
              event.reason &&
              (event.reason.toString().includes('CORS') ||
                event.reason.toString().includes('NetworkError') ||
                event.reason.toString().includes('Failed to fetch'))
            ) {
              console.warn(
                'Detected CORS or network error, falling back to mock mode'
              );
              console.warn('Error details:', event.reason);

              // Only fall back if we're still using Rayfin mode
              if (ServiceContainer.instance?.rayfinClient) {
                // Reset the client service
                RayfinClientService.getInstance().reset();
                ServiceContainer.reset();
                ServiceContainer.create('mock');

                // Notify the user that we've fallen back to mock mode
                alert(
                  'Unable to connect to the backend service. Falling back to mock mode.'
                );

                // Reload the page to ensure clean state
                window.location.reload();
              }
            }
          });
        } catch (error) {
          console.error('❌ Failed to initialize Rayfin services:', error);
          console.warn('Falling back to mock mode due to initialization error');

          // Fall back to mock mode
          const storage = new LocalStorageService();
          const auth = new MockAuthService(storage);
          ServiceContainer.instance = new ServiceContainer(
            storage,
            auth,
            new MockTodoService(storage, auth),
            new MockCategoryService(storage, auth),
            new MockProfileImageService(storage)
          );

          // Show user-friendly error message
          setTimeout(() => {
            alert(
              'Unable to connect to the backend service. Running in offline mode with mock data.'
            );
          }, 100);
        }
      }
    }
    return ServiceContainer.instance;
  }

  static reset(): void {
    ServiceContainer.instance = null;
  }
}
