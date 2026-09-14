import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { useToasts, dismissToast, type ToastTone } from "../lib/toast";

const TONE: Record<ToastTone, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: "text-success" },
  error: { icon: AlertCircle, cls: "text-destructive" },
  info: { icon: Info, cls: "text-primary" },
};

/** Standardized toast surface. Mount once; fire with `toast()` from anywhere. */
export function Toaster() {
  const items = useToasts();
  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {items.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className="toast-in pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg"
          >
            <tone.icon size={16} className={tone.cls} aria-hidden="true" />
            <span className="max-w-xs">{t.title}</span>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="ml-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
