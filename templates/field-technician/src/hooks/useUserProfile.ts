import { useCallback, useEffect, useState } from 'react';

import type { UserProfile } from '../../rayfin/data/UserProfile';
import { ServiceContainer } from '../services/ServiceContainer';

interface UseUserProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  createProfile: (data: {
    displayName: string;
    role: 'technician' | 'dispatcher';
    phone?: string;
  }) => Promise<UserProfile>;
  refresh: () => Promise<void>;
}

export function useUserProfile(): UseUserProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const profileService = ServiceContainer.getInstance().userProfileService;

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await profileService.getMyProfile();
      setProfile(data);
    } catch (err) {
      console.error('Failed to fetch profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch profile');
    } finally {
      setLoading(false);
    }
  }, [profileService]);

  const createProfile = useCallback(
    async (data: {
      displayName: string;
      role: 'technician' | 'dispatcher';
      phone?: string;
    }) => {
      setError(null);
      try {
        const newProfile = await profileService.createProfile(data);
        setProfile(newProfile);
        return newProfile;
      } catch (err) {
        console.error('Failed to create profile:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to create profile'
        );
        throw err;
      }
    },
    [profileService]
  );

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  return {
    profile,
    loading,
    error,
    createProfile,
    refresh: fetchProfile,
  };
}
