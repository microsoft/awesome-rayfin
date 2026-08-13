import { VehicleComment } from './VehicleComment.js';

/**
 * Entities declared for this app, giving `client.data.VehicleComment…` full type safety.
 */
export type DataAppSchema = {
  VehicleComment: VehicleComment;
};

export const schema = [VehicleComment];
