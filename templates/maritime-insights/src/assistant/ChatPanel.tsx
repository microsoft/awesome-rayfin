import { useCallback, useEffect, useRef, useState } from "react";
import {
  assistantConfigured, assistantHeaders, assistantStreamUrl, readFrames,
} from "./api";
import type { ViewSnapshot } from "./viewSnapshot";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  meta: string;
  streaming?: boolean;
  /** Which tools answered this turn. Shown so a figure can be traced to its source. */
  sources?: string[];
}

const GREETING: Message = {
  id: 0,
  role: "assistant",
  meta: "Bereit",
  text: "Ich kenne das Modellgebiet, den aufgezeichneten AIS-Tag und das, was gerade auf dem "
    + "Bildschirm steht. Fragen Sie mich nach dem Verkehr, nach einzelnen Schiffen oder danach, "
    + "was ein Standort abdeckt.",
};

/**
 * Suggestions are questions the tools can actually answer.
 *
 * ⚠️ Chosen deliberately: an opening chip that the backend cannot ground would teach the user in
 * one click that the assistant makes things up.
 */
const SUGGESTIONS = [
  "Wie viel Verkehr lag an diesem Tag im Gebiet?",
  "Welche Schiffe sind am weitesten durchgefahren?",
  "Was deckt mein aktueller Standort ab?",
];

export interface ChatPanelProps {
  /** Rebuilt on every send, so the assistant sees the screen as it is now, not as it was. */
  getView: () => ViewSnapshot | null;
}

