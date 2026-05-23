import { useState, ReactNode } from 'react';

import { ServiceContainer } from '../services/ServiceContainer';

interface MagicLinkFormProps {
  onBackToLogin?: () => void;
  fabricButton?: ReactNode;
}

export function MagicLinkForm({
  onBackToLogin,
  fabricButton,
}: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const authService = ServiceContainer.create().authService;
      // Use current origin + /auth/callback as the redirect URI
      const redirectUri = `${window.location.origin}/auth/callback`;

      const result = await authService.sendMagicLink(email, redirectUri);

      if (result.success) {
        setSuccess(true);
      } else {
        setError('Failed to send magic link. Please try again.');
      }
    } catch (err) {
      console.error('Magic link error:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to send magic link'
      );
    } finally {
      setLoading(false);
    }
  };

  // Success state - show email sent confirmation
  if (success) {
    return (
      <div className="min-h-screen flex flex-col justify-start items-center bg-gray-50 pt-16">
        <div className="max-w-md w-full space-y-8">
          <div className="p-6 bg-white rounded-lg shadow-md">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
                <svg
                  className="w-10 h-10 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Check your email
              </h2>
              <p className="text-gray-600 mb-4">We sent a sign-in link to:</p>
              <p className="text-lg font-medium text-gray-900 mb-4">{email}</p>
              <p className="text-sm text-gray-600">
                Click the link in the email to sign in. The link will expire in
                15 minutes.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => {
                  setSuccess(false);
                  setEmail('');
                }}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Try a different email
              </button>
              {onBackToLogin && (
                <button
                  onClick={onBackToLogin}
                  className="w-full text-blue-500 hover:text-blue-700 font-medium py-2"
                >
                  Back to sign in options
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-start items-center bg-gray-50 pt-16">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in with email
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            We'll send you a magic link to sign in instantly
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              <p>{error}</p>
            </div>
          )}
          <div>
            <label
              htmlFor="magic-link-email"
              className="block text-sm font-medium text-gray-700"
            >
              Email address
            </label>
            <input
              id="magic-link-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send magic link'}
          </button>
        </form>

        {fabricButton && (
          <>
            <div className="mt-6 relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>
            <div className="mt-4">{fabricButton}</div>
          </>
        )}

        {onBackToLogin && (
          <div className="mt-4 text-center">
            <button
              onClick={onBackToLogin}
              className="text-blue-500 hover:text-blue-700"
            >
              Back to sign in options
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
