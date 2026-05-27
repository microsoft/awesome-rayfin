import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SlideRenderer } from '@/components/SlideRenderer';
import { type SlideshowItem, getSlideshow } from '@/services/slideshows';

export function BrowsePage() {
  const { slideshowId } = useParams<{ slideshowId: string }>();
  const navigate = useNavigate();
  const [slideshow, setSlideshow] = useState<SlideshowItem | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slideshowId) return;
    try {
      const show = await getSlideshow(slideshowId);
      if (!show) { navigate('/'); return; }
      setSlideshow(show);
    } catch (err) {
      console.error('Failed to load slideshow:', err);
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [slideshowId, navigate]);

  useEffect(() => { load(); }, [load]);

  const goToSlide = (index: number) => {
    if (!slideshow) return;
    setCurrentSlide(Math.max(0, Math.min(index, slideshow.slides.length - 1)));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goToSlide(currentSlide + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToSlide(currentSlide - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (loading || !slideshow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading slideshow...</div>
      </div>
    );
  }

  const slide = slideshow.slides[currentSlide];
  const totalSlides = slideshow.slides.length;

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white transition-colors text-sm"
          >
            ← Back
          </button>
          <h1 className="font-semibold">{slideshow.title}</h1>
          <span className="bg-gray-500/20 text-gray-400 text-xs px-2 py-0.5 rounded-full">
            PREVIEW
          </span>
        </div>
        <span className="text-xs text-gray-500">{slideshow.format}</span>
      </header>

      {/* Slide area */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 bg-white overflow-auto">
          {slide && (
            <SlideRenderer
              content={slide.content}
              format={slideshow.format as 'markdown' | 'html'}
            />
          )}
        </div>

        {/* Controls */}
        <div className="bg-gray-100 border-t border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <button
            onClick={() => goToSlide(currentSlide - 1)}
            disabled={currentSlide === 0}
            className="rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 font-medium">
              {currentSlide + 1} / {totalSlides}
            </span>
            <div className="flex gap-1">
              {slideshow.slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goToSlide(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    i === currentSlide ? 'bg-blue-600' : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => goToSlide(currentSlide + 1)}
            disabled={currentSlide === totalSlides - 1}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
