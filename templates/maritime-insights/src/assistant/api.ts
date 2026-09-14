/**
 * Where the assistant backend lives, and how the app talks to it.
 *
 * 🔴 The fallback chain matters. `rayfin up` regenerates `.env.local` on every deploy and maps
 * `RAYFIN_PUBLIC_FOO` to `VITE_RAYFIN_FOO`, while a local `.env` uses the plain `VITE_FOO` name.
 * Reading only one of them means the value works locally and is empty in production, or the other
 * way round — and the symptom is a chat panel that quietly cannot reach anything.
 */

const env = import.meta.env as Record<string, string | undefined>;

export const ASSISTANT_BASE = (
  env.VITE_ASSISTANT_API_BASE
  ?? env.VITE_RAYFIN_ASSISTANT_API_BASE
  ?? ""
).replace(/\/$/, "");

export const ASSISTANT_APP_KEY = (
  env.VITE_ASSISTANT_APP_KEY
  ?? env.VITE_RAYFIN_ASSISTANT_APP_KEY
  ?? ""
).trim();

/**
 * Is a backend configured at all?
 *
 * ⚠️ There is deliberately **no localhost default**. The sibling app defaults to
 * `http://localhost:8080`, which means a deployed build with a missing variable spends every
 * request failing against the *user's own machine* — a confusing error that looks like a network
 * fault. Here an unset base means the chat button is not rendered, which is a state the app
 * already has to handle and which says what it means.
 */
export function assistantConfigured(): boolean {
  return ASSISTANT_BASE.length > 0;
}

export function assistantHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ASSISTANT_APP_KEY) headers["x-app-key"] = ASSISTANT_APP_KEY;
  return headers;
}

export function assistantStreamUrl(): string {
  return `${ASSISTANT_BASE}/api/assistant/stream`;
}

/** One frame of the NDJSON stream. */
export type AssistantFrame =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; arguments: unknown; result: unknown }
  | { type: "metadata"; provider: string; model: string; usage?: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Split an NDJSON byte stream into frames.
 *
 * ⚠️ Kept separate from the component so it can be tested without a DOM, and because the one bug
 * this parsing always has — treating a chunk boundary as a line boundary — is invisible until a
 * frame happens to straddle one, which under load is exactly when it matters.
 */
export async function* readFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    // The last element is whatever arrived after the final newline — a partial frame. Holding it
    // back until more bytes arrive is the whole point.
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed) as AssistantFrame;
      } catch {
        // A frame we cannot parse is not worth tearing the answer down for.
      }
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as AssistantFrame;
    } catch {
      /* ignore */
    }
  }
}
