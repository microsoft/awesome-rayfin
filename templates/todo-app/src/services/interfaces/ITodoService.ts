import { Todo } from '../../../rayfin/data/Todo';

export interface ITodoService {
  getTodos(): Promise<Todo[]>;
  getTodoById(id: string): Promise<Todo | null>;
  createTodo(todo: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Promise<Todo>;
  updateTodo(
    id: string,
    updates: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<Todo>;
  deleteTodo(id: string): Promise<void>;
}
