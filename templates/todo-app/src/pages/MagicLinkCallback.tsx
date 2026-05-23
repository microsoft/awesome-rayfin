import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../hooks/AuthContext';
import { ServiceContainer } from '../services/ServiceContainer';

/**
 * Handles the magic link callback after user clicks the link in their email.
 * This page processes the authentication and redirects to the dashboard.
 */
export function MagicLinkCallback() {
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  // Prevent double-execution in React StrictMode
  const hasHandledCallback = useRef(false);

  useEffect(() => {
    // Guard against double-execution (React StrictMode mounts twice)
    if (hasHandledCallback.current) {
      return;
    }
    hasHandledCallback.current = true;

    const handleCallback = async () => {
      try {
        const authService = ServiceContainer.create().authService;

        // Verify this is actually a magic link callback
        if (!authService.isMagicLinkCallback()) {
          setError('Invalid callback URL. Please request a new magic link.');
          setProcessing(false);
          return;
        }

        // Handle the callback and authenticate
        const result = await authService.handleMagicLinkCallback();

        if (result.success && result.user) {
          await refreshUser();
          window.history.replaceState({}, document.title, '/');
          navigate('/', { replace: true });
        } else {
          setError(result.error ?? 'Authentication failed. Please try again.');
          setProcessing(false);
        }
      } catch (err) {
        console.error('Magic link callback error:', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Authentication failed. Please try again.'
        );
        setProcessing(false);
      }
    };

    handleCallback();
  }, [navigate, refreshUser]);

  if (processing) {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <svg
              className="w-8 h-8 text-blue-600 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            Signing you in...
          </h2>
          <p className="text-gray-600">
            Please wait while we verify your magic link.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="p-6 bg-white rounded-lg shadow-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
            <svg
              className="w-10 h-10 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Sign in failed
          </h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
