import type { RayfinClient } from '@microsoft/rayfin-client';

import { Category } from '../../../rayfin/data/Category';
import type { TodoAppSchema } from '../../../rayfin/data/schema';
import { ICategoryService } from '../interfaces/ICategoryService';

import { getRayfinClient } from './RayfinClientService';

/**
 * Implementation of ICategoryService using \@microsoft/rayfin-data GraphQL fluent interface
 *
 * This service uses the rayfinClient.data.gql property to access the GraphQL API,
 * providing type-safe query building and execution with fluent syntax for category operations.
 */
export class RayfinCategoryService implements ICategoryService {
  private rayfinClient: RayfinClient<TodoAppSchema>;

  constructor() {
    // Get the RayfinClient instance once during initialization
    this.rayfinClient = getRayfinClient();
  }

  async getCategories(): Promise<Category[]> {
    try {
      // Use the GraphQL fluent interface for category queries
      // User filtering is handled automatically by DAB through JWT claims and RLS
      const categories = await this.rayfinClient.data.Category.select([
        'id',
        'name',
        'color',
      ])
        .orderBy({ name: 'asc' })
        .execute();

      return categories;
    } catch (error) {
      console.error('RayfinCategoryService.getCategories error:', error);
      throw new Error('Failed to fetch categories');
    }
  }

  async getCategoryById(id: string): Promise<Category | null> {
    try {
      // Use the GraphQL fluent interface for single category query
      const categories = await this.rayfinClient.data.Category.select([
        'id',
        'name',
        'color',
      ])
        .where({ id: { eq: id } })
        .first(1)
        .execute();

      return categories[0] || null;
    } catch (error) {
      console.error('RayfinCategoryService.getCategoryById error:', error);
      throw new Error('Failed to fetch category');
    }
  }

  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    try {
      // Verify user is authenticated before creating category
      const session = this.rayfinClient.auth.getSession();
      if (!session?.isAuthenticated || !session.user?.id) {
        throw new Error('User must be authenticated to create categories');
      }

      const categoryData = {
        name: category.name,
        color: category.color,
        user_id: session.user.id,
      };

      // Use GraphQL mutation for creation
      const newCategory =
        await this.rayfinClient.data.Category.create(categoryData);

      return newCategory;
    } catch (error) {
      console.error('RayfinCategoryService.createCategory error:', error);
      throw new Error('Failed to create category');
    }
  }

  async updateCategory(
    id: string,
    updates: Partial<Omit<Category, 'id' | 'todos'>>
  ): Promise<Category> {
    try {
      // Use GraphQL mutation for update - requires WhereUniqueInput format
      await this.rayfinClient.data.Category.update(
        { id }, // WhereUniqueInput format
        updates
      );

      // Fetch the updated category to return
      const updatedCategory = await this.getCategoryById(id);
      if (!updatedCategory) {
        throw new Error(`Category with id ${id} not found after update`);
      }

      return updatedCategory;
    } catch (error) {
      console.error('RayfinCategoryService.updateCategory error:', error);
      throw new Error('Failed to update category');
    }
  }

  async deleteCategory(id: string): Promise<void> {
    try {
      // Use GraphQL mutation for deletion - requires WhereUniqueInput format
      await this.rayfinClient.data.Category.delete({ id });
    } catch (error) {
      console.error('RayfinCategoryService.deleteCategory error:', error);
      throw new Error('Failed to delete category');
    }
  }
}
