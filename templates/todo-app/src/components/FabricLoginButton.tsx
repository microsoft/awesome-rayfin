import { useState } from 'react';

import { useAuth } from '../hooks/AuthContext';
import { ServiceContainer } from '../services/ServiceContainer';

export function FabricLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refreshUser } = useAuth();

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    try {
      const authService = ServiceContainer.create().authService;
      await authService.ensureSignedInWithFabric();
      // The 4-step waterfall has resolved — session is established.
      // Refresh React auth state to pick up the new session.
      await refreshUser();
    } catch (err) {
      console.error('Fabric login error:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to sign in with Fabric.'
      );
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 items-center gap-2"
      >
        {loading ? 'Opening Fabric...' : 'Sign in with Fabric'}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
      )}
    </div>
  );
}
