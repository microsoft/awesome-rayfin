import type { Region } from '../../../rayfin/data/Region';
import type { UserRegion } from '../../../rayfin/data/UserRegion';

export interface IRegionService {
  getRegions(): Promise<Region[]>;
  createRegion(name: string, description?: string): Promise<Region>;
  getMyRegions(): Promise<UserRegion[]>;
  assignRegion(regionId: string): Promise<UserRegion>;
}
