import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@config': resolve(import.meta.dirname, 'config'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // The relay is plain Node ESM rather than TypeScript — it has no build step and no bundler, so
    // it runs straight from source. Its parser and privacy filter are still the two pieces of this
    // app most worth testing, so vitest reaches into `server/` as well.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.js'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
