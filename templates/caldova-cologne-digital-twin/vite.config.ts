import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * The offline cache's file list, written into dist/ after every build (local launcher + offline
 * cache for stages without good WiFi).
 *
 * public/sw.js reads `precache.json` and stores EVERY file of this build on first load, so the
 * twin opens without a network afterwards. `version` is a hash over all files: a new build gets a
 * new cache and the old one is deleted, so a stale twin can never outlive a redeploy.
 */
function precacheManifest(): Plugin {
  return {
    name: 'caldova-precache-manifest',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(dist, full).split(sep).join('/'));
        }
      };
      walk(dist);
      const skip = new Set(['sw.js', 'precache.json']);
      const list = files.filter((f) => !skip.has(f)).sort();
      const hash = createHash('sha256');
      let bytes = 0;
      for (const f of list) {
        const buf = readFileSync(join(dist, f));
        bytes += buf.length;
        hash.update(f).update(buf);
      }
      const manifest = { version: hash.digest('hex').slice(0, 16), bytes, files: list };
      writeFileSync(join(dist, 'precache.json'), JSON.stringify(manifest));
      // ⚠️ THE BUILD TOKEN GOES INTO sw.js: a byte-identical sw.js is never reinstalled,
      // so without it a redeploy never reached a device that had cached the previous twin.
      const swPath = join(dist, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__CALDOVA_BUILD__')) throw new Error('sw.js has no build placeholder');
      writeFileSync(swPath, sw.replace('__CALDOVA_BUILD__', manifest.version));
      console.info(`precache.json: ${list.length} files, ${(bytes / 1e6).toFixed(1)} MB, version ${manifest.version}`);
    },
  };
}

/**
 * No dev proxies.
 *
 * The app this was forked from proxied a raw-TCP APRS relay and a token-minting service. Neither
 * exists here: every source Campus-Insights reads — LDBV, LGL, Copernicus, Overpass, NavigaTUM —
 * is fetched **at build time by the Python pipeline** and shipped as static assets, or served from
 * Fabric through the Rayfin client. Nothing is fetched from a third party at page load, which is
 * also what makes the demo survive a conference network.
 */
export default defineConfig(({ mode }) => {
  /*
   * ⚠️ THE DEPLOYMENT'S OWN DETAILS COME FROM RAYFIN'S FILE, NOT FROM A COPY.
   *
   * `rayfin up` writes the API url, the publishable key and the workspace id into `rayfin/.env`
   * and rewrites them on every deploy. Vite would not read them by itself — wrong directory and
   * wrong prefix — and the obvious fix is to paste them into a root `.env`, which then goes stale
   * the first time the app is redeployed into another workspace and points the write path at a
   * database that is no longer there. Reading the managed file keeps one source of truth.
   *
   * The publishable key is designed to be public: it identifies the app, it does not authorise
   * anything on its own. The actual permission check is the Fabric identity of whoever is signed
   * in, which is why the deviation entity is `authenticated` rather than `anonymous`.
   */
  const rayfin = loadEnv(mode, resolve(import.meta.dirname, 'rayfin'), 'RAYFIN_PUBLIC_');

  /*
   * ⚠️ ONE BUILD, AND THE NAMES COME OFF AT RUN TIME. There used to be a second, NEUTRAL build
   * selected with `VITE_BRAND` — a bundle the customer's name was not in at all, guarded by
   * `tools/verify_neutral.py`. It was deliberately removed once the header switch existed.
   *
   * What that gave up, stated plainly so nobody rediscovers it in front of an audience: with a
   * single branded build the name IS in the JavaScript even when the switch is off, so anyone who
   * opens the developer tools can find it. The switch controls what is DISPLAYED, not what is
   * shipped. That is the right trade for a demo — two artefacts nobody remembers to build is worse
   * than one — but it is a trade, not a free simplification.
   *
   * `@brand-active` is what the app shows; `@brand-neutral` is what the switch falls back to.
   * Adding another customer means another file here and one more alias, not another build.
   */
  const brandFile = resolve(import.meta.dirname, 'config', 'brand', 'caldova.json');
  const neutralFile = resolve(import.meta.dirname, 'config', 'brand', 'neutral.json');

  return {
    plugins: [react(), tailwindcss(), precacheManifest()],
    define: {
      'import.meta.env.VITE_RAYFIN_API_URL': JSON.stringify(rayfin.RAYFIN_PUBLIC_API_URL ?? ''),
      'import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY': JSON.stringify(
        rayfin.RAYFIN_PUBLIC_PUBLISHABLE_KEY ?? ''
      ),
      'import.meta.env.VITE_RAYFIN_WORKSPACE_ID': JSON.stringify(
        rayfin.RAYFIN_PUBLIC_WORKSPACE_ID ?? ''
      ),
      'import.meta.env.VITE_RAYFIN_PROJECT_ID': JSON.stringify(rayfin.RAYFIN_PUBLIC_ITEM_ID ?? ''),
      /*
       * The chat backend, read from the SAME managed rayfin/.env as everything else.
       *
       * ⚠️ EMPTY BY DEFAULT, AND THE PANEL CHECKS FOR THAT. The assistant needs a server-side
       * identity for Azure OpenAI, so it lives in a Container App that may not exist yet for a
       * given deployment. An unset base has to mean "say so" rather than "fetch from the page's
       * own origin", which is what a relative URL would silently do — producing 404s that look
       * like the model refusing to answer.
       */
      'import.meta.env.VITE_CHAT_API_BASE': JSON.stringify(rayfin.RAYFIN_PUBLIC_CHAT_API_BASE ?? ''),
      'import.meta.env.VITE_CHAT_APP_KEY': JSON.stringify(rayfin.RAYFIN_PUBLIC_CHAT_APP_KEY ?? ''),
    },
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
        // The original caldova-reorder screens keep their own root.
        '@reorder': resolve(import.meta.dirname, 'src', 'reorder'),
        // Michael Tenner's Finance Cockpit, ported for the Finance tab (src/finance/SOURCE.md).
        '@finance': resolve(import.meta.dirname, 'src', 'finance'),
        '@config': resolve(import.meta.dirname, 'config'),
        '@brand-active': brandFile,
        '@brand-neutral': neutralFile,
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
  };
});
