import { useEffect, useState } from "react";

export type ToastTone = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  title: string;
  tone: ToastTone;
}

const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];
let seq = 0;

function emit() {
  for (const l of listeners) l(items);
}

/** Fire a standardized toast from anywhere — no provider/context wiring needed. */
export function toast(title: string, tone: ToastTone = "info", ttlMs = 3200) {
  const item: ToastItem = { id: ++seq, title, tone };
  items = [...items, item];
  emit();
  if (ttlMs > 0) {
    setTimeout(() => {
      items = items.filter((t) => t.id !== item.id);
      emit();
    }, ttlMs);
  }
  return item.id;
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Subscribe to the live toast list. */
export function useToasts() {
  const [state, setState] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
