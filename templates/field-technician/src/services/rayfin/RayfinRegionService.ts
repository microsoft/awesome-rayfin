import type { Region } from '../../../rayfin/data/Region';
import type { UserRegion } from '../../../rayfin/data/UserRegion';
import { IRegionService } from '../interfaces/IRegionService';
import { getRayfinClient } from './RayfinClientService';

export class RayfinRegionService implements IRegionService {
  async getRegions(): Promise<Region[]> {
    const client = getRayfinClient();
    return client.data.Region
      .select(['id', 'name', 'description'])
      .orderBy({ name: 'asc' })
      .execute();
  }

  async createRegion(name: string, description?: string): Promise<Region> {
    const client = getRayfinClient();
    return client.data.Region.create({ name, description });
  }

  async getMyRegions(): Promise<UserRegion[]> {
    const client = getRayfinClient();
    const userId = client.auth.getSession().user?.id;
    if (!userId) return [];

    const profiles = await client.data.UserProfile
      .select(['id'])
      .where({ user_id: { eq: userId } })
      .execute();

    if (profiles.length === 0) return [];

    return client.data.UserRegion
      .select(['id', 'region_id'] as any)
      .execute();
  }

  async assignRegion(regionId: string): Promise<UserRegion> {
    const client = getRayfinClient();
    const userId = client.auth.getSession().user?.id;
    if (!userId) throw new Error('User is not authenticated');

    const profiles = await client.data.UserProfile
      .select(['id'])
      .where({ user_id: { eq: userId } })
      .execute();

    if (profiles.length === 0) throw new Error('User profile not found');

    return client.data.UserRegion.create({
      userProfile: profiles[0] as any,
      region: { id: regionId } as any,
    });
  }
}
