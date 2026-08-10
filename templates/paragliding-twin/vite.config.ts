import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@config': resolve(import.meta.dirname, 'config'),
    },
  },
  server: {
    proxy: {
      // The OGN relay (`node server/ogn/relay.js`) runs beside the dev server rather than inside
      // it: it holds a raw TCP socket to APRS-IS, which Vite has no business owning, and it must
      // keep running when the front end restarts. Proxying keeps the app on one origin in dev, so
      // there is no CORS to configure and the same relative URL works in both places.
      //
      // No relay running? The proxy fails, EventSource errors, and the app falls back to Mode B —
      // exactly what the deployed build does. The failure path is therefore the one being
      // developed against most of the time, which is the right way round.
      '/ogn': {
        target: 'http://localhost:8787',
        changeOrigin: false,
      },
      // The realtime voice minting service (`npm run voice`). Separate process and separate port
      // from the relay because the two share nothing and must fail independently — a missing
      // device database should not cost you the assistant, and vice versa.
      '/voice': {
        target: 'http://localhost:8788',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
