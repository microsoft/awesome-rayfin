import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChatMessageItem, getChatMessages, sendChatMessage } from '@/services/chat';
import { usePolling } from '@/hooks/usePolling';

interface ChatPanelProps {
  sessionId: string;
  authorName: string;
}

export function ChatPanel({ sessionId, authorName }: ChatPanelProps) {
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

  return (
    <div className="flex flex-col h-full border-l border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">Chat</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(messages ?? []).map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className="font-medium text-blue-600">{msg.authorName}</span>
            <span className="text-gray-400 text-xs ml-2">
              {new Date(msg.createdAt).toLocaleTimeString()}
            </span>
            <p className="text-gray-700 mt-0.5">{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="p-3 border-t border-gray-200 flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
