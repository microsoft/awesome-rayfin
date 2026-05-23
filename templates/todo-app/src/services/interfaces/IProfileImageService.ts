/**
 * Profile image service interface for managing user profile images
 */
export interface IProfileImageService {
  /**
   * Upload a profile image for a user
   * @param userId - The user ID
   * @param file - The image file to upload
   * @returns Promise that resolves to the image URL
   */
  uploadProfileImage(userId: string, file: File): Promise<string>;

  /**
   * Get the profile image URL for a user
   * @param userId - The user ID
   * @returns Promise that resolves to the image URL or null if no image
   */
  getProfileImage(userId: string): Promise<string | null>;

  /**
   * Get the default avatar URL
   * @returns The default avatar URL or data URL
   */
  getDefaultAvatar(): string;

  /**
   * Validate an image file
   * @param file - The image file to validate
   * @returns True if valid, false otherwise
   */
  validateImageFile(file: File): { isValid: boolean; error?: string };
}
