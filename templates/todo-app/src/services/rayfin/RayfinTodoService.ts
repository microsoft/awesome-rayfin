import type { RayfinClient } from '@microsoft/rayfin-client';

import { Todo } from '../../../rayfin/data/Todo';
import type { TodoAppSchema } from '../../../rayfin/data/schema';
import { ITodoService } from '../interfaces/ITodoService';

import { getRayfinClient } from './RayfinClientService';

/**
 * Implementation of ITodoService using \@microsoft/rayfin-data GraphQL fluent interface
 *
 * This service uses the rayfinClient.data.gql property to access the GraphQL API,
 * providing type-safe query building and execution with fluent syntax.
 */
export class RayfinTodoService implements ITodoService {
  private rayfinClient: RayfinClient<TodoAppSchema>;

  constructor() {
    // Get the RayfinClient instance once during initialization
    this.rayfinClient = getRayfinClient();
  }

  async getTodos(): Promise<Todo[]> {
    try {
      // Use the GraphQL fluent interface for more sophisticated queries
      // User filtering is handled automatically by DAB through JWT claims and RLS
      const todos = await this.rayfinClient.data.Todo.select([
        'id',
        'Title',
        'description',
        'isCompleted',
        'priority',
        'dueDate',
        'createdAt',
        'updatedAt',
        'user_id',
        'category.id',
        'category.name',
        'category.color', // Add category relationship
        'category.user_id',
      ])
        .orderBy({ createdAt: 'desc' })
        .execute();

      return todos;
    } catch (error) {
      console.error('RayfinTodoService.getTodos error:', error);
      throw new Error('Failed to fetch todos');
    }
  }

  async getTodoById(id: string): Promise<Todo | null> {
    try {
      // Use the GraphQL fluent interface for more sophisticated queries
      const todo = await this.rayfinClient.data.Todo.select([
        'id',
        'Title',
        'description',
        'isCompleted',
        'priority',
        'dueDate',
        'createdAt',
        'updatedAt',
        'category.id',
        'category.name',
        'category.color', // Add category relationship
      ])
        .where({ id: { eq: id } })
        .first(1)
        .execute();

      return todo[0] || null;
    } catch (error) {
      console.error('RayfinTodoService.getTodoById error:', error);
      throw new Error('Failed to fetch todo');
    }
  }

  async createTodo(
    todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Todo> {
    try {
      // Prepare the todo data with auto-generated fields
      const todoData = {
        ...todo,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Use GraphQL mutation for creation
      const newTodo = await this.rayfinClient.data.Todo.create(todoData);

      const newTodoWithCategoryFields = await this.getTodoById(newTodo.id);
      if (!newTodoWithCategoryFields) {
        throw new Error(`Todo with id ${newTodo.id} not found after creation`);
      }
      return newTodoWithCategoryFields;
    } catch (error) {
      console.error('RayfinTodoService.createTodo error:', error);
      throw new Error('Failed to create todo');
    }
  }

  async updateTodo(
    id: string,
    updates: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Todo> {
    try {
      // Add updatedAt timestamp to the updates
      const updateData = {
        ...updates,
        updatedAt: new Date(),
      };

      // Use GraphQL mutation for update - requires WhereUniqueInput format
      await this.rayfinClient.data.Todo.update(
        { id }, // WhereUniqueInput format
        updateData
      );

      const fullUpdatedTodo = await this.getTodoById(id);
      if (!fullUpdatedTodo) {
        throw new Error(`Todo with id ${id} not found after update`);
      }
      return fullUpdatedTodo;
    } catch (error) {
      console.error('RayfinTodoService.updateTodo error:', error);
      throw new Error('Failed to update todo');
    }
  }

  async deleteTodo(id: string): Promise<void> {
    try {
      // Use GraphQL mutation for deletion - requires WhereUniqueInput format
      await this.rayfinClient.data.Todo.delete({ id });
    } catch (error) {
      console.error('RayfinTodoService.deleteTodo error:', error);
      throw new Error('Failed to delete todo');
    }
  }
}
