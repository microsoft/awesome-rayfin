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

export async function getSlideshows(): Promise<SlideshowItem[]> {
  const client = getRayfinClient();
  const results = await client.data.Slideshow.select([
    'id', 'title', 'description', 'format', 'slides', 'createdAt',
  ]).orderBy({ createdAt: 'desc' }).execute();
  return results.map((r) => ({
    ...r,
    slides: JSON.parse(r.slides as string) as SlideContent[],
  })) as unknown as SlideshowItem[];
}

export async function getSlideshow(id: string): Promise<SlideshowItem | null> {
  const client = getRayfinClient();
  const results = await client.data.Slideshow.select([
    'id', 'title', 'description', 'format', 'slides', 'createdAt',
  ]).where({ id }).execute();
  const r = results[0];
  if (!r) return null;
  return { ...r, slides: JSON.parse(r.slides as string) } as unknown as SlideshowItem;
}

export async function createSlideshow(
  data: Omit<SlideshowItem, 'id' | 'createdAt'>
): Promise<SlideshowItem> {
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
}
