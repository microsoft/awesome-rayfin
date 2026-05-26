import { AuthError } from '@microsoft/rayfin-client';
import { getGlobalSessionExpiredHandler } from '@/hooks/AuthContext';
import { getRayfinClient } from './rayfinClient';

export interface SessionItem {
  id: string;
  slideshowId: string;
  title: string;
  currentSlide: number;
  isActive: boolean;
  joinCode: string;
  createdAt: Date;
}

function handleError(err: unknown): never {
  const isAuthError =
    err instanceof AuthError ||
    (err instanceof Error && 'status' in err && (err as { status: number }).status === 401);
  if (isAuthError) {
    const handler = getGlobalSessionExpiredHandler();
    if (handler) handler();
  }
  throw err;
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
  try {
    const client = getRayfinClient();
    const results = await client.data.Session.select([
      'id', 'slideshowId', 'title', 'currentSlide', 'isActive', 'joinCode', 'createdAt',
    ]).orderBy({ createdAt: 'desc' }).execute();
    return results as SessionItem[];
  } catch (err) {
    handleError(err);
  }
}

export async function getSession(id: string): Promise<SessionItem | null> {
  try {
    const client = getRayfinClient();
    return await client.data.Session.findById(id) as SessionItem | null;
  } catch (err) {
    handleError(err);
  }
}

export async function createSession(slideshowId: string, title: string): Promise<SessionItem> {
  try {
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
  } catch (err) {
    handleError(err);
  }
}

export async function updateCurrentSlide(id: string, slideIndex: number): Promise<void> {
  try {
    const client = getRayfinClient();
    await client.data.Session.update({ id }, { currentSlide: slideIndex });
  } catch (err) {
    handleError(err);
  }
}

export async function endSession(id: string): Promise<void> {
  try {
    const client = getRayfinClient();
    await client.data.Session.update({ id }, { isActive: false });
  } catch (err) {
    handleError(err);
  }
}
