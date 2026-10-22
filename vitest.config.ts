import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    maxWorkers: 1,
    pool: 'threads',
    setupFiles: ['./src/test/setup.ts'],
  },
});
