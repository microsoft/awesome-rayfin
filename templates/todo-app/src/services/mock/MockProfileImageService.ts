import { IProfileImageService } from '../interfaces/IProfileImageService';
import { IStorageService } from '../interfaces/IStorageService';

interface StoredImage {
  url: string;
  timestamp: number;
}

export class MockProfileImageService implements IProfileImageService {
  private readonly PROFILE_IMAGES_KEY = 'todo_app_profile_images';
  private readonly MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
  private readonly ALLOWED_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  constructor(private storage: IStorageService) {}

  async uploadProfileImage(userId: string, file: File): Promise<string> {
    // Validate the file
    const validation = this.validateImageFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid image file');
    }

    try {
      // Convert file to base64 data URL for mock storage
      const dataUrl = await this.fileToDataUrl(file);

      // Get existing profile images from storage
      const profileImages =
        this.storage.get<Record<string, StoredImage[]>>(
          this.PROFILE_IMAGES_KEY
        ) || {};

      // Create new image entry with timestamp
      const newImage: StoredImage = {
        url: dataUrl,
        timestamp: Date.now(),
      };

      // Add to user's image array (keeping all images)
      if (!profileImages[userId]) {
        profileImages[userId] = [];
      }
      profileImages[userId].push(newImage);

      this.storage.set(this.PROFILE_IMAGES_KEY, profileImages);

      // Verify persistence (LocalStorageService.set swallows errors). If it didn't persist,
      // treat it as a quota/availability failure so callers can react.
      const verify =
        this.storage.get<Record<string, StoredImage[]>>(
          this.PROFILE_IMAGES_KEY
        ) || {};
      const userImages = verify[userId];
      if (!userImages || !userImages.some((img) => img.url === dataUrl)) {
        throw new Error(
          'Could not persist image (storage unavailable or quota exceeded)'
        );
      }

      return dataUrl;
    } catch (error) {
      throw new Error(
        'Failed to upload profile image: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    }
  }

  async getProfileImage(userId: string): Promise<string | null> {
    const profileImages =
      this.storage.get<Record<string, StoredImage[]>>(
        this.PROFILE_IMAGES_KEY
      ) || {};
    const userImages = profileImages[userId];
    if (!userImages || userImages.length === 0) {
      return null;
    }
    // Return the most recent image (highest timestamp)
    const latestImage = userImages.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    );
    return latestImage.url;
  }

  getDefaultAvatar(): string {
    // Return a simple SVG avatar as a data URL
    const svg = `
      <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="20" fill="#e5e7eb"/>
        <circle cx="20" cy="16" r="6" fill="#9ca3af"/>
        <ellipse cx="20" cy="32" rx="8" ry="6" fill="#9ca3af"/>
      </svg>
    `;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  validateImageFile(file: File): { isValid: boolean; error?: string } {
    // Check file type
    if (!this.ALLOWED_TYPES.includes(file.type)) {
      return {
        isValid: false,
        error:
          'Please select a valid image file (JPEG, JPG, PNG, GIF, or WebP)',
      };
    }

    // Check file size
    if (file.size > this.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: 'Image file must be smaller than 2MB',
      };
    }

    return { isValid: true };
  }

  /**
   * Convert a File to a data URL
   */
  private fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to read file as data URL'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}
