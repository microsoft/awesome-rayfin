import { useCallback, useEffect, useState } from 'react';

import { ServiceContainer } from '../services/ServiceContainer';

/**
 * Hook for managing profile image operations
 */
export function useProfileImage(userId?: string) {
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileImageService = ServiceContainer.create().profileImageService;

  const loadProfileImage = useCallback(
    async (targetUserId: string) => {
      try {
        setError(null);
        const imageUrl =
          await profileImageService.getProfileImage(targetUserId);
        setProfileImageUrl(imageUrl);
      } catch (err) {
        console.error('Failed to load profile image:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load profile image'
        );
        setProfileImageUrl(null);
      }
    },
    [profileImageService]
  );

  // Load profile image on mount or when userId changes
  useEffect(() => {
    if (userId) {
      loadProfileImage(userId);
    } else {
      setProfileImageUrl(null);
    }
  }, [userId]);

  // Listen for global updates (e.g., after signup deferred upload) and refresh if it matches our userId
  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { userId?: string }
        | undefined;
      if (detail?.userId && userId && detail.userId === userId) {
        void loadProfileImage(userId);
      }
    };
    window.addEventListener(
      'profile-image-updated',
      onUpdated as EventListener
    );
    return () =>
      window.removeEventListener(
        'profile-image-updated',
        onUpdated as EventListener
      );
  }, [userId, loadProfileImage]);

  const uploadProfileImage = useCallback(
    async (targetUserId: string, file: File) => {
      try {
        setIsLoading(true);
        setError(null);

        // Validate the file first
        const validation = profileImageService.validateImageFile(file);
        if (!validation.isValid) {
          throw new Error(validation.error);
        }

        // Upload the image
        const imageUrl = await profileImageService.uploadProfileImage(
          targetUserId,
          file
        );
        setProfileImageUrl(imageUrl);

        return imageUrl;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to upload profile image';
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [profileImageService]
  );

  const getDisplayUrl = useCallback(() => {
    return profileImageUrl || profileImageService.getDefaultAvatar();
  }, [profileImageUrl, profileImageService]);

  return {
    profileImageUrl,
    isLoading,
    error,
    uploadProfileImage,
    getDisplayUrl,
    refreshProfileImage: userId ? () => loadProfileImage(userId) : undefined,
  };
}
