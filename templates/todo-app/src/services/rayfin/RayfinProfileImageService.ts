import type { RayfinClient } from '@microsoft/rayfin-client';
import { StorageClient } from '@microsoft/rayfin-storage';

import type { TodoAppSchema } from '../../../rayfin/data/schema';
import type { TodoAppStorageSchema } from '../../../rayfin/storage/schema';
import { IProfileImageService } from '../interfaces/IProfileImageService';

import { getRayfinClient } from './RayfinClientService';

/**
 * Rayfin implementation of profile image service using Rayfin storage
 */
export class RayfinProfileImageService implements IProfileImageService {
  private rayfinClient: RayfinClient<TodoAppSchema> & {
    storage: StorageClient<TodoAppStorageSchema>;
  };

  constructor() {
    this.rayfinClient = getRayfinClient();
  }

  /**
   * Compute the storage prefix for a user's profile images
   */
  private getStoragePrefix(userId: string): string {
    return `users/${userId}`;
  }

  /**
   * Common storage options with prefix
   */
  private getStorageOptions(userId: string): { prefix: string } {
    return { prefix: this.getStoragePrefix(userId) };
  }

  async uploadProfileImage(userId: string, file: File): Promise<string> {
    // Validate the file
    const validation = this.validateImageFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid image file');
    }

    try {
      // Use the original filename provided by the user
      const filename = file.name;

      // Upload to Rayfin storage - using the kebab-case folder name from config
      const result = await this.rayfinClient.storage.ProfileImage.upload(
        filename,
        file,
        {
          prefix: this.getStoragePrefix(userId),
          contentType: file.type,
        }
      );

      console.log('Profile image uploaded successfully:', result.correlationId);
      return filename;
    } catch (error) {
      console.error('Failed to upload profile image:', error);
      throw new Error(
        'Failed to upload profile image: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    }
  }

  async getProfileImage(userId: string): Promise<string | null> {
    try {
      // List most recent file for this user's profile images
      const list = await this.rayfinClient.storage.ProfileImage.list({
        prefix: this.getStoragePrefix(userId),
        limit: 1,
      });

      // TODO: list of ProfileImage which has no string fields, but actually the client adds
      // StorageObjectRef. We should make it strongly typed, but only way I know now is to
      // make ProfileImage extend StorageObjectRef. Needs discussion.
      const latest = list.items[0] as unknown as { name: string } | undefined;
      if (!latest) return null;

      // Download the latest image by name using the same prefix
      const download = await this.rayfinClient.storage.ProfileImage.download(
        latest.name,
        this.getStorageOptions(userId)
      );

      // Infer MIME type from filename for the data URL
      const mimeType = this.getMimeTypeFromFilename(latest.name);
      const dataUrl = await this.streamToDataUrl(download.stream, mimeType);
      return dataUrl;
    } catch (error) {
      console.error('Failed to get profile image:', error);
      return null;
    }
  }

  /**
   * Convert a ReadableStream to a data URL
   */
  private async streamToDataUrl(
    stream: ReadableStream<Uint8Array>,
    mimeType: string
  ): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      // Combine all chunks into a single Uint8Array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to blob then to data URL
      const blob = new Blob([combined], { type: mimeType });
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('Failed to convert blob to data URL'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get file extension from a File object
   */
  // NOTE: We no longer require extension extraction when uploading

  /**
   * Infer MIME type from a filename's extension
   */
  private getMimeTypeFromFilename(name: string): string {
    const ext = name.toLowerCase().split('.').pop() || '';
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
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
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
    const ALLOWED_TYPES = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    // Check file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return {
        isValid: false,
        error: 'Please select a valid image file (JPEG, PNG, GIF, or WebP)',
      };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: 'Image file must be smaller than 2MB',
      };
    }

    return { isValid: true };
  }
}
