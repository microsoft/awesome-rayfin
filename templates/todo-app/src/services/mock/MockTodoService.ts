import { Todo } from '../../../rayfin/data/Todo';
import { IAuthService } from '../interfaces/IAuthService';
import { IStorageService } from '../interfaces/IStorageService';
import { ITodoService } from '../interfaces/ITodoService';

export class MockTodoService implements ITodoService {
  private readonly TODOS_KEY = 'todo_app_todos';

  constructor(
    private storage: IStorageService,
    private auth: IAuthService
  ) {
    // Initialize with demo data if empty
    if (!this.storage.get(this.TODOS_KEY)) {
      this.initializeDemoData();
    }
  }

  private async initializeDemoData(): Promise<void> {
    const demoTodos: Todo[] = [
      {
        id: '1',
        Title: 'Complete project proposal',
        description: 'Finish the Q3 project proposal for the new client',
        isCompleted: false,
        priority: 'high',
        dueDate: new Date('2024-12-31'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        category: {
          id: '1',
          name: 'Work',
          color: '#3B82F6',
          user_id: '1',
        },
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
      {
        id: '2',
        Title: 'Review code changes',
        isCompleted: true,
        priority: 'medium',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        category: {
          id: '1',
          name: 'Work',
          color: '#3B82F6',
          user_id: '1',
        },
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
      {
        id: '3',
        Title: 'Buy groceries',
        description: 'Milk, bread, eggs, and vegetables for the week',
        isCompleted: false,
        priority: 'medium',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-03'),
        category: {
          id: '3',
          name: 'Shopping',
          color: '#8B5CF6',
          user_id: '1',
        },
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
      {
        id: '4',
        Title: 'Call dentist for appointment',
        isCompleted: false,
        priority: 'low',
        createdAt: new Date('2024-01-04'),
        updatedAt: new Date('2024-01-04'),
        category: {
          id: '4',
          name: 'Health',
          color: '#EF4444',
          user_id: '1',
        },
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
      {
        id: '5',
        Title: 'Plan weekend trip',
        description: 'Research destinations and book accommodation',
        isCompleted: false,
        priority: 'low',
        createdAt: new Date('2024-01-05'),
        updatedAt: new Date('2024-01-05'),
        category: {
          id: '2',
          name: 'Personal',
          color: '#10B981',
          user_id: '1',
        },
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
      {
        id: '6',
        Title: 'Read technical documentation',
        isCompleted: false,
        priority: 'medium',
        createdAt: new Date('2024-01-06'),
        updatedAt: new Date('2024-01-06'),
        // No category - demonstrates uncategorized todos
        user_id: '1',
        points: 0,
        percentComplete: 0,
      },
    ];
    this.storage.set(this.TODOS_KEY, demoTodos);
  }

  async getTodos(): Promise<Todo[]> {
    const currentUser = await this.auth.getCurrentUser();
    if (!currentUser) {
      throw new Error('User must be authenticated to fetch todos');
    }

    const todos = this.storage.get<Todo[]>(this.TODOS_KEY) || [];
    return todos.filter((todo) => todo.user_id === currentUser.Id);
  }

  async getTodoById(id: string): Promise<Todo | null> {
    const todos = this.storage.get<Todo[]>(this.TODOS_KEY) || [];
    return todos.find((todo) => todo.id === id) || null;
  }

  async createTodo(
    todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Todo> {
    const todos = this.storage.get<Todo[]>(this.TODOS_KEY) || [];
    const currentUser = await this.auth.getCurrentUser();

    const newTodo: Todo = {
      ...todo,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      // Ensure the user_id is set correctly
      user_id: currentUser?.Id || todo.user_id,
    };
    todos.push(newTodo);
    this.storage.set(this.TODOS_KEY, todos);
    return newTodo;
  }

  async updateTodo(
    id: string,
    updates: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Todo> {
    const todos = this.storage.get<Todo[]>(this.TODOS_KEY) || [];
    const index = todos.findIndex((todo) => todo.id === id);

    if (index === -1) {
      throw new Error('Todo not found');
    }

    const updatedTodo = {
      ...todos[index],
      ...updates,
      updatedAt: new Date(),
    };

    todos[index] = updatedTodo;
    this.storage.set(this.TODOS_KEY, todos);
    return updatedTodo;
  }

  async deleteTodo(id: string): Promise<void> {
    const todos = this.storage.get<Todo[]>(this.TODOS_KEY) || [];
    const filteredTodos = todos.filter((todo) => todo.id !== id);
    this.storage.set(this.TODOS_KEY, filteredTodos);
  }
}
