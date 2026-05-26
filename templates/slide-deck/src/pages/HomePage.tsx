import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { type SlideshowItem, getSlideshows, createSlideshow } from '@/services/slideshows';
import { type SessionItem, getSessions, createSession } from '@/services/sessions';
import { sampleSlideshows } from '@/data/sampleSlideshows';

export function HomePage() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [slideshows, setSlideshows] = useState<SlideshowItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [s, sess] = await Promise.all([getSlideshows(), getSessions()]);
      setSlideshows(s);
      setSessions(sess);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSeedSamples = async () => {
    try {
      for (const sample of sampleSlideshows) {
        await createSlideshow(sample);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to seed samples:', err);
    }
  };

  const handleStartSession = async (slideshow: SlideshowItem) => {
    try {
      const session = await createSession(slideshow.id, slideshow.title);
      navigate(`/present/${session.id}`);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleJoinSession = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    const session = sessions.find(
      (s) => s.joinCode === code && s.isActive
    );
    if (session) {
      navigate(`/audience/${session.id}`);
    } else {
      alert('Session not found or no longer active.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const activeSessions = sessions.filter((s) => s.isActive);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Slide Deck</h1>
          <p className="text-sm text-gray-500">Interactive presentation sessions</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Join a Session */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Join a Session</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter join code (e.g. ABC123)"
              className="flex-1 max-w-xs rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono tracking-wider"
              maxLength={6}
            />
            <button
              onClick={handleJoinSession}
              disabled={!joinCode.trim()}
              className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Join
            </button>
          </div>
        </section>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Sessions</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{session.title}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Code: <span className="font-mono font-bold text-blue-600">{session.joinCode}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Slide {session.currentSlide + 1}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate(`/present/${session.id}`)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                      >
                        Present
                      </button>
                      <button
                        onClick={() => navigate(`/audience/${session.id}`)}
                        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Slideshows */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Slideshows</h2>
            {slideshows.length === 0 && (
              <button
                onClick={handleSeedSamples}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Add Sample Slideshows
              </button>
            )}
          </div>
          {slideshows.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-gray-500">No slideshows yet. Add sample slideshows to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {slideshows.map((show) => (
                <div
                  key={show.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900">{show.title}</h3>
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {show.format}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{show.description}</p>
                      <p className="text-xs text-gray-400 mt-2">{show.slides.length} slides</p>
                    </div>
                    <button
                      onClick={() => handleStartSession(show)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors whitespace-nowrap"
                    >
                      Start Session
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
