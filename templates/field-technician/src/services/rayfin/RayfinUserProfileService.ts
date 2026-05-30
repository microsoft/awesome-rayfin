import type { UserProfile } from '../../../rayfin/data/UserProfile';
import { IUserProfileService } from '../interfaces/IUserProfileService';
import { getRayfinClient } from './RayfinClientService';

export class RayfinUserProfileService implements IUserProfileService {
  async getMyProfile(): Promise<UserProfile | null> {
    const client = getRayfinClient();
    const userId = client.auth.getSession().user?.id;
    if (!userId) return null;

    const results = await client.data.UserProfile
      .select(['id', 'user_id', 'displayName', 'phone', 'role'])
      .where({ user_id: { eq: userId } })
      .execute();

    return results[0] ?? null;
  }

  async getProfilesByRole(role: 'technician' | 'dispatcher'): Promise<UserProfile[]> {
    const client = getRayfinClient();
    return client.data.UserProfile
      .select(['id', 'displayName', 'phone', 'role'])
      .where({ role: { eq: role } })
      .orderBy({ displayName: 'asc' })
      .execute();
  }

  async createProfile(data: {
    displayName: string;
    role: 'technician' | 'dispatcher';
    phone?: string;
  }): Promise<UserProfile> {
    const client = getRayfinClient();
    const userId = client.auth.getSession().user?.id;
    if (!userId) throw new Error('User is not authenticated');

    return client.data.UserProfile.create({
      user_id: userId,
      displayName: data.displayName,
      role: data.role,
      phone: data.phone ?? '',
    });
  }

  async updateProfile(
    id: string,
    data: Partial<Pick<UserProfile, 'displayName' | 'phone' | 'role'>>
  ): Promise<UserProfile> {
    const client = getRayfinClient();
    return client.data.UserProfile.update({ id }, data);
  }
}
