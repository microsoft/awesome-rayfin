import { entity, role, uuid, text, many } from '@microsoft/rayfin-core';

import { Todo } from './Todo.js';

@entity()
@role('authenticated', '*', {
  policy: (claims, item) => claims.sub.eq(item.user_id),
})
export class Category {
  @uuid() id!: string;
  @text() name!: string;
  @text() color!: string;

  @many(() => Todo)
  todos?: Todo[];

  @text() user_id!: string;
}
