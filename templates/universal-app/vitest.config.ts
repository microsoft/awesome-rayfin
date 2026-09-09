import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.test.mjs'],
    exclude: ['node_modules', 'dist'],
  },
});
