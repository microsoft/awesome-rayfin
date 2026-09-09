import { useCallback, useEffect, useState } from "react";

/**
 * Two-way bind a piece of app state to a URL query parameter so views are
 * deep-linkable and survive refresh / back-forward. SSR-safe; falls back to plain
 * state when there is no `window`.
 */
export function useUrlState(
  key: string,
  defaultValue: string,
): [string, (next: string) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return defaultValue;
    const v = new URLSearchParams(window.location.search).get(key);
    return v ?? defaultValue;
  }, [key, defaultValue]);

  const [value, setValue] = useState<string>(read);

  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);

  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      if (next === defaultValue) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(null, "", url.toString());
    },
    [key, defaultValue],
  );

  return [value, set];
}
