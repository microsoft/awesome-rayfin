import { Category } from '../../../rayfin/data/Category';
import { IAuthService } from '../interfaces/IAuthService';
import { ICategoryService } from '../interfaces/ICategoryService';
import { IStorageService } from '../interfaces/IStorageService';

export class MockCategoryService implements ICategoryService {
  private readonly CATEGORIES_KEY = 'todo_app_categories';

  // Predefined color palette for categories
  private readonly CATEGORY_COLORS = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#8B5CF6', // Purple
    '#EF4444', // Red
    '#F59E0B', // Amber
    '#06B6D4', // Cyan
    '#84CC16', // Lime
    '#EC4899', // Pink
  ];

  constructor(
    private storage: IStorageService,
    private auth: IAuthService
  ) {
    // Initialize with demo data if empty
    if (!this.storage.get(this.CATEGORIES_KEY)) {
      this.initializeDemoData();
    }
  }

  private async initializeDemoData(): Promise<void> {
    const demoCategories: Category[] = [
      // Alice's categories
      {
        id: '1',
        name: 'Work',
        color: '#3B82F6',
        user_id: '1',
      },
      {
        id: '2',
        name: 'Personal',
        color: '#10B981',
        user_id: '1',
      },
      {
        id: '3',
        name: 'Shopping',
        color: '#8B5CF6',
        user_id: '1',
      },
      {
        id: '4',
        name: 'Health',
        color: '#EF4444',
        user_id: '1',
      },

      // Bob's categories
      {
        id: '5',
        name: 'Work',
        color: '#3B82F6',
        user_id: '2',
      },
      {
        id: '6',
        name: 'Family',
        color: '#10B981',
        user_id: '2',
      },
      {
        id: '7',
        name: 'Hobbies',
        color: '#F59E0B',
        user_id: '2',
      },

      // Charlie's categories
      {
        id: '8',
        name: 'School',
        color: '#06B6D4',
        user_id: '3',
      },
      {
        id: '9',
        name: 'Sports',
        color: '#84CC16',
        user_id: '3',
      },
    ];
    this.storage.set(this.CATEGORIES_KEY, demoCategories);
  }

  private getNextColor(existingCategories: Category[]): string {
    const usedColors = existingCategories.map((c) => c.color);
    const availableColors = this.CATEGORY_COLORS.filter(
      (color) => !usedColors.includes(color)
    );

    if (availableColors.length > 0) {
      return availableColors[0];
    }

    // If all predefined colors are used, generate a random color
    return this.generateRandomColor();
  }

  private generateRandomColor(): string {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 65%, 55%)`;
  }

  async getCategories(): Promise<Category[]> {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) {
      throw new Error('User must be authenticated to fetch categories');
    }

    const categories = this.storage.get<Category[]>(this.CATEGORIES_KEY) || [];
    return categories.filter((category) => category.user_id === currentUser.Id);
  }

  async getCategoryById(id: string): Promise<Category | null> {
    const categories = this.storage.get<Category[]>(this.CATEGORIES_KEY) || [];
    return categories.find((category) => category.id === id) || null;
  }

  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) {
      throw new Error('User must be authenticated to create categories');
    }

    const categories = this.storage.get<Category[]>(this.CATEGORIES_KEY) || [];
    const userCategories = categories.filter(
      (c) => c.user_id === currentUser.Id
    );

    const newCategory: Category = {
      id: crypto.randomUUID(),
      name: category.name,
      color: category.color || this.getNextColor(userCategories),
      user_id: currentUser.Id,
    };

    categories.push(newCategory);
    this.storage.set(this.CATEGORIES_KEY, categories);

    return newCategory;
  }

  async updateCategory(
    id: string,
    updates: Partial<Omit<Category, 'id'>>
  ): Promise<Category> {
    const categories = this.storage.get<Category[]>(this.CATEGORIES_KEY) || [];
    const index = categories.findIndex((category) => category.id === id);

    if (index === -1) {
      throw new Error('Category not found');
    }

    const updatedCategory = {
      ...categories[index],
      ...updates,
    };

    categories[index] = updatedCategory;
    this.storage.set(this.CATEGORIES_KEY, categories);

    return updatedCategory;
  }

  async deleteCategory(id: string): Promise<void> {
    const categories = this.storage.get<Category[]>(this.CATEGORIES_KEY) || [];
    const filteredCategories = categories.filter(
      (category) => category.id !== id
    );
    this.storage.set(this.CATEGORIES_KEY, filteredCategories);

    // Note: Todos with this category will need to be unassigned by the TodoService
    // This is handled in the useTodos hook when categories are deleted
  }
}
