import { GameStats } from './GameStats.js';

/**
 * Schema type definition for the Jump & Run app.
 *
 * Maps entity names to their model types, giving full type safety when using
 * the RayfinClient (`client.data.GameStats…`).
 */
export type DataAppSchema = {
  GameStats: GameStats;
};

export const schema = [GameStats];
