import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

/**
 * No dev proxies.
 *
 * The app this was forked from proxied a raw-TCP APRS relay and a token-minting service. Neither
 * exists here: every source Campus-Insights reads — LDBV, LGL, Copernicus, Overpass, NavigaTUM —
 * is fetched **at build time by the Python pipeline** and shipped as static assets, or served from
 * Fabric through the Rayfin client. Nothing is fetched from a third party at page load, which is
 * also what makes the demo survive a conference network (PLAN D4).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@config': resolve(import.meta.dirname, 'config'),
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
