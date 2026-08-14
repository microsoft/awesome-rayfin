import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * SSR-safe portal. Renders children into document.body only after mount so server
 * output and first client render stay identical.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
