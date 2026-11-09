import { RestockRequest } from './RestockRequest.js';

/**
 * The app's own SQL database. Only reorders are written here; everything the twin reads for its
 * scene is bundled, and every figure comes from the new Direct Lake model (PLAN Phase 4).
 */
export type AppSchema = {
  RestockRequest: RestockRequest;
};
