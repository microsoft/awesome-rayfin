import { useEffect, useRef } from "react";

/** Runs `refresh` whenever `reloadKey` changes, but not on first render. */
export function useReloadOn(reloadKey: number, refresh: () => void) {
    const seen = useRef(reloadKey);

    useEffect(() => {
        if (seen.current === reloadKey) return;
        seen.current = reloadKey;
        refresh();
    }, [reloadKey, refresh]);
}
