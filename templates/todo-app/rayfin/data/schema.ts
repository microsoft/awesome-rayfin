import { Category } from './Category.js';
import { Todo } from './Todo.js';

/**
 * Schema type definition for the Todo app
 *
 * This type maps entity names to their corresponding model types,
 * enabling full type safety throughout the application when using
 * the RayfinClient and DataApi.
 *
 * Note: User entity is managed by Rayfin's control plane authentication system.
 * Todo and Category items are associated with users via user_id field
 * populated from JWT token claims.
 */
export type TodoAppSchema = {
  Todo: Todo;
  Category: Category;
};

export const schema = [Todo, Category];
