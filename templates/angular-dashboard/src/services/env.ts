/**
 * Safe accessor for `import.meta.env.*` build-time replacements.
 *
 * Why this exists: `@ngx-env/builder` (via `@dotenv-run/core`) only
 * defines the keys that are actually present in `.env*` at build time.
 * Referencing an undefined key compiles to the literal
 * `import.meta.env.X` — and `import.meta.env` itself is `undefined` in
 * a browser bundle (no Vite runtime), so the access throws.
 *
 * Wrap each access in a thunk so esbuild can still replace the literal
 * `import.meta.env.X` for keys that ARE defined, while undefined keys
 * throw silently inside the try/catch and we return undefined.
 *
 * @example
 *   const repo = envVar(() => import.meta.env.VITE_GITHUB_REPO);
 *   const api  = envVar(() => import.meta.env.VITE_RAYFIN_API_URL) ?? 'http://localhost:5168';
 */
export function envVar(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
