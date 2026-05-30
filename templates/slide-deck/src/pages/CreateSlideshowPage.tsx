import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createSlideshow, getSlideshow, updateSlideshow } from '@/services/slideshows';
import { SlideRenderer } from '@/components/SlideRenderer';
import { ThemePicker } from '@/components/ThemePicker';
import { ImageLibrary } from '@/components/ImageLibrary';
import { type SlideTheme, DEFAULT_THEME } from '@/data/themes';
import { DarkModeToggle } from '@/components/DarkModeToggle';

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
  const [theme, setTheme] = useState<SlideTheme>(DEFAULT_THEME);
  const [slides, setSlides] = useState<SlideData[]>([{ content: '', notes: '' }]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [error, setError] = useState<string | null>(null);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = (snippet: string) => {
    const ta = editorRef.current;
    if (!ta) {
      // Fallback: append to current slide content
      updateSlideField(activeSlide, 'content', slides[activeSlide].content + '\n' + snippet);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = slides[activeSlide].content;
    const updated = current.substring(0, start) + snippet + current.substring(end);
    updateSlideField(activeSlide, 'content', updated);
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
      ta.focus();
    });
  };

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
        setTheme(show.theme);
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
        theme,
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
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{isEditing ? 'Edit Slideshow' : 'Create Slideshow'}</h1>
        </div>
        <div className="flex items-center gap-3">
          <DarkModeToggle />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Slideshow'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-6 py-2 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left sidebar — metadata + slide list */}
        {sidebarCollapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="w-10 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Expand sidebar"
          >
            <span className="text-xs font-semibold text-gray-600 [writing-mode:vertical-rl] rotate-180">
              📋 Slides
            </span>
          </button>
        ) : (
        <div className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col overflow-y-auto">
          <div className="p-4 space-y-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Settings</span>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Collapse sidebar"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Presentation"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A brief description"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Format</label>
              <div className="flex gap-2">
                {(['markdown', 'html'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      format === f
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {f === 'markdown' ? 'Markdown' : 'HTML'}
                  </button>
                ))}
              </div>
            </div>
            <ThemePicker theme={theme} onChange={setTheme} />
          </div>

          {/* Slide list */}
          <div className="flex-1 p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Slides ({slides.length})</span>
              <button
                onClick={addSlide}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
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
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 font-medium'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <span className="flex-1">Slide {i + 1}</span>
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
                    title="Move up"
                  >↑</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
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

          {/* Image library */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <ImageLibrary format={format} onInsert={insertAtCursor} />
          </div>
        </div>
        )}

        {/* Center + Right: Editor and Preview with shared speaker notes below */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor and Preview panels */}
          <div className="flex-1 flex min-h-0">
            {/* Editor panel */}
            {editorCollapsed ? (
              <button
                onClick={() => setEditorCollapsed(false)}
                className="w-10 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Expand editor"
              >
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180">
                  ✏️ Editor
                </span>
              </button>
            ) : (
              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Editing Slide {activeSlide + 1} — {format === 'markdown' ? 'Markdown' : 'HTML'}
                  </span>
                  <button
                    onClick={() => {
                      if (previewCollapsed) setPreviewCollapsed(false);
                      setEditorCollapsed(true);
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title="Collapse editor"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
                <textarea
                  ref={editorRef}
                  value={slides[activeSlide].content}
                  onChange={(e) => updateSlideField(activeSlide, 'content', e.target.value)}
                  placeholder={format === 'markdown'
                    ? '# Slide Title\n\nYour content here...\n\n- Bullet point\n- Another point'
                    : '<h1>Slide Title</h1>\n<p>Your content here...</p>'}
                  className="flex-1 w-full resize-none border-none p-6 font-mono text-sm focus:outline-none bg-white dark:bg-gray-900 dark:text-gray-100"
                  spellCheck={false}
                />
              </div>
            )}

            {/* Preview panel */}
            {previewCollapsed ? (
              <button
                onClick={() => setPreviewCollapsed(false)}
                className="w-10 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Expand preview"
              >
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 [writing-mode:vertical-rl] rotate-180">
                  👁️ Preview
                </span>
              </button>
            ) : (
              <div className={`${editorCollapsed ? 'flex-1' : 'w-[400px]'} shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col`}>
                <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Preview</span>
                  <button
                    onClick={() => {
                      if (editorCollapsed) setEditorCollapsed(false);
                      setPreviewCollapsed(true);
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    title="Collapse preview"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-auto bg-white dark:bg-gray-900">
                  {slides[activeSlide]?.content.trim() ? (
                    <SlideRenderer content={slides[activeSlide].content} format={format} theme={theme} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
                      Start typing to see a preview
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Speaker Notes — spans full width below editor/preview */}
          <div className="border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              onClick={() => setNotesCollapsed((c) => !c)}
              className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Speaker Notes</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-3.5 w-3.5 text-gray-400 transition-transform ${notesCollapsed ? '' : 'rotate-180'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            {!notesCollapsed && (
              <textarea
                value={slides[activeSlide].notes}
                onChange={(e) => updateSlideField(activeSlide, 'notes', e.target.value)}
                placeholder="Add speaker notes for this slide…"
                className="w-full h-28 resize-none border-none px-6 py-3 text-sm focus:outline-none bg-white dark:bg-gray-900 dark:text-gray-100"
                spellCheck={false}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
