import { useState, useEffect, useCallback } from 'react';

import { Category } from '../../rayfin/data/Category';
import { ServiceContainer } from '../services/ServiceContainer';

import { useAuth } from './useAuth';

interface UseCategoriesResult {
  categories: Category[];
  loading: boolean;
  error: string | null;
  createCategory: (category: Omit<Category, 'id' | 'Id'>) => Promise<Category>;
  updateCategory: (
    id: string,
    updates: Partial<Omit<Category, 'id' | 'Id'>>
  ) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  refreshCategories: () => Promise<void>;
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user, isAuthenticated } = useAuth();
  const categoryService = ServiceContainer.create().categoryService;

  const refreshCategories = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setCategories([]);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const fetchedCategories = await categoryService.getCategories();
      setCategories(fetchedCategories);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load categories'
      );
      console.error('Error loading categories:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user, categoryService]);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  const createCategory = useCallback(
    async (category: Omit<Category, 'id' | 'Id'>): Promise<Category> => {
      try {
        setError(null);
        const newCategory = await categoryService.createCategory(category);
        setCategories((prev) => [...prev, newCategory]);
        return newCategory;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to create category';
        setError(errorMessage);
        throw err;
      }
    },
    [categoryService]
  );

  const updateCategory = useCallback(
    async (
      id: string,
      updates: Partial<Omit<Category, 'id'>>
    ): Promise<Category> => {
      try {
        setError(null);
        const updatedCategory = await categoryService.updateCategory(
          id,
          updates
        );
        setCategories((prev) =>
          prev.map((cat) => (cat.id === id ? updatedCategory : cat))
        );
        return updatedCategory;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to update category';
        setError(errorMessage);
        throw err;
      }
    },
    [categoryService]
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<void> => {
      try {
        setError(null);
        await categoryService.deleteCategory(id);
        setCategories((prev) => prev.filter((cat) => cat.id !== id));
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete category';
        setError(errorMessage);
        throw err;
      }
    },
    [categoryService]
  );

  return {
    categories,
    loading,
    error,
    createCategory,
    updateCategory,
    deleteCategory,
    refreshCategories,
  };
}
