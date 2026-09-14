import allgaeu from '@config/world/allgaeu.json';

import { AOIS, type AoiConfig } from './aoi';

/**
 * The world — PLAN §8.
 *
 * One continuous terrain containing every shipped site, so choosing another site is a **camera
 * flight** rather than a page reload. Before this, each AOI carried its own shell and the two
 * missed each other by 3.8 km: switching site meant tearing down one world and building another,
 * and the 24.4 km between the sites was simply not represented anywhere.
 *
 * The union shell replaces both per-AOI shells at runtime. The per-AOI shells are still built and
 * still shipped, because a single site remains a valid configuration of this app — a world with
 * one site in it is exactly the old behaviour, and that is the point of keeping the shapes the
 * same.
 */
export interface WorldConfig {
  id: string;
  name: Record<string, string>;
  sites: string[];
  elevationRangeM: { min: number; max: number };
  shellGeobasis: { attribution: string; licence: string; licenceUrl: string };
}

export const WORLD = allgaeu as unknown as WorldConfig;

/** The sites in this world, in config order, as full AOI configs. */
export function worldSites(): AoiConfig[] {
  return WORLD.sites.filter((id) => id in AOIS).map((id) => AOIS[id]);
}

/**
 * Is this AOI part of the world?
 *
 * A site could in principle ship without being in a world — the renderer then falls back to that
 * site's own shell, which is exactly the pre-phase-8 behaviour rather than a broken state.
 */
export function inWorld(aoiId: string): boolean {
  return WORLD.sites.includes(aoiId);
}
