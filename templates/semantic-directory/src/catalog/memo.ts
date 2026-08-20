//-----------------------------------------------------------------------
// Semantic Directory — per-catalog memoization.
//
// The catalog is a stable, memoized object (rebuilt only when the model or its
// live overlay changes). That makes it a perfect WeakMap key: cache expensive,
// pure, catalog-derived computations against the catalog reference and they
// invalidate automatically when a new catalog is built — with no manual cache
// busting and no leaks (old entries are GC'd with the old catalog).
//
// Two flavours:
//   • memoByCatalog(fn)      — one cached value per catalog (e.g. an index).
//   • memoByCatalogKey(fn,k) — cached per (catalog, string key) (e.g. per entity).
// Deterministic, metadata-only — no AI.
//-----------------------------------------------------------------------

/** Cache a single value per catalog reference. */
export function memoByCatalog<C extends object, T>(
    compute: (catalog: C) => T,
): (catalog: C) => T {
    const cache = new WeakMap<C, T>();
    return (catalog: C): T => {
        if (cache.has(catalog)) return cache.get(catalog) as T;
        const value = compute(catalog);
        cache.set(catalog, value);
        return value;
    };
}

/** Cache a value per (catalog reference, string key). */
export function memoByCatalogKey<C extends object, A extends unknown[], T>(
    compute: (catalog: C, ...args: A) => T,
    keyOf: (...args: A) => string,
): (catalog: C, ...args: A) => T {
    const cache = new WeakMap<C, Map<string, T>>();
    return (catalog: C, ...args: A): T => {
        let inner = cache.get(catalog);
        if (!inner) {
            inner = new Map<string, T>();
            cache.set(catalog, inner);
        }
        const key = keyOf(...args);
        if (inner.has(key)) return inner.get(key) as T;
        const value = compute(catalog, ...args);
        inner.set(key, value);
        return value;
    };
}
