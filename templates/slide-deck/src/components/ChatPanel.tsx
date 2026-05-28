import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChatMessageItem, getChatMessages, sendChatMessage } from '@/services/chat';
import { usePolling } from '@/hooks/usePolling';

interface ChatPanelProps {
  sessionId: string;
  authorName: string;
  presenterUserId?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function ChatPanel({ sessionId, authorName, presenterUserId, collapsed, onToggle }: ChatPanelProps) {
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(
    () => getChatMessages(sessionId),
    [sessionId]
  );

  const { data: messages, refresh } = usePolling<ChatMessageItem[]>(fetchMessages, 3000);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendChatMessage(sessionId, authorName, text);
      setNewMessage('');
      refresh();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  // Collapsed state: just show a vertical tab button
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="h-full w-10 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        title="Open chat"
      >
        <span className="writing-mode-vertical text-xs font-semibold text-gray-600 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180">
          💬 Chat
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Chat</h3>
        {onToggle && (
          <button
            onClick={onToggle}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Collapse chat"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(messages ?? []).map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className="font-medium text-blue-600">{msg.authorName}</span>
            {presenterUserId && msg.user_id === presenterUserId && (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                🎤 Presenter
              </span>
            )}
            <span className="text-gray-400 text-xs ml-2">
              {new Date(msg.createdAt).toLocaleTimeString()}
            </span>
            <p className="text-gray-700 dark:text-gray-300 mt-0.5">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !newMessage.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
