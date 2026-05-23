import { Category } from '../../../rayfin/data/Category';

export interface ICategoryService {
  getCategories(): Promise<Category[]>;
  getCategoryById(id: string): Promise<Category | null>;
  createCategory(category: Omit<Category, 'id' | 'Id'>): Promise<Category>;
  updateCategory(
    id: string,
    updates: Partial<Omit<Category, 'id' | 'Id'>>
  ): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
}
