import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

/*
 * The test run resolves `@brand-active` to the Caldova overlay and `@brand-neutral` to the neutral
 * one, matching the single build the app ships as. That makes the brand SWITCH exercisable in unit
 * tests rather than vacuous.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@reorder': resolve(import.meta.dirname, 'src', 'reorder'),
      '@finance': resolve(import.meta.dirname, 'src', 'finance'),
      '@config': resolve(import.meta.dirname, 'config'),
      '@brand-active': resolve(import.meta.dirname, 'config', 'brand', 'caldova.json'),
      '@brand-neutral': resolve(import.meta.dirname, 'config', 'brand', 'neutral.json'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tools/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
