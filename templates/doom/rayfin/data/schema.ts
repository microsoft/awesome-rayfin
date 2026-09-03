import { DoomSession } from './DoomSession.js';
import { DoomLevelResult } from './DoomLevelResult.js';
import { DoomSave } from './DoomSave.js';

/**
 * Schema type definition for the Doom app.
 *
 * Maps entity names to their model types, giving full type safety when using
 * the RayfinClient (`client.data.DoomSession…`).
 */
export type BlankAppSchema = {
  DoomSession: DoomSession;
  DoomLevelResult: DoomLevelResult;
  DoomSave: DoomSave;
};

export const schema = [DoomSession, DoomLevelResult, DoomSave];
