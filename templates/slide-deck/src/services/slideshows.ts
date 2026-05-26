import { AuthError } from '@microsoft/rayfin-client';
import { getGlobalSessionExpiredHandler } from '@/hooks/AuthContext';
import { getRayfinClient } from './rayfinClient';

export interface SlideContent {
  content: string;
}

export interface SlideshowItem {
  id: string;
  title: string;
  description: string;
  format: 'markdown' | 'html';
  slides: SlideContent[];
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

export async function getSlideshows(): Promise<SlideshowItem[]> {
  try {
    const client = getRayfinClient();
    const results = await client.data.Slideshow.select([
      'id', 'title', 'description', 'format', 'slides', 'createdAt',
    ]).orderBy({ createdAt: 'desc' }).execute();
    return results.map((r) => ({
      ...r,
      slides: JSON.parse(r.slides as string) as SlideContent[],
    })) as unknown as SlideshowItem[];
  } catch (err) {
    handleError(err);
  }
}

export async function getSlideshow(id: string): Promise<SlideshowItem | null> {
  try {
    const client = getRayfinClient();
    const r = await client.data.Slideshow.findById(id);
    if (!r) return null;
    return { ...r, slides: JSON.parse(r.slides as string) } as unknown as SlideshowItem;
  } catch (err) {
    handleError(err);
  }
}

export async function createSlideshow(
  data: Omit<SlideshowItem, 'id' | 'createdAt'>
): Promise<SlideshowItem> {
  try {
    const client = getRayfinClient();
    const session = client.auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Cannot create slideshow: user is not authenticated.');
    }
    const result = await client.data.Slideshow.create({
      title: data.title,
      description: data.description,
      format: data.format,
      slides: JSON.stringify(data.slides),
      createdAt: new Date(),
      user_id: session.user.id,
    });
    return { ...result, slides: data.slides } as unknown as SlideshowItem;
  } catch (err) {
    handleError(err);
  }
}
