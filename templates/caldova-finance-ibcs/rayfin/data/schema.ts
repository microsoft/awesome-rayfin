import { FcAdjustment } from './FcAdjustment.js';
import { LineComment } from './LineComment.js';
import { MonthSignOff } from './MonthSignOff.js';

/**
 * Only the controlling team's own records live here: forecast adjustments, comments and sign-offs.
 * The statements themselves come from the semantic model (baked snapshot, or the live connector).
 */
export type DataAppSchema = {
  FcAdjustment: FcAdjustment;
  LineComment: LineComment;
  MonthSignOff: MonthSignOff;
};

export const schema = [FcAdjustment, LineComment, MonthSignOff];
