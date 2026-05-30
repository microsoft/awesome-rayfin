import { type SlideTheme, DEFAULT_THEME } from '@/data/themes';
import { getRayfinClient } from './rayfinClient';

export interface SlideContent {
  content: string;
  notes?: string;
}

export interface SlideshowItem {
  id: string;
  title: string;
  description: string;
  format: 'markdown' | 'html';
  slides: SlideContent[];
  theme: SlideTheme;
  user_id: string;
  createdAt: Date;
}

/** Input for creating/updating — user_id is set automatically from auth */
export type SlideshowInput = Omit<SlideshowItem, 'id' | 'createdAt' | 'user_id'>;

function parseTheme(raw: string | undefined | null): SlideTheme {
  if (!raw) return DEFAULT_THEME;
  try { return { ...DEFAULT_THEME, ...JSON.parse(raw) }; } catch { return DEFAULT_THEME; }
}

// The 'theme' field is added to the entity but generated types may lag behind.
// We use `as any` for select fields and mutations involving 'theme'.

export async function getSlideshows(): Promise<SlideshowItem[]> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const results = await (client.data.Slideshow.select as any)([
    'id', 'title', 'description', 'format', 'slides', 'theme', 'user_id', 'createdAt',
  ]).orderBy({ createdAt: 'desc' }).execute();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return results.map((r: any) => ({
    ...r,
    slides: JSON.parse(r.slides as string) as SlideContent[],
    theme: parseTheme(r.theme as string),
  })) as SlideshowItem[];
}

export async function getSlideshow(id: string): Promise<SlideshowItem | null> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const results = await (client.data.Slideshow.select as any)([
    'id', 'title', 'description', 'format', 'slides', 'theme', 'user_id', 'createdAt',
  ]).where({ id }).execute();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (results as any[])[0];
  if (!r) return null;
  return {
    ...r,
    slides: JSON.parse(r.slides as string),
    theme: parseTheme(r.theme as string),
  } as SlideshowItem;
}

export async function createSlideshow(
  data: SlideshowInput
): Promise<SlideshowItem> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) {
    throw new Error('Cannot create slideshow: user is not authenticated.');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const result = await (client.data.Slideshow.create as any)({
    title: data.title,
    description: data.description,
    format: data.format,
    slides: JSON.stringify(data.slides),
    theme: JSON.stringify(data.theme),
    createdAt: new Date(),
    user_id: session.user.id,
  });
  return { ...result, slides: data.slides, theme: data.theme } as SlideshowItem;
}

export async function deleteSlideshow(id: string): Promise<void> {
  const client = getRayfinClient();
  await client.data.Slideshow.delete({ id });
}

export async function updateSlideshow(
  id: string,
  data: Pick<SlideshowItem, 'title' | 'description' | 'format' | 'slides' | 'theme'>
): Promise<void> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  await (client.data.Slideshow.update as any)({ id }, {
    title: data.title,
    description: data.description,
    format: data.format,
    slides: JSON.stringify(data.slides),
    theme: JSON.stringify(data.theme),
  });
}
