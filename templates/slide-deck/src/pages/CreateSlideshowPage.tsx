import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createSlideshow, getSlideshow, updateSlideshow } from '@/services/slideshows';
import { SlideRenderer } from '@/components/SlideRenderer';

type Format = 'markdown' | 'html';

interface SlideData {
  content: string;
  notes: string;
}

export function CreateSlideshowPage() {
  const navigate = useNavigate();
  const { slideshowId } = useParams<{ slideshowId?: string }>();
  const isEditing = Boolean(slideshowId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [format, setFormat] = useState<Format>('markdown');
  const [slides, setSlides] = useState<SlideData[]>([{ content: '', notes: '' }]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState<string | null>(null);

  // Load existing slideshow when editing
  useEffect(() => {
    if (!slideshowId) return;
    (async () => {
      try {
        const show = await getSlideshow(slideshowId);
        if (!show) { setError('Slideshow not found.'); return; }
        setTitle(show.title);
        setDescription(show.description);
        setFormat(show.format);
        setSlides(show.slides.map((s) => ({ content: s.content, notes: s.notes ?? '' })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load slideshow.');
      } finally {
        setLoading(false);
      }
    })();
  }, [slideshowId]);

  const updateSlideField = (index: number, field: keyof SlideData, value: string) => {
    setSlides((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const addSlide = () => {
    setSlides((prev) => [...prev, { content: '', notes: '' }]);
    setActiveSlide(slides.length);
  };

  const removeSlide = (index: number) => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== index));
    setActiveSlide(Math.min(activeSlide, slides.length - 2));
  };

  const moveSlide = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= slides.length) return;
    setSlides((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setActiveSlide(target);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required.'); return; }
    if (slides.every((s) => !s.content.trim())) { setError('Add at least one slide with content.'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        format,
        slides: slides
          .filter((s) => s.content.trim())
          .map((s) => ({ content: s.content, ...(s.notes.trim() ? { notes: s.notes.trim() } : {}) })),
      };
      if (isEditing && slideshowId) {
        await updateSlideshow(slideshowId, payload);
      } else {
        await createSlideshow(payload);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save slideshow.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading slideshow...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-gray-900">{isEditing ? 'Edit Slideshow' : 'Create Slideshow'}</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Slideshow'}
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left sidebar — metadata + slide list */}
        <div className="w-72 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col overflow-y-auto">
          <div className="p-4 space-y-4 border-b border-gray-200">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Presentation"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
              <div className="flex gap-2">
                {(['markdown', 'html'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      format === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {f === 'markdown' ? 'Markdown' : 'HTML'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Slide list */}
          <div className="flex-1 p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">Slides ({slides.length})</span>
              <button
                onClick={addSlide}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                + Add Slide
              </button>
            </div>
            {slides.map((_, i) => (
              <div
                key={i}
                onClick={() => setActiveSlide(i)}
                className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                  activeSlide === i
                    ? 'bg-indigo-100 text-indigo-800 font-medium'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="flex-1">Slide {i + 1}</span>
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }}
                    className="text-gray-400 hover:text-gray-600 text-xs"
                    title="Move down"
                  >↓</button>
                  {slides.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSlide(i); }}
                      className="text-red-400 hover:text-red-600 text-xs"
                      title="Remove slide"
                    >✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Center — editor */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">
              Editing Slide {activeSlide + 1} — {format === 'markdown' ? 'Markdown' : 'HTML'}
            </span>
          </div>
          <textarea
            value={slides[activeSlide].content}
            onChange={(e) => updateSlideField(activeSlide, 'content', e.target.value)}
            placeholder={format === 'markdown'
              ? '# Slide Title\n\nYour content here...\n\n- Bullet point\n- Another point'
              : '<h1>Slide Title</h1>\n<p>Your content here...</p>'}
            className="flex-1 w-full resize-none border-none p-6 font-mono text-sm focus:outline-none bg-white"
            spellCheck={false}
          />
          <div className="border-t border-gray-200">
            <div className="px-4 py-2 bg-gray-50">
              <span className="text-xs font-medium text-gray-500">Speaker Notes</span>
            </div>
            <textarea
              value={slides[activeSlide].notes}
              onChange={(e) => updateSlideField(activeSlide, 'notes', e.target.value)}
              placeholder="Add speaker notes for this slide…"
              className="w-full h-28 resize-none border-none px-6 py-3 text-sm focus:outline-none bg-white"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Right — live preview */}
        <div className="w-[400px] shrink-0 border-l border-gray-200 flex flex-col">
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <span className="text-xs font-medium text-gray-500">Preview</span>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            {slides[activeSlide]?.content.trim() ? (
              <SlideRenderer content={slides[activeSlide].content} format={format} />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                Start typing to see a preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
