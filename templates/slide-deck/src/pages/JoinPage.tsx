import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSessions } from '@/services/sessions';

export function JoinPage() {
  const { joinCode } = useParams<{ joinCode: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!joinCode) return;
    const code = joinCode.trim().toUpperCase();

    getSessions()
      .then((sessions) => {
        const session = sessions.find(
          (s) => s.joinCode === code && s.isActive
        );
        if (session) {
          navigate(`/audience/${session.id}`, { replace: true });
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [joinCode, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-700 dark:text-gray-300">Session not found or no longer active.</p>
        <button
          onClick={() => navigate('/')}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500 dark:text-gray-400">Joining session…</div>
    </div>
  );
}
