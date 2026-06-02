import { useCallback, useEffect, useState } from 'react';

import type { Region } from '../../rayfin/data/Region';
import { ServiceContainer } from '../services/ServiceContainer';

interface UseRegionsResult {
  regions: Region[];
  myRegionIds: string[];
  loading: boolean;
  error: string | null;
  createRegion: (name: string, description?: string) => Promise<Region>;
  assignRegion: (regionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useRegions(): UseRegionsResult {
  const [regions, setRegions] = useState<Region[]>([]);
  const [myRegionIds, setMyRegionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const regionService = ServiceContainer.getInstance().regionService;

  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await regionService.getRegions();
      setRegions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch regions');
    }
    try {
      const myRegions = await regionService.getMyRegions();
      setMyRegionIds(
        myRegions
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Rayfin returns the relation FK as region_id even though the entity type models region as an object
          .map((ur) => (ur as any).region_id)
          .filter(Boolean)
      );
    } catch {
      // Non-critical — default region won't be set but list still works
    }
    setLoading(false);
  }, [regionService]);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  const createRegion = useCallback(
    async (name: string, description?: string) => {
      const region = await regionService.createRegion(name, description);
      setRegions((prev) => [...prev, region]);
      return region;
    },
    [regionService]
  );

  const assignRegion = useCallback(
    async (regionId: string) => {
      await regionService.assignRegion(regionId);
    },
    [regionService]
  );

  return { regions, myRegionIds, loading, error, createRegion, assignRegion, refresh: fetchRegions };
}
