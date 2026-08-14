/** Minimal dependency-free className joiner (clsx-lite). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
