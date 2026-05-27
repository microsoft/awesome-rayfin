import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChatPanel } from '@/components/ChatPanel';
import { SlideRenderer } from '@/components/SlideRenderer';
import { useAuth } from '@/hooks/AuthContext';
import { usePolling } from '@/hooks/usePolling';
import { type SessionItem, getSession } from '@/services/sessions';
import { type SlideshowItem, getSlideshow } from '@/services/slideshows';

export function AudiencePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const fetchSession = useCallback(
    () => (sessionId ? getSession(sessionId) : Promise.resolve(null)),
    [sessionId]
  );

  const { data: session, loading: sessionLoading } = usePolling<SessionItem | null>(
    fetchSession,
    3000
  );

  const fetchSlideshow = useCallback(
    () => (session?.slideshowId ? getSlideshow(session.slideshowId) : Promise.resolve(null)),
    [session?.slideshowId]
  );

  const { data: slideshow, loading: slideshowLoading } = usePolling<SlideshowItem | null>(
    fetchSlideshow,
    30000,
    !!session?.slideshowId
  );

  if (sessionLoading || slideshowLoading || !session || !slideshow) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Joining session...</div>
      </div>
    );
  }

  if (!session.isActive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Session Ended</h2>
        <p className="text-gray-500">This presentation session has ended.</p>
        <button
          onClick={() => navigate('/')}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const currentSlide = session.currentSlide;
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
          <h1 className="font-semibold">{session.title}</h1>
          <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-0.5 rounded-full">
            VIEWING
          </span>
        </div>
        <div className="text-sm text-gray-400">
          Slide {currentSlide + 1} of {totalSlides}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Slide area */}
        <div className="flex-1 bg-white overflow-auto">
          {slide && (
            <SlideRenderer
              content={slide.content}
              format={slideshow.format as 'markdown' | 'html'}
            />
          )}
        </div>
        {/* Chat sidebar */}
        <div className="w-80 shrink-0">
          <ChatPanel sessionId={session.id} authorName={user?.name ?? 'Audience'} presenterUserId={session.user_id} />
        </div>
      </div>

      {/* Slide indicators */}
      <div className="bg-gray-100 border-t border-gray-200 px-6 py-3 flex items-center justify-center shrink-0">
        <div className="flex gap-1.5">
          {slideshow.slides.map((_, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i === currentSlide ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
