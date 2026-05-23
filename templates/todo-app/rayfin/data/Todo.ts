import {
  entity,
  role,
  uuid,
  text,
  boolean,
  set,
  date,
  one,
  decimal,
  int,
} from '@microsoft/rayfin-core';

import { Category } from './Category.js';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Todo {
  @uuid() id!: string;
  @text({ min: 1, max: 50 }) Title!: string;
  @text({ optional: true }) description?: string;
  @boolean() isCompleted!: boolean;
  @boolean({ optional: true }) isCompletedOptional?: boolean;
  @set('low', 'medium', 'high') priority!: 'low' | 'medium' | 'high';
  @date({ optional: true }) dueDate?: Date;
  @int({ default: 2 }) points!: number;
  @int({ optional: true }) optionalPoints?: number;
  @decimal() percentComplete!: number;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;

  @one(() => Category, { optional: true }) category?: Category;

  // User association via user_id populated from JWT claims (not a FK relationship)
  @text() user_id!: string;
}
