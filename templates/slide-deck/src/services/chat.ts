import { getRayfinClient } from './rayfinClient';

export interface ChatMessageItem {
  id: string;
  sessionId: string;
  authorName: string;
  content: string;
  createdAt: Date;
}

export async function getChatMessages(sessionId: string): Promise<ChatMessageItem[]> {
  const client = getRayfinClient();
  const results = await client.data.ChatMessage.select([
    'id', 'sessionId', 'authorName', 'content', 'createdAt',
  ])
    .where({ sessionId })
    .orderBy({ createdAt: 'asc' })
    .execute();
  return results as ChatMessageItem[];
}

export async function sendChatMessage(
  sessionId: string,
  authorName: string,
  content: string
): Promise<ChatMessageItem> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) {
    throw new Error('Cannot send message: user is not authenticated.');
  }
  const result = await client.data.ChatMessage.create({
    sessionId,
    authorName,
    content,
    createdAt: new Date(),
    user_id: session.user.id,
  });
  return result as unknown as ChatMessageItem;
}
