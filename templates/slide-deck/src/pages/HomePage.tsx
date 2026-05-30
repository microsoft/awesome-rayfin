import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { useAuth } from '@/hooks/AuthContext';
import { type SlideshowItem, getSlideshows, createSlideshow, deleteSlideshow } from '@/services/slideshows';
import { type SessionItem, getSessions, createSession } from '@/services/sessions';
import { sampleSlideshows } from '@/data/sampleSlideshows';

export function HomePage() {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [slideshows, setSlideshows] = useState<SlideshowItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);

  const copyJoinLink = (session: SessionItem) => {
    const url = `${window.location.origin}/join/${session.joinCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSessionId(session.id);
      setTimeout(() => setCopiedSessionId(null), 2000);
    });
  };

  const loadData = useCallback(async () => {
    try {
      const [s, sess] = await Promise.all([getSlideshows(), getSessions()]);
      setSlideshows(s);
      setSessions(sess);
      setError(null);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load data. Make sure your data service is deployed.');
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
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to seed samples:', message, err);
      setError(`Failed to add sample slideshows: ${message}`);
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

  const handleDeleteSlideshow = async (id: string) => {
    if (!confirm('Delete this slideshow? This cannot be undone.')) return;
    try {
      await deleteSlideshow(id);
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to delete slideshow: ${message}`);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Slide Deck</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Interactive presentation sessions</p>
        </div>
        <div className="flex items-center gap-4">
          <DarkModeToggle />
          <span className="text-sm text-gray-500 dark:text-gray-400">{user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <span className="text-red-500 text-lg">⚠️</span>
            <div>
              <p className="text-sm font-medium text-red-800">Failed to load data</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
              <p className="text-xs text-red-500 mt-2">
                Have you deployed your data service? Run <code className="bg-red-100 px-1 rounded">npm run rayfin:up</code> to deploy.
              </p>
            </div>
          </div>
        )}

        {/* Join a Session */}
        <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Join a Session</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter join code (e.g. ABC123)"
              className="flex-1 max-w-xs rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono tracking-wider"
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Active Sessions</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {activeSessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{session.title}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                        Code: <span className="font-mono font-bold text-blue-600">{session.joinCode}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyJoinLink(session); }}
                          className="inline-flex items-center text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          title="Copy join link"
                        >
                          {copiedSessionId === session.id ? (
                            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Slideshows</h2>
            <div className="flex gap-2">
              {slideshows.length === 0 && (
                <button
                  onClick={handleSeedSamples}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Add Samples
                </button>
              )}
              <button
                onClick={() => navigate('/create')}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                + Create Slideshow
              </button>
            </div>
          </div>
          {slideshows.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">No slideshows yet. Add sample slideshows to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {slideshows.map((show) => (
                <div
                  key={show.id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900 dark:text-gray-100">{show.title}</h3>
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {show.format}
                        </span>
                        {show.theme?.name && show.theme.name !== 'Light' && (
                         <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-gray-500">
                           <span className="w-2.5 h-2.5 rounded-full border border-gray-200" style={{ backgroundColor: show.theme.backgroundColor }} />
                           {show.theme.name}
                         </span>
                        )}
                      </div>
                      {user && show.user_id === user.id && (
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            onClick={() => navigate(`/edit/${show.id}`)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Edit slideshow"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteSlideshow(show.id)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete slideshow"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                              <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{show.description}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{show.slides.length} slides</p>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => navigate(`/browse/${show.id}`)}
                      className="rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                    >
                      Browse
                    </button>
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
