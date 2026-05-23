import { IStorageService } from '../interfaces/IStorageService';

export class LocalStorageService implements IStorageService {
  get<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  clear(): void {
    try {
      localStorage.clear();
    } catch {
      // Silently fail if localStorage is not available
    }
  }
}
