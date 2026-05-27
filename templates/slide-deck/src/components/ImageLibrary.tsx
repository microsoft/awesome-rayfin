import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/AuthContext';
import {
  type ImageMeta,
  getImages,
  getImage,
  uploadImage,
  deleteImage,
  imageDataUri,
} from '@/services/images';

interface ImageLibraryProps {
  format: 'markdown' | 'html';
  onInsert: (snippet: string) => void;
}

export function ImageLibrary({ format, onInsert }: ImageLibraryProps) {
  const { user } = useAuth();
  const [images, setImages] = useState<ImageMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const items = await getImages();
      setImages(items);
    } catch {
      // ignore load errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load thumbnails for visible images
  useEffect(() => {
    for (const img of images) {
      if (thumbnails[img.id]) continue;
      getImage(img.id).then((full) => {
        if (full) {
          setThumbnails((prev) => ({
            ...prev,
            [img.id]: imageDataUri(full.mimeType, full.data),
          }));
        }
      });
    }
  }, [images, thumbnails]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }

    // 5MB limit for base64 storage
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5 MB.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await uploadImage(file);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      await deleteImage(id);
      setImages((prev) => prev.filter((img) => img.id !== id));
      setThumbnails((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  const handleInsert = (img: ImageMeta) => {
    const ref = `{{image:${img.id}}}`;
    if (format === 'markdown') {
      onInsert(`![${img.filename}](${ref})`);
    } else {
      onInsert(`<img src="${ref}" alt="${img.filename}" style="max-width: 100%; height: auto;" />`);
    }
  };

  const handleCopyRef = (img: ImageMeta) => {
    const ref = `{{image:${img.id}}}`;
    const snippet = format === 'markdown'
      ? `![${img.filename}](${ref})`
      : `<img src="${ref}" alt="${img.filename}" style="max-width: 100%; height: auto;" />`;
    navigator.clipboard.writeText(snippet);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">Images</span>
        <label className={`text-xs font-medium cursor-pointer transition-colors ${
          uploading ? 'text-gray-400' : 'text-indigo-600 hover:text-indigo-800'
        }`}>
          {uploading ? 'Uploading…' : '+ Upload'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
            disabled={uploading}
          />
        </label>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{error}</div>
      )}

      {loading ? (
        <div className="text-xs text-gray-400 text-center py-4">Loading images…</div>
      ) : images.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">
          No images yet. Upload one to use in your slides.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <div
              key={img.id}
              className="group relative rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              {/* Thumbnail */}
              <div className="aspect-video bg-gray-50 flex items-center justify-center overflow-hidden">
                {thumbnails[img.id] ? (
                  <img
                    src={thumbnails[img.id]}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-gray-300 text-xs">Loading…</span>
                )}
              </div>
              {/* Filename */}
              <div className="px-2 py-1">
                <span className="text-[10px] text-gray-600 truncate block">{img.filename}</span>
              </div>
              {/* Hover overlay with actions */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  onClick={() => handleInsert(img)}
                  className="rounded bg-indigo-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-700"
                  title="Insert into slide"
                >
                  Insert
                </button>
                <button
                  onClick={() => handleCopyRef(img)}
                  className="rounded bg-gray-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-gray-700"
                  title="Copy reference"
                >
                  Copy
                </button>
                {user && img.user_id === user.id && (
                  <button
                    onClick={() => handleDelete(img.id, img.filename)}
                    className="rounded bg-red-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-700"
                    title="Delete image"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-gray-400 leading-relaxed">
        {format === 'markdown'
          ? 'Click Insert or paste: ![alt]({{image:ID}})'
          : 'Click Insert or paste: <img src="{{image:ID}}" />'}
      </div>
    </div>
  );
}