export function ChatPanel({ getView }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const patch = useCallback((id: number, fn: (m: Message) => Message) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const run = useCallback(async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");

    const userId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text, meta: "Sie" },
      { id: replyId, role: "assistant", text: "", meta: "Verbinde …", streaming: true },
    ]);

    const used: string[] = [];
    try {
      const response = await fetch(assistantStreamUrl(), {
        method: "POST",
        headers: assistantHeaders(),
        // The view travels with every prompt rather than being cached server-side: the user can
        // move a mast between two questions, and a stale snapshot would answer the old one.
        body: JSON.stringify({ prompt: text, view: getView() }),
      });
      if (!response.ok || !response.body) {
        // A JSON error body is the backend telling us why; surface it instead of a bare status.
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = await response.json();
          if (body?.message) detail = body.message;
        } catch { /* not JSON, keep the status */ }
        throw new Error(detail);
      }

      let answer = "";
      let meta = "Antwortet …";
      for await (const frame of readFrames(response.body)) {
        if (frame.type === "status") {
          patch(replyId, (m) => ({ ...m, meta: frame.message }));
        } else if (frame.type === "tool") {
          if (!used.includes(frame.name)) used.push(frame.name);
          patch(replyId, (m) => ({ ...m, sources: [...used] }));
        } else if (frame.type === "metadata") {
          meta = frame.model;
          patch(replyId, (m) => ({ ...m, meta }));
        } else if (frame.type === "delta") {
          answer += frame.text;
          patch(replyId, (m) => ({ ...m, text: answer, meta }));
        } else if (frame.type === "error") {
          throw new Error(frame.message);
        }
      }
      patch(replyId, (m) => ({
        ...m, text: answer || m.text, meta, streaming: false, sources: used,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unbekannter Fehler";
      patch(replyId, (m) => ({
        ...m,
        // 🔴 Reported as a failure, never as an answer. An assistant that responds to an outage
        // with a plausible-sounding guess is worse than one that is visibly unavailable.
        text: `Die Anfrage ist fehlgeschlagen: ${message}`,
        meta: "Fehler",
        streaming: false,
      }));
    } finally {
      setBusy(false);
    }
  }, [busy, getView, patch]);

  // ⚠️ No backend configured means no button at all. A chat that opens and then fails on every
  // message is a worse experience than a feature that is simply not present in this build.
  if (!assistantConfigured()) return null;

  if (!open) {
    return (
      <button
        data-testid="twin3d-chat-open"
        onClick={() => setOpen(true)}
        title="Fragen zum Modellgebiet stellen"
        style={{
          order: 3, pointerEvents: "auto", cursor: "pointer",
          background: "var(--mi-panel-strong)", color: "var(--mi-text)", border: "1px solid var(--mi-accent33)",
          borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontFamily: "inherit",
        }}
      >
        Assistent fragen
      </button>
    );
  }

  return (
    <aside
      data-testid="twin3d-chat"
      style={{
        order: 3, width: "100%", pointerEvents: "auto",
        background: "var(--mi-panel-strong)", borderRadius: 8, padding: "12px 14px",
        display: "flex", flexDirection: "column", gap: 9,
        maxHeight: "calc(100vh - 96px)", boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Assistent</strong>
        <span style={{ fontSize: 10.5, opacity: 0.55 }}>antwortet nur aus den Modelldaten</span>
        <button
          data-testid="twin3d-chat-close"
          onClick={() => setOpen(false)}
          title="Schließen"
          style={{
            marginLeft: "auto", background: "var(--mi-line07)", color: "var(--mi-text-muted)",
            border: "1px solid var(--mi-line20)", borderRadius: 6, padding: "2px 8px",
            cursor: "pointer", fontSize: 11,
          }}
        >
          Schließen
        </button>
      </div>

      <div
        ref={scrollRef}
        data-testid="twin3d-chat-messages"
        style={{
          display: "flex", flexDirection: "column", gap: 9,
          overflowY: "auto", scrollbarWidth: "thin", minHeight: 120, maxHeight: "46vh",
          fontSize: 12.5, lineHeight: 1.5,
        }}
      >
        {messages.map((m) => (
          <div key={m.id} data-testid="twin3d-chat-msg" data-role={m.role}
               /*
                 ⚠️ Exposed for tests, and worth the attribute. "The bubble has more than N
                 characters" is not the same as "the answer is finished" — polling on length reads
                 a half-streamed sentence, which is how the first version of the e2e spec failed
                 against an answer that was in fact correct.
               */
               data-streaming={m.streaming ? "true" : "false"}
               style={{ display: "flex", flexDirection: "column", gap: 2,
                        alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              background: m.role === "user" ? "var(--mi-accent13)" : "var(--mi-line05)",
              border: `1px solid ${m.role === "user" ? "var(--mi-accent27)" : "var(--mi-line10)"}`,
              borderRadius: 7, padding: "6px 9px", maxWidth: "92%",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {m.text || (m.streaming ? "…" : "")}
            </div>
            <div style={{ fontSize: 10, opacity: 0.45 }}>
              {m.meta}
              {/*
                The tools that answered, named on the turn they answered.
                🔴 This is what makes a figure checkable rather than merely stated — the reader can
                see whether a number came from the recorded day, the live relay, or their own screen.
              */}
              {m.sources?.length ? ` · Quellen: ${m.sources.join(", ")}` : ""}
            </div>
          </div>
        ))}
      </div>

      {messages.length === 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              data-testid="twin3d-chat-suggestion"
              disabled={busy}
              onClick={() => void run(s)}
              style={{
                background: "var(--mi-line05)", color: "var(--mi-text-muted)", border: "1px solid var(--mi-line13)",
                borderRadius: 6, padding: "4px 7px", cursor: busy ? "default" : "pointer",
                fontSize: 10.5, fontFamily: "inherit", textAlign: "left",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <input
          data-testid="twin3d-chat-input"
          value={input}
          disabled={busy}
          placeholder="Frage zum Gebiet, zu Schiffen oder zur Abdeckung …"
          aria-label="Frage an den Assistenten"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void run(input);
            }
          }}
          style={{
            flex: 1, minWidth: 0, background: "var(--mi-bg)", color: "var(--mi-text)",
            border: "1px solid var(--mi-line13)", borderRadius: 6, padding: "6px 8px",
            fontSize: 12, fontFamily: "inherit",
          }}
        />
        <button
          data-testid="twin3d-chat-send"
          disabled={busy || !input.trim()}
          onClick={() => void run(input)}
          style={{
            background: busy || !input.trim() ? "var(--mi-line07)" : "var(--mi-accent13)",
            color: "var(--mi-text-muted)", border: "1px solid var(--mi-accent27)", borderRadius: 6,
            padding: "6px 10px", cursor: busy || !input.trim() ? "default" : "pointer",
            fontSize: 12, fontFamily: "inherit",
          }}
        >
          {busy ? "…" : "Senden"}
        </button>
      </div>
    </aside>
  );
}
