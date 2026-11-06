import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Measure an element's width, ignoring zero.
 *
 * Vega can size itself from its container, but the visuals library applies a
 * `> 0` guard to the height it observes and none to the width. A zero-width
 * measurement — which is what arrives when an element scrolls out of view, or is
 * observed before layout has settled — is therefore passed straight through, and
 * the chart collapses to a flat line with nothing to restore it.
 *
 * So the app measures instead, keeps the last width it actually saw, and hands
 * Vega a concrete number. Returns `undefined` until a real width exists, so a
 * caller can wait rather than draw something wrong.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | undefined {
    const [width, setWidth] = useState<number | undefined>(undefined);
    const lastWidth = useRef<number | undefined>(undefined);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const record = (candidate: number) => {
            const next = Math.floor(candidate);

            // Ignore zero, and ignore sub-pixel jitter that would otherwise
            // rebuild the view on every scroll frame.
            if (next <= 0) return;
            if (lastWidth.current !== undefined && Math.abs(next - lastWidth.current) < 2) return;

            lastWidth.current = next;
            setWidth(next);
        };

        record(element.getBoundingClientRect().width);

        const observer = new ResizeObserver((entries) => {
            const observed = entries[0]?.contentRect.width;
            if (observed !== undefined) record(observed);
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    return width;
}
