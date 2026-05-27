import { getRayfinClient } from './rayfinClient';

export interface SessionItem {
  id: string;
  slideshowId: string;
  title: string;
  currentSlide: number;
  isActive: boolean;
  joinCode: string;
  user_id: string;
  createdAt: Date;
}

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function getSessions(): Promise<SessionItem[]> {
  const client = getRayfinClient();
  const results = await client.data.Session.select([
    'id', 'slideshowId', 'title', 'currentSlide', 'isActive', 'joinCode', 'user_id', 'createdAt',
  ]).orderBy({ createdAt: 'desc' }).execute();
  return results as SessionItem[];
}

export async function getSession(id: string): Promise<SessionItem | null> {
  const client = getRayfinClient();
  const results = await client.data.Session.select([
    'id', 'slideshowId', 'title', 'currentSlide', 'isActive', 'joinCode', 'user_id', 'createdAt',
  ]).where({ id }).execute();
  return (results[0] as SessionItem) ?? null;
}

export async function createSession(slideshowId: string, title: string): Promise<SessionItem> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) {
    throw new Error('Cannot create session: user is not authenticated.');
  }
  const result = await client.data.Session.create({
    slideshowId,
    title,
    currentSlide: 0,
    isActive: true,
    joinCode: generateJoinCode(),
    createdAt: new Date(),
    user_id: session.user.id,
  });
  return result as unknown as SessionItem;
}

export async function updateCurrentSlide(id: string, slideIndex: number): Promise<void> {
  const client = getRayfinClient();
  await client.data.Session.update({ id }, { currentSlide: slideIndex });
}

export async function endSession(id: string): Promise<void> {
  const client = getRayfinClient();
  await client.data.Session.update({ id }, { isActive: false });
}
