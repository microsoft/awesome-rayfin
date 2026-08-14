import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside the returned container while `active`, focuses the first
 * focusable on open, and restores focus to the previously-focused element on close.
 * Used by every standardized overlay (palette, menus) so keyboard + screen-reader
 * users get correct, consistent behavior org-wide.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
      );

    // Make the rest of the page inert so AT + Tab can't escape into the
    // background behind the overlay. We inert every top-level body child that
    // does not contain the trapped node (the portal wrapper), and restore them
    // exactly on close.
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      const el = child as HTMLElement;
      if (el.contains(node)) continue;
      if (el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      inerted.push(el);
    }

    focusable()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      for (const el of inerted) el.removeAttribute("inert");
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
