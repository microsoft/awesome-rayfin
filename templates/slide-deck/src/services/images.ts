import { getRayfinClient } from './rayfinClient';

export interface ImageItem {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
  createdAt: Date;
  user_id: string;
}

/** Lightweight metadata (no base64 data) for listing */
export interface ImageMeta {
  id: string;
  filename: string;
  mimeType: string;
  createdAt: Date;
  user_id: string;
}

// The Image entity is defined in rayfin/data but generated types may lag behind.
// We use `as any` for client.data.Image access until types catch up.

export async function getImages(): Promise<ImageMeta[]> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const results = await (client.data as any).Image.select([
    'id', 'filename', 'mimeType', 'user_id', 'createdAt',
  ]).orderBy({ createdAt: 'desc' }).execute();
  return results as unknown as ImageMeta[];
}

export async function getImage(id: string): Promise<ImageItem | null> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const results = await (client.data as any).Image.select([
    'id', 'filename', 'mimeType', 'data', 'user_id', 'createdAt',
  ]).where({ id }).execute();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (results as any[])[0];
  return r ? (r as ImageItem) : null;
}

export async function uploadImage(
  file: File,
): Promise<ImageItem> {
  const client = getRayfinClient();
  const session = client.auth.getSession();
  if (!session.isAuthenticated || !session.user) {
    throw new Error('Cannot upload image: user is not authenticated.');
  }

  const base64 = await fileToBase64(file);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  const result = await (client.data as any).Image.create({
    filename: file.name,
    mimeType: file.type,
    data: base64,
    createdAt: new Date(),
    user_id: session.user.id,
  });

  return {
    ...result,
    data: base64,
  } as ImageItem;
}

export async function deleteImage(id: string): Promise<void> {
  const client = getRayfinClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag behind schema
  await (client.data as any).Image.delete({ id });
}

/** Build a data URI for rendering an image inline */
export function imageDataUri(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
