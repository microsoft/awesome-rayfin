import type { UserProfile } from '../../../rayfin/data/UserProfile';

export interface IUserProfileService {
  getMyProfile(): Promise<UserProfile | null>;
  getProfilesByRole(role: 'technician' | 'dispatcher'): Promise<UserProfile[]>;
  createProfile(data: {
    displayName: string;
    role: 'technician' | 'dispatcher';
    phone?: string;
  }): Promise<UserProfile>;
  updateProfile(
    id: string,
    data: Partial<Pick<UserProfile, 'displayName' | 'phone' | 'role'>>
  ): Promise<UserProfile>;
}
